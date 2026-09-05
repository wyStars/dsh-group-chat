/**
 * 隐藏调度上限：GC_MAX_MODERATOR_TURNS=2 时讨论两轮后强制 summarize（独立子进程）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeLlm, makeSubagents, makeEngine, defaultHandlers, waitIdle } from './helpers.mjs'

test('达到隐藏上限后强制总结（不依赖主持人 summarize 决策）', async () => {
  const llm = makeLlm(defaultHandlers({
    // 主持人永不主动总结（永远 host_message），验证上限强制 summarize
    'dsh-group-chat-moderator-step': JSON.stringify({ action: 'host_message', text: '继续' }),
  }))
  const engine = makeEngine({ llm, subagents: makeSubagents() })
  await engine.generateRoles('测试任务')
  engine.start()
  await waitIdle(engine)
  assert.equal(engine.phase, 'done')
  assert.equal(engine.turn, 2)
  assert.match(engine.summary, /结论/)
  assert.equal(engine.messages.filter((m) => m.roleId === 'host').length, 2)
})
