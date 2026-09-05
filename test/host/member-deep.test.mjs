/**
 * 成员自主判断 + deep 推理管线单测：direct / deep / 非法回退 / subagent 不可用 /
 * start 抛错 / 非 completed / 空结果 / 开关关闭 / deep 中 skip。
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

test('member plan: deep + subagent 成功 → start 受调, 素材进入整理发言上下文', async () => {
  const { llm, subagents, engine } = await setup({
    'dsh-group-chat-moderator-step': stepScript([
      JSON.stringify({ action: 'speak', speakTo: 'r1', instruction: '重点分析落地成本与风险' }),
      JSON.stringify({ action: 'summarize' }),
    ]),
    'dsh-group-chat-member-plan': JSON.stringify({
      mode: 'deep', subagentTask: '请深入分析该方案在中小团队中的落地成本、风险和可替代方案',
    }),
  })
  engine.start()
  await waitIdle(engine)
  assert.equal(subagents.started.length, 1)
  assert.equal(subagents.started[0].name, 'spawn')
  const req = subagents.started[0].request
  assert.equal(req.maxDepth, 1)
  assert.equal(req.agentOptions.provider, 'mock')
  const prompt = req.prompt[0].text
  assert.match(prompt, /落地成本、风险和可替代方案/)
  assert.match(prompt, /产品专家/)
  assert.equal(engine.deepThinkingRoleId, null) // 结束后清除
  // 最终发言为流式整理（含素材素材字符串之一部——fake speak 输出固定文本，确认走 speak）
  const msg = engine.messages.find((m) => m.roleId === 'r1')
  assert.ok(msg && msg.text.startsWith('我的观点'))
})

test('member plan: direct → 不调用 subagents.start', async () => {
  const { subagents, engine } = await setup()
  engine.start()
  await waitIdle(engine)
  assert.equal(subagents.started.length, 0)
})

test('member plan: 非法 JSON → 回退 direct, 不调用 subagents.start', async () => {
  const { subagents, engine } = await setup({
    'dsh-group-chat-moderator-step': stepScript([
      JSON.stringify({ action: 'speak', speakTo: 'r1' }),
      JSON.stringify({ action: 'summarize' }),
    ]),
    'dsh-group-chat-member-plan': () => 'not json',
  })
  engine.start()
  await waitIdle(engine)
  assert.equal(subagents.started.length, 0)
  assert.ok(engine.messages.some((m) => m.roleId === 'r1'))
})

test('member plan: deep 但缺 subagentTask → 回退 direct', async () => {
  const { subagents, engine } = await setup({
    'dsh-group-chat-member-plan': JSON.stringify({ mode: 'deep' }),
  })
  engine.start()
  await waitIdle(engine)
  assert.equal(subagents.started.length, 0)
})

test('deep: subagents 服务不可用 → 回退 direct 不报错', async () => {
  const llm = makeLlm(defaultHandlers({
    'dsh-group-chat-moderator-step': stepScript([
      JSON.stringify({ action: 'speak', speakTo: 'r1' }),
      JSON.stringify({ action: 'summarize' }),
    ]),
    'dsh-group-chat-member-plan': JSON.stringify({ mode: 'deep', subagentTask: '分析' }),
  }))
  const engine = makeEngine({ llm, subagents: undefined })
  await engine.generateRoles('测试任务')
  engine.start()
  await waitIdle(engine)
  assert.notEqual(engine.phase, 'error')
  assert.ok(engine.messages.some((m) => m.roleId === 'r1' && m.text.startsWith('我的观点')))
})

test('deep: subagents.start 抛错 → 回退 direct 不报错', async () => {
  const { engine } = await setup({
    'dsh-group-chat-moderator-step': stepScript([
      JSON.stringify({ action: 'speak', speakTo: 'r1' }),
      JSON.stringify({ action: 'summarize' }),
    ]),
    'dsh-group-chat-member-plan': JSON.stringify({ mode: 'deep', subagentTask: '分析' }),
  }, { behavior: 'throw' })
  engine.start()
  await waitIdle(engine)
  assert.notEqual(engine.phase, 'error')
  assert.ok(engine.messages.some((m) => m.roleId === 'r1' && m.text.startsWith('我的观点')))
})

test('deep: stopReason 非 completed → 回退 direct', async () => {
  const { engine } = await setup({
    'dsh-group-chat-moderator-step': stepScript([
      JSON.stringify({ action: 'speak', speakTo: 'r1' }),
      JSON.stringify({ action: 'summarize' }),
    ]),
    'dsh-group-chat-member-plan': JSON.stringify({ mode: 'deep', subagentTask: '分析' }),
  }, { behavior: 'bad-stop' })
  engine.start()
  await waitIdle(engine)
  assert.notEqual(engine.phase, 'error')
  assert.ok(engine.messages.some((m) => m.roleId === 'r1' && m.text.startsWith('我的观点')))
})

test('deep: 结果为空 → 回退 direct', async () => {
  const { engine } = await setup({
    'dsh-group-chat-moderator-step': stepScript([
      JSON.stringify({ action: 'speak', speakTo: 'r1' }),
      JSON.stringify({ action: 'summarize' }),
    ]),
    'dsh-group-chat-member-plan': JSON.stringify({ mode: 'deep', subagentTask: '分析' }),
  }, { behavior: 'empty' })
  engine.start()
  await waitIdle(engine)
  assert.ok(engine.messages.some((m) => m.roleId === 'r1' && m.text.startsWith('我的观点')))
})

test('allowDeepReasoning=false → 不触发 plan 也不触发 subagent', async () => {
  let planCalls = 0
  const { subagents, engine } = await setup({
    'dsh-group-chat-member-plan': () => { planCalls += 1; return JSON.stringify({ mode: 'deep', subagentTask: '分析' }) },
  })
  engine.allowDeepReasoning = false
  engine.start()
  await waitIdle(engine)
  assert.equal(planCalls, 0)
  assert.equal(subagents.started.length, 0)
})

test('deep 中 skip → abort subagent, 无最终发言, 主持人继续调度', async () => {
  const { subagents, engine } = await setup({
    'dsh-group-chat-moderator-step': stepScript([
      JSON.stringify({ action: 'speak', speakTo: 'r1' }),
      JSON.stringify({ action: 'summarize' }),
    ]),
    'dsh-group-chat-member-plan': JSON.stringify({ mode: 'deep', subagentTask: '分析' }),
  }, { behavior: 'hang' })
  engine.start()
  await waitFor(() => engine.deepThinkingRoleId === 'r1', 3000)
  assert.equal(subagents.started.length, 1)
  engine.skip()
  await waitFor(() => engine.deepThinkingRoleId === null && !engine._loopRunning, 3000)
  // skip 中止 deep → 不发言（hang 的 result 永不完成，_runDeep 因 abort 返回 abortedByUser）
  assert.equal(engine.messages.filter((m) => m.roleId === 'r1').length, 0)
  assert.notEqual(engine.phase, 'error')
})

test('deep 中 stop → abort subagent, phase=done 无残留状态', async () => {
  const { engine } = await setup({
    'dsh-group-chat-moderator-step': stepScript([
      JSON.stringify({ action: 'speak', speakTo: 'r1' }),
      JSON.stringify({ action: 'summarize' }),
    ]),
    'dsh-group-chat-member-plan': JSON.stringify({ mode: 'deep', subagentTask: '分析' }),
  }, { behavior: 'hang' })
  engine.start()
  await waitFor(() => engine.deepThinkingRoleId === 'r1', 3000)
  engine.stop()
  await waitIdle(engine)
  assert.equal(engine.phase, 'done')
  assert.equal(engine.deepThinkingRoleId, null)
  assert.equal(engine.streamingRoleId, null)
})
