/**
 * 测试辅助：fake llm / fake subagents / engine 构造 / 等待引擎安定。
 * 用法：
 *   import { makeLlm, makeSubagents, makeEngine, waitIdle, DEFAULT_LLM } from './helpers.mjs'
 */
import { GroupChatEngine } from '../../lib/engine.js'

/** 按 purpose 分派的 fake llm（stream 产出 text-delta 块；signal abort 时抛 AbortError）。 */
export function makeLlm(handlers = {}) {
  const calls = []
  const stream = (opts) => {
    calls.push({
      purpose: opts.purpose,
      system: opts.system,
      userText: opts.messages && opts.messages[0] && opts.messages[0].content
        ? opts.messages[0].content[0].text
        : '',
      maxTokens: opts.maxTokens,
      signal: opts.signal,
    })
    const handler = handlers[opts.purpose]
    const resolved = (() => {
      if (handler === undefined) return { text: '' }
      if (typeof handler === 'string') return { text: handler }
      // 对象形式：{ text, chunkDelay }
      if (handler && typeof handler === 'object' && typeof handler.text === 'string') return handler
      if (typeof handler === 'function') {
        const out = handler(opts)
        if (out instanceof Error) return { error: out }
        if (out && typeof out === 'object' && typeof out.text === 'string') return out
        return { text: String(out ?? '') }
      }
      return { text: '' }
    })()
    const text = resolved.text ?? ''
    const delay = typeof resolved.chunkDelay === 'number' ? resolved.chunkDelay : 0
    return (async function* () {
      if (resolved.error) throw resolved.error
      for (let i = 0; i < text.length; i += 12) {
        if (opts.signal && opts.signal.aborted) {
          const e = new Error('aborted by signal')
          e.name = 'AbortError'
          throw e
        }
        if (delay > 0) await new Promise((r) => setTimeout(r, delay))
        yield { type: 'text-delta', index: 0, text: text.slice(i, i + 12) }
      }
      yield { type: 'finish', reason: 'completed' }
    })()
  }
  return { calls, stream }
}

/** 角色生成默认回复。 */
export const ROLE_JSON = JSON.stringify({
  host: { name: '主持人', persona: '资深主持人人设', duty: '主持讨论' },
  roles: [
    { name: '产品专家', persona: '懂产品的人设', duty: '产品视角' },
    { name: '技术专家', persona: '懂技术的人设', duty: '技术视角' },
    { name: '市场专家', persona: '懂市场的人设', duty: '市场视角' },
  ],
})

/** 常用 purpose 处理器集合（默认主持人收敛：host_message → summarize）。 */
export function defaultHandlers(overrides = {}) {
  return {
    'dsh-group-chat-generate-roles': ROLE_JSON,
    'dsh-group-chat-moderator-step': stepScript([
      JSON.stringify({ action: 'host_message', text: '大家怎么看？' }),
      JSON.stringify({ action: 'summarize' }),
    ]),
    'dsh-group-chat-member-plan': JSON.stringify({ mode: 'direct' }),
    'dsh-group-chat-speak': '我的观点是：先验证需求再做方案，控制成本。',
    'dsh-group-chat-summarize': '## 结论\n\n达成一致。\n\n## 关键分歧\n\n无。\n\n## 行动建议\n\n- 立项',
    ...overrides,
  }
}

/**
 * 主持人决策步骤脚本：steps 为回复数组，按调用次序取，超出取最后一个。
 * 用于让主持人循环收敛（如 [speak, summarize]）。
 */
export function stepScript(steps) {
  let i = 0
  return () => {
    const s = steps[Math.min(i, steps.length - 1)]
    i += 1
    return s
  }
}

/** fake subagents：behavior = ok | throw | hang | bad-stop | empty | no-provider */
export function makeSubagents({ behavior = 'ok', material = '深度分析要点：A 方案成本低；B 风险可控；C 建议分两步走' } = {}) {
  return {
    started: [],
    list: () => ['spawn'],
    getProvider: (name) => (name === 'spawn' ? { name } : undefined),
    async start(name, request) {
      this.started.push({ name, request })
      if (behavior === 'throw') throw new Error('subagents start failed')
      if (behavior === 'no-provider') throw new Error('provider unavailable')
      if (behavior === 'hang') return { id: 'child-1', result: new Promise(() => {}) }
      if (behavior === 'bad-stop') return { id: 'child-1', result: { stopReason: 'error', output: [] } }
      if (behavior === 'empty') return { id: 'child-1', result: { stopReason: 'completed', output: [] } }
      return { id: 'child-1', result: { stopReason: 'completed', output: [{ type: 'text', text: material }] } }
    },
  }
}

/** 构造引擎（deps 注入 mock）。 */
export function makeEngine({ llm, subagents, parent = { id: 'parent-1' }, cwd = '/tmp' } = {}) {
  return new GroupChatEngine({
    llm,
    subagents: () => subagents,
    resolveParentAgent: async () => parent,
    resolveRoute: async () => ({ provider: 'mock', model: 'mock-1' }),
    resolveCwd: async () => cwd,
    sessionId: 'test-session',
    onDiscussionDone: async () => {},
  })
}

/** 等待引擎循环退出（讨论结束/错误/停止）。 */
export async function waitIdle(engine, timeout = 5000) {
  const t0 = Date.now()
  while (engine._loopRunning) {
    if (Date.now() - t0 > timeout) throw new Error('engine did not settle within ' + timeout + 'ms')
    await new Promise((r) => setTimeout(r, 5))
  }
}

/** 等待条件成立。 */
export async function waitFor(fn, timeout = 5000, step = 10) {
  const t0 = Date.now()
  for (;;) {
    if (fn()) return
    if (Date.now() - t0 > timeout) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, step))
  }
}
