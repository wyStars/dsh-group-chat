/**
 * 角色生成单测：{host, roles} 合法 / 旧数组兼容 / host 缺失兜底 / roles 空报错 /
 * 名称去重 / 数量容忍。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeLlm, makeSubagents, makeEngine, defaultHandlers, waitIdle } from './helpers.mjs'

test('generateRoles: 合法 {host, roles} → host/roles 正确, phase=idle', async () => {
  const llm = makeLlm(defaultHandlers())
  const engine = makeEngine({ llm, subagents: makeSubagents() })
  await engine.generateRoles('设计一款家庭记账 App')
  assert.equal(engine.phase, 'idle')
  assert.equal(engine.host.id, 'host')
  assert.equal(engine.host.name, '主持人')
  assert.equal(engine.roles.length, 3)
  assert.deepEqual(engine.roles.map((r) => r.id), ['r1', 'r2', 'r3'])
})

test('generateRoles: 旧格式纯数组 → roles 生效, host 用默认主持人', async () => {
  const llm = makeLlm(defaultHandlers({
    'dsh-group-chat-generate-roles': JSON.stringify([
      { name: '专家A', persona: 'A 的人设', duty: 'A 的职责' },
      { name: '专家B', persona: 'B 的人设', duty: 'B 的职责' },
    ]),
  }))
  const engine = makeEngine({ llm, subagents: makeSubagents() })
  await engine.generateRoles('测试任务')
  assert.equal(engine.phase, 'idle')
  assert.equal(engine.roles.length, 2)
  assert.equal(engine.host.name, '主持人') // DEFAULT_MODERATOR 名称
  assert.equal(engine.host.id, 'host')
})

test('generateRoles: host 缺失（只有 roles）→ 默认主持人兜底', async () => {
  const llm = makeLlm(defaultHandlers({
    'dsh-group-chat-generate-roles': JSON.stringify({
      roles: [{ name: '专家A', persona: 'A', duty: 'd' }],
    }),
  }))
  const engine = makeEngine({ llm, subagents: makeSubagents() })
  await engine.generateRoles('测试任务')
  assert.equal(engine.phase, 'idle')
  assert.equal(engine.host.name, '主持人')
})

test('generateRoles: host 字段非法 → 默认主持人兜底', async () => {
  const llm = makeLlm(defaultHandlers({
    'dsh-group-chat-generate-roles': JSON.stringify({
      host: { name: '' },
      roles: [{ name: '专家A', persona: 'A', duty: 'd' }],
    }),
  }))
  const engine = makeEngine({ llm, subagents: makeSubagents() })
  await engine.generateRoles('测试任务')
  assert.equal(engine.host.name, '主持人')
})

test('generateRoles: roles 为空 → phase=error', async () => {
  const llm = makeLlm(defaultHandlers({
    'dsh-group-chat-generate-roles': JSON.stringify({ host: { name: '主持人', persona: 'p' }, roles: [] }),
  }))
  const engine = makeEngine({ llm, subagents: makeSubagents() })
  await engine.generateRoles('测试任务')
  assert.equal(engine.phase, 'error')
  assert.match(engine.error, /角色列表为空/)
})

test('generateRoles: 两次非法 JSON → phase=error', async () => {
  let n = 0
  const llm = makeLlm({
    'dsh-group-chat-generate-roles': () => { n += 1; return 'no json here' },
  })
  const engine = makeEngine({ llm, subagents: makeSubagents() })
  await engine.generateRoles('测试任务')
  assert.equal(n, 2)
  assert.equal(engine.phase, 'error')
})

test('generateRoles: 名称去重 + 容忍截断 8 个', async () => {
  const roles = []
  for (let i = 1; i <= 10; i += 1) {
    roles.push(i === 3 ? { name: '专家A', persona: `p${i}` } : { name: `专家${i}`, persona: `p${i}` })
  }
  const llm = makeLlm(defaultHandlers({
    'dsh-group-chat-generate-roles': JSON.stringify({ host: { name: '主持人', persona: 'p' }, roles }),
  }))
  const engine = makeEngine({ llm, subagents: makeSubagents() })
  await engine.generateRoles('测试任务')
  assert.equal(engine.phase, 'idle')
  assert.equal(engine.roles.length, 8) // 10 → 去重 1 → 截断 8（"专家3" 与 "专家A" 重名算 1 个）
  assert.ok(!engine.roles.some((r) => r.name === '专家3'))
})

test('generateRoles: 讨论中拒绝重新生成', async () => {
  const llm = makeLlm(defaultHandlers())
  const engine = makeEngine({ llm, subagents: makeSubagents() })
  await engine.generateRoles('测试任务')
  engine.start()
  await assert.rejects(() => engine.generateRoles('新任务'), /请先停止/)
  await waitIdle(engine)
})

test('updateRoles: 仅专家，主持人不受影响', async () => {
  const llm = makeLlm(defaultHandlers())
  const engine = makeEngine({ llm, subagents: makeSubagents() })
  await engine.generateRoles('测试任务')
  engine.updateRoles([{ id: 'r1', name: '改名专家', persona: 'X', duty: '' }])
  assert.equal(engine.roles.length, 1)
  assert.equal(engine.roles[0].id, 'r1')
  assert.equal(engine.roles[0].name, '改名专家')
  assert.equal(engine.host.name, '主持人') // host 未被动过
})

test('reroll: host 被拒绝（无效果）', async () => {
  const llm = makeLlm(defaultHandlers())
  const engine = makeEngine({ llm, subagents: makeSubagents() })
  await engine.generateRoles('测试任务')
  const before = engine.messages.length
  engine.reroll('host')
  assert.equal(engine.messages.length, before)
})
