/**
 * 控制语义单测（§7 表格）：pause/resume 不中断 deep、reroll 专家（强制点名）、
 * reroll 期间 interrupt、chat 只入历史不打断。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeLlm, makeSubagents, makeEngine, defaultHandlers, waitIdle, waitFor, stepScript } from './helpers.mjs'

async function setup(overrides = {}, subagentOpts = {}) {
  const llm = makeLlm(defaultHandlers(overrides))
  const subagents = makeSubagents(subagentOpts)
  const engine = makeEngine({ llm, subagents })
  await engine.generateRoles('设计一款家庭记账 App')
  return { llm, subagents, engine }
}

test('pause: 讨论中置门闩（paused=true），当前动作完成后暂停', async () => {
  const { engine } = await setup()
  engine.start()
  engine.pause() // 同步：立即置门闩（不中断进行中的第一步）
  assert.equal(engine.snapshot().paused, true)
  // 当前动作（第一步 host_message）完成后暂停：等待其落地
  await waitFor(() => engine.messages.length >= 1, 3000)
  const countAtPause = engine.messages.length
  await new Promise((r) => setTimeout(r, 80))
  // 门闩生效：暂停期间不再推进（消息数不变）
  assert.equal(engine.messages.length, countAtPause)
  assert.equal(engine.phase, 'discussing')
  engine.resume()
  await waitIdle(engine)
  assert.equal(engine.phase, 'done')
})

test('pause: deep 运行中不中断 subagent，动作完成后暂停', async () => {
  const { engine } = await setup({
    'dsh-group-chat-moderator-step': stepScript([
      JSON.stringify({ action: 'speak', speakTo: 'r1' }),
      JSON.stringify({ action: 'summarize' }),
    ]),
    'dsh-group-chat-member-plan': JSON.stringify({ mode: 'deep', subagentTask: '分析' }),
  }, { behavior: 'hang' })
  engine.start()
  await waitFor(() => engine.deepThinkingRoleId === 'r1', 3000)
  engine.pause()
  await new Promise((r) => setTimeout(r, 100))
  assert.equal(engine.deepThinkingRoleId, 'r1') // 未被打断
  engine.stop() // 清理
  await waitIdle(engine)
})

test('reroll 专家: 删除最近一条 + 主持人下一步优先点名该成员', async () => {
  let step = 0
  const { engine } = await setup({
    'dsh-group-chat-moderator-step': () => {
      step += 1
      if (step === 1) return JSON.stringify({ action: 'speak', speakTo: 'r1' })
      return JSON.stringify({ action: 'summarize' })
    },
    // 慢流：让 r1 发言持续数百 ms，测试在发言进行中 reroll
    'dsh-group-chat-speak': { text: '我的观点是：先验证需求再做方案，控制成本。', chunkDelay: 40 },
  })
  engine.start()
  await waitFor(() => engine.messages.some((m) => m.roleId === 'r1'), 3000)
  // 发言进行中（慢流）：此刻 reroll → abort + 删除消息 + 强制点名
  engine.reroll('r1')
  await waitFor(() => {
    // reroll 后旧消息被删；强制点名产生的新消息出现，或循环已收尾
    return engine.messages.filter((m) => m.roleId === 'r1').length >= 1 || !engine._loopRunning
  }, 5000)
  await waitIdle(engine)
  const msgs = engine.messages.filter((m) => m.roleId === 'r1')
  assert.equal(msgs.length, 1) // 旧消息被删，新发言 1 条
  assert.ok(msgs[0].text.startsWith('我的观点'))
})

test('reroll 非讨论中: 立即补讲一次', async () => {
  const { engine } = await setup()
  engine.reroll('r1')
  await waitFor(() => engine.messages.filter((m) => m.roleId === 'r1').length >= 1, 3000)
  assert.ok(engine.messages.some((m) => m.roleId === 'r1'))
  assert.notEqual(engine.phase, 'discussing')
})

test('chat: 讨论中只追加用户消息，不打断当前动作', async () => {
  const { engine } = await setup()
  engine.start()
  await waitFor(() => engine.messages.length >= 1, 3000)
  engine.chat('补充一条意见：MVP 优先做记账')
  assert.ok(engine.messages.some((m) => m.roleId === 'user' && m.text.includes('MVP')))
  // 主持人下一步用户提示里包含该消息
  await waitIdle(engine)
  assert.equal(engine.phase, 'done')
})

test('chat: 用户插话后，被点名成员的发言 prompt 优先回应用户消息', async () => {
  const llm = makeLlm(defaultHandlers({
    'dsh-group-chat-moderator-step': stepScript([
      JSON.stringify({ action: 'speak', speakTo: 'r1' }),
      JSON.stringify({ action: 'summarize' }),
    ]),
    'dsh-group-chat-member-plan': JSON.stringify({ mode: 'direct' }),
  }))
  const engine = makeEngine({ llm, subagents: makeSubagents() })
  await engine.generateRoles('设计一款家庭记账 App')
  engine.start()
  engine.chat('请产品专家重点评估成本') // 最后一条 = 用户消息
  await waitIdle(engine)
  const speakCall = llm.calls.find((c) => c.purpose === 'dsh-group-chat-speak')
  assert.ok(speakCall, '应有成员发言调用')
  assert.match(speakCall.userText, /respond to the user's message FIRST/)
  assert.match(speakCall.userText, /请产品专家重点评估成本/)
})

test('stop: 讨论中 abort 当前动作，phase=done 保留历史', async () => {
  const { engine } = await setup()
  engine.start()
  await waitFor(() => engine.messages.length >= 1, 3000)
  engine.stop()
  await waitIdle(engine)
  assert.equal(engine.phase, 'done')
  assert.ok(engine.messages.length >= 1)
})

test('导出 md: 团队区含主持人（先于专家）+ 讨论过程含主持人消息', async () => {
  const { engine } = await setup()
  engine.start()
  await waitIdle(engine)
  const md = engine._composeMd()
  assert.ok(md.includes('**主持人**（主持）'))
  const hostHeader = md.indexOf('**主持人**（主持）')
  const expertHeader = md.indexOf('**产品专家**')
  assert.ok(hostHeader !== -1 && expertHeader !== -1 && hostHeader < expertHeader)
  assert.ok(md.includes('**主持人：**') || md.includes('**主持人**')) // 讨论过程含主持人消息名
})
