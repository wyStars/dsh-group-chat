/**
 * 主持人驱动循环单测：speak / host_message / summarize 三分支、JSON 失败重试、
 * least-spoken 回退、连续 3 次调度失败 error。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeLlm, makeSubagents, makeEngine, defaultHandlers, waitIdle, stepScript } from './helpers.mjs'

async function setup(overrides = {}) {
  const llm = makeLlm(defaultHandlers(overrides))
  const subagents = makeSubagents()
  const engine = makeEngine({ llm, subagents })
  await engine.generateRoles('设计一款家庭记账 App')
  return { llm, subagents, engine }
}

test('moderator: host_message 分支 → 主持人消息入历史, 随后 summarize 收敛', async () => {
  const { engine } = await setup({
    'dsh-group-chat-moderator-step': stepScript([
      JSON.stringify({ action: 'host_message', text: '大家怎么看？' }),
      JSON.stringify({ action: 'summarize' }),
    ]),
  })
  engine.start()
  await waitIdle(engine)
  assert.equal(engine.phase, 'done')
  const hostMsgs = engine.messages.filter((m) => m.roleId === 'host')
  assert.equal(hostMsgs.length, 1)
  assert.equal(hostMsgs[0].text, '大家怎么看？')
  assert.match(engine.summary, /结论/)
})

test('moderator: speak 分支（带串场 text + 点名 r2）→ 串场 + 专家发言', async () => {
  const { engine } = await setup({
    'dsh-group-chat-moderator-step': stepScript([
      JSON.stringify({
        action: 'speak', speakTo: 'r2', text: '请技术专家补充', instruction: '重点分析落地成本',
      }),
      JSON.stringify({ action: 'summarize' }),
    ]),
  })
  engine.start()
  await waitIdle(engine)
  const hostMsgs = engine.messages.filter((m) => m.roleId === 'host')
  assert.equal(hostMsgs.length, 1)
  assert.equal(hostMsgs[0].text, '请技术专家补充')
  const tech = engine.messages.filter((m) => m.roleId === 'r2')
  assert.equal(tech.length, 1)
  assert.equal(tech[0].text.startsWith('我的观点'), true)
})

test('moderator: summarize 分支 → phase=done 且有 summary', async () => {
  const { engine } = await setup({
    'dsh-group-chat-moderator-step': JSON.stringify({ action: 'summarize' }),
  })
  engine.start()
  await waitIdle(engine)
  assert.equal(engine.phase, 'done')
  assert.match(engine.summary, /结论/)
})

test('moderator: JSON 非法重试 1 次后回退 least-spoken, 后续正常收敛', async () => {
  const { engine } = await setup({
    'dsh-group-chat-moderator-step': stepScript([
      'not a json', // 第 1 轮 attempt1
      'not a json', // 第 1 轮 attempt2 → 回退 least-spoken
      JSON.stringify({ action: 'host_message', text: '中间串场' }),
      JSON.stringify({ action: 'summarize' }),
    ]),
  })
  engine.start()
  await waitIdle(engine)
  assert.equal(engine.phase, 'done') // 回退后继续，未触发 error
  const spokens = engine.messages.filter((m) => m.roleId === 'r1')
  assert.equal(spokens.length, 1) // least-spoken（初始全 0 → 第一个即 r1）
})

test('moderator: speakTo 非法 → 回退 least-spoken 不报错', async () => {
  const { engine } = await setup({
    'dsh-group-chat-moderator-step': stepScript([
      JSON.stringify({ action: 'speak', speakTo: 'r999', text: '' }),
      JSON.stringify({ action: 'speak', speakTo: 'r999', text: '' }),
      JSON.stringify({ action: 'summarize' }),
    ]),
  })
  engine.start()
  await waitIdle(engine)
  assert.equal(engine.phase, 'done')
  assert.ok(engine.messages.some((m) => m.roleId === 'r1' && m.text !== ''))
})

test('moderator: 连续 3 次调度失败（含回退）→ phase=error 保留历史', async () => {
  const { engine } = await setup({
    'dsh-group-chat-moderator-step': () => 'garbage',
  })
  engine.start()
  await waitIdle(engine)
  assert.equal(engine.phase, 'error')
  assert.match(engine.error, /调度失败/)
  // 三次回退发言保留在历史中
  assert.ok(engine.messages.filter((m) => m.roleId === 'r1').length >= 1)
})

test('moderator: 同一成员可被多次点名；某成员可全程不发言', async () => {
  const { engine } = await setup({
    'dsh-group-chat-moderator-step': stepScript([
      JSON.stringify({ action: 'speak', speakTo: 'r1', instruction: '' }),
      JSON.stringify({ action: 'speak', speakTo: 'r1', instruction: '' }),
      JSON.stringify({ action: 'summarize' }),
    ]),
  })
  engine.start()
  await waitIdle(engine)
  assert.equal(engine.phase, 'done')
  assert.equal(engine.messages.filter((m) => m.roleId === 'r1').length, 2)
  assert.equal(engine.messages.filter((m) => m.roleId === 'r2').length, 0)
  assert.equal(engine.messages.filter((m) => m.roleId === 'r3').length, 0)
})

test('moderator: 隐藏上限（GC_MAX_MODERATOR_TURNS=2）→ 强制总结', async () => {
  // 本测试在独立子进程跑（上限环境变量在模块加载时读取）
  const { spawnSync } = await import('node:child_process')
  const res = spawnSync(process.execPath, ['--test', 'max-turns.case.mjs'], {
    cwd: new URL('.', import.meta.url).pathname,
    env: { ...process.env, GC_MAX_MODERATOR_TURNS: '2' },
    encoding: 'utf8',
  })
  assert.equal(res.status, 0, res.stdout + res.stderr)
})
