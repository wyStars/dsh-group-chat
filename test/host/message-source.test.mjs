import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pluginMessageSource, sessionFormatVersion } from '../../lib/message-source.js'

/** 构造只带会话 header 的 agent 替身。 */
function agentAt(version) {
  return { session: { header: { version } } }
}

test('v4 会话：source.kind 由生产者自持，不再使用 plugin 包装', () => {
  const source = pluginMessageSource(agentAt(4), { form: 'notice', summary: 'group-chat done' })
  assert.equal(source.kind, 'plugin:dsh-group-chat')
  assert.notEqual(source.kind, 'plugin')
  assert.equal(source.form, 'notice')
  assert.equal(source.summary, 'group-chat done')
})

test('v3 会话：保留 plugin + 插件名包装', () => {
  const source = pluginMessageSource(agentAt(3), { form: 'notice', summary: 'group-chat done' })
  assert.deepEqual(source, {
    kind: 'plugin',
    plugin: 'dsh-group-chat',
    form: 'notice',
    summary: 'group-chat done',
  })
})

test('读不到会话 header 时按当前主线格式 v4 处理', () => {
  assert.equal(sessionFormatVersion(undefined), 4)
  assert.equal(pluginMessageSource({}, { form: 'notice', summary: 'x' }).kind, 'plugin:dsh-group-chat')
})

test('可从 agent.header 回退读取会话版本', () => {
  assert.equal(sessionFormatVersion({ header: { version: 3 } }), 3)
})
