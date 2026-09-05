/**
 * Deep 超时回退：GC_DEEP_TIMEOUT_MS=100 时，挂起的 subagent 超时后被 interrupt，
 * 按设计 §6.4 回退 direct（成员仍发言，不因超时放弃）。
 * 独立子进程（超时环境变量在引擎模块加载时读取）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeLlm, makeSubagents, makeEngine, defaultHandlers, waitIdle, stepScript } from './helpers.mjs'

test('deep 超时 → interrupt subagent, 回退 direct 发言', async () => {
  const llm = makeLlm(defaultHandlers({
    'dsh-group-chat-moderator-step': stepScript([
      JSON.stringify({ action: 'speak', speakTo: 'r1' }),
      JSON.stringify({ action: 'summarize' }),
    ]),
    'dsh-group-chat-member-plan': JSON.stringify({ mode: 'deep', subagentTask: '分析' }),
  }))
  const subagents = makeSubagents({ behavior: 'hang' })
  const engine = makeEngine({ llm, subagents })
  await engine.generateRoles('测试任务')
  engine.start()
  await waitIdle(engine, 10000)
  assert.equal(engine.phase, 'done')
  assert.equal(subagents.started.length, 1)
  // 超时（约 100ms）后回退 direct：r1 仍有一次正式发言
  const r1 = engine.messages.filter((m) => m.roleId === 'r1')
  assert.ok(r1.length >= 1, '超时后成员应回退 direct 发言，而非放弃')
  assert.equal(engine.deepThinkingRoleId, null)
  assert.equal(engine.error, '')
})
