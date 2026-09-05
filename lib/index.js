/**
 * @stars-w/dsh-group-chat — host 侧入口与 HTTP API。
 *
 * 职责：
 *  - 持有唯一 GroupChatEngine 实例（进程内单群聊状态）
 *  - 经 webServer.register 注册前缀路由 /dsh-group-chat，为浏览器面板提供
 *    同源 JSON API（GET state 轮询 + POST 控制/导出）
 *  - 解析模型路由（当前会话 agent options → 默认模型选择）与导出工作目录
 *    （会话 cwd → 进程 cwd）
 *
 * 纯 ESM JS（whale-girl 模式），无编译步骤；挂在 ctx.effect 生命周期，
 * 卸载/热重载自动清理路由。
 */

import { GroupChatEngine } from './engine.js'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = '@stars-w/dsh-group-chat'

const API_PREFIX = '/dsh-group-chat'
const BODY_LIMIT = 1024 * 1024

/** 读取 JSON body（失败返回 {}）。 */
function readBody(req) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        req.destroy()
        resolve(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) { resolve({}); return }
      try { resolve(JSON.parse(raw)) } catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
  })
}

function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

export function apply(ctx) {
  const webServer = ctx.get('webServer')
  const logger = ctx.logger

  // 最近一次 POST 携带的 sessionId（host 侧解析 agent/路由/导出目录用）
  let lastSessionId = ''
  // 命令触发时保留的 agent 引用（注回主对话用）；无命令时回退 agents.get
  let lastAgent = null

  const engine = new GroupChatEngine({
    llm: ctx.get('llm'),
    sessionId: undefined,
    subagents: () => ctx.get('subagents'),
    resolveParentAgent: async () => {
      const agents = ctx.get('agents')
      if (!agents || typeof agents.get !== 'function') return undefined
      if (lastSessionId) {
        const a = agents.get(lastSessionId)
        if (a) return a
      }
      return lastAgent ?? undefined
    },
    resolveRoute: async () => resolveRoute(ctx, lastSessionId),
    resolveCwd: async () => resolveCwd(ctx, lastSessionId),
    // 讨论完成 → 自动导出 md + 把结论注回主对话（含文档相对地址）
    onDiscussionDone: async (summary, task) => {
      let docLine = ''
      let exported = false
      try {
        const result = await engine.exportMd()
        if (result.path && !result.error) {
          exported = true
          docLine = `\n\n📄 讨论纪要已保存：${result.path}`
        } else if (result.error) {
          docLine = `\n\n⚠ 讨论纪要导出失败：${result.error}`
        }
      } catch (err) {
        docLine = `\n\n⚠ 讨论纪要导出失败：${String(err?.message ?? err).slice(0, 120)}`
      }
      const agent = lastAgent ?? (lastSessionId ? ctx.get('agents')?.get?.(lastSessionId) : undefined)
      if (!agent) return
      const message = createUserMessage({
        content: [{
          type: 'text',
          text: `📋 群聊讨论已完成（任务：${String(task || '').slice(0, 100)}）\n\n${summary}${docLine || ''}`,
        }],
        source: {
          kind: 'plugin',
          plugin: 'dsh-group-chat',
          form: 'notice',
          summary: `group-chat done${exported ? ' (md saved)' : ''}`.slice(0, 60),
        },
      })
      try {
        if (agent.status === 'idle') agent.followup(message)
        else agent.inject(message)
      } catch (err) {
        logger?.warn?.('[dsh-group-chat] deliver conclusion failed: ' + String(err))
      }
      if (!exported) {
        // 导出失败或路径缺失：确保面板显示原因
        engine._bump()
      }
    },
  })

  if (!webServer || typeof webServer.register !== 'function') {
    logger?.warn?.('[dsh-group-chat] webServer service unavailable — HTTP API disabled')
    return
  }

  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost')
        const route = url.pathname.slice(API_PREFIX.length)
        if (req.method === 'GET' && route === '/api/state') {
          sendJSON(res, 200, engine.snapshot())
          return
        }
        if (req.method === 'POST' && route.startsWith('/api/')) {
          const action = route.slice('/api/'.length)
          const body = (await readBody(req)) || {}
          if (typeof body.sessionId === 'string') lastSessionId = body.sessionId
          engine.deps.sessionId = lastSessionId
          await handleAction(action, body, engine)
          sendJSON(res, 200, { ok: true, phase: engine.phase, version: engine.version })
          return
        }
        sendJSON(res, 404, { ok: false, error: 'not found' })
      } catch (err) {
        sendJSON(res, 400, { ok: false, error: String(err?.message ?? err).slice(0, 200) })
      }
    },
  }), '@stars-w/dsh-group-chat: HTTP API route')

  // 斜杠命令：/group-chat <任务描述> → 基于当前会话发起群聊（自动建团 + 自动讨论）
  const commands = ctx.get('commands')
  if (commands && typeof commands.register === 'function') {
    ctx.effect(() => commands.register({
      name: 'group-chat',
      description: '发起多角色群聊：根据任务生成角色团队并自动开始讨论（右侧面板可参与插话）',
      input: { hint: '输入任务/设计方案，如：设计一款家庭记账 App 的 MVP 方案……' },
      handler: async (invocation) => {
        const task = (invocation.rawInput || '').trim()
        if (task === '') {
          return { kind: 'error', text: '请提供任务描述：/group-chat <任务/设计方案>' }
        }
        if (engine.phase === 'discussing' || engine.phase === 'generating-roles' || engine.phase === 'summarizing') {
          return { kind: 'error', text: '已有一个群聊正在讨论中（右侧面板），请先停止再发起新群聊' }
        }
        const agent = invocation.agent
        const sid = agent?.session?.id ?? agent?.sessionId ?? ''
        if (sid !== '') lastSessionId = sid
        lastAgent = agent
        engine.deps.sessionId = lastSessionId
        // 后台串联：生成角色团队 → 自动开始讨论；client 侧轮询感知后自动打开右侧面板。
        // 拒绝/失败均不写入 engine.error（引擎自身失败路径已内部处理），避免污染
        // 导致总结被跳过。
        void (async () => {
          try {
            await engine.generateRoles(task)
            if (engine.phase === 'idle' && engine.roles.length > 0) engine.start()
          } catch (err) {
            logger?.warn?.('[dsh-group-chat] command generate rejected: ' + String(err?.message ?? err))
          }
        })()
        return {
          kind: 'success',
          text: `✅ 已基于当前会话发起群聊（任务：${task.slice(0, 80)}），正在生成角色团队并自动开始讨论 —— 右侧「群聊」面板可实时参与，底部输入框可插话`,
        }
      },
    }), '@stars-w/dsh-group-chat: slash command')
  }

  ctx.logger?.info?.('[dsh-group-chat] host loaded（群聊 API: ' + API_PREFIX + '/api）')
}

/** POST 动作分发。 */
async function handleAction(action, body, engine) {
  switch (action) {
    case 'generate-roles': {
      const task = String(body.task ?? '')
      if (task.trim() === '') throw new Error('任务内容不能为空')
      // 后台执行：立即返回，client 轮询 phase=generating-roles 直至 idle/error。
      // 注意：generateRoles 抛出的都是预期内拒绝（参数/相位错误），不写
      // engine.error（污染后 _summarize 被跳过、群聊卡死）；引擎自身失败路径
      // （JSON 非法/路由缺失）已在 generateRoles 内部设置 error/phase。
      void engine.generateRoles(task)
        .catch((err) => {
          logger?.warn?.('[dsh-group-chat] generate-roles rejected: ' + String(err?.message ?? err))
        })
      break
    }
    case 'start':
      engine.start()
      break
    case 'pause':
      engine.pause()
      break
    case 'resume':
      engine.resume()
      break
    case 'skip':
      engine.skip()
      break
    case 'stop':
      engine.stop()
      break
    case 'reroll':
      engine.reroll(String(body.roleId ?? ''))
      break
    case 'chat': {
      const text = String(body.text ?? '')
      if (text.trim() === '') throw new Error('消息不能为空')
      engine.chat(text)
      break
    }
    case 'update-roles':
      engine.updateRoles(body.roles)
      break
    case 'export-md':
      await engine.exportMd()
      break
    case 'sync-settings':
      if (typeof body.allowDeepReasoning === 'boolean') engine.allowDeepReasoning = body.allowDeepReasoning
      engine._bump()
      break
    default:
      throw new Error('unknown action: ' + action)
  }
}

/** 模型路由：优先当前会话 agent 的 options，回退默认模型选择。 */
async function resolveRoute(ctx, sessionId) {
  const agents = ctx.get('agents')
  const agent = sessionId && agents?.get ? agents.get(sessionId) : undefined
  const opts = agent?.options
  if (opts && typeof opts.provider === 'string' && typeof opts.model === 'string') {
    return { provider: opts.provider, model: opts.model }
  }
  const amd = ctx.get('agentDefaultModel')
  try {
    const sel = amd?.currentSelection?.()
    if (sel && typeof sel.provider === 'string' && typeof sel.model === 'string') {
      return { provider: sel.provider, model: sel.model }
    }
  } catch { /* fallthrough */ }
  return null
}

/** 导出目录：会话 header.cwd → 进程 cwd。 */
async function resolveCwd(ctx, sessionId) {
  const agents = ctx.get('agents')
  const agent = sessionId && agents?.get ? agents.get(sessionId) : undefined
  const header = agent?.header ?? agent?.session?.header
  if (header && typeof header.cwd === 'string' && header.cwd !== '') return header.cwd
  return process.cwd()
}
