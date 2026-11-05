/**
 * @stars-w/dsh-group-chat — 会话消息来源构造（v3 / v4 双格式）。
 *
 * DSH 0.1.x 写会话格式 v3：插件注入的 user 消息 source 必须是
 * `{ kind: 'plugin', plugin: <插件名> }`。DSH 0.2.x 起写格式 v4，要求
 * `source.kind` 由生产者自持且不得为 `'plugin'`；第三方插件的约定值是
 * `plugin:<原插件名>`（见 dsh-session-format-v3-to-v4 的来源映射）。
 * 写错形态会让 append 直接抛 `format v4 message requires a producer-owned
 * source kind`，并让目标会话停在锁定状态，因此按会话版本分支构造。
 */

/** v3 格式中本插件的来源值。 */
const V3_PLUGIN = 'dsh-group-chat'

/**
 * 解析目标会话的格式版本。
 *
 * v3 / v4 的 Session 都公开 `header.version`；读不到时按当前主线格式 v4
 * 处理（0.2.x 起为默认运行环境）。
 *
 * @param {object|undefined} agent 目标会话的 agent（`Agent.session: Session`）。
 * @returns {number} 会话格式版本，正常为 3 或 4。
 */
export function sessionFormatVersion(agent) {
  const version = agent?.session?.header?.version ?? agent?.header?.version
  return typeof version === 'number' ? version : 4
}

/**
 * 构造插件注入消息的 source，按会话格式版本切换 kind 形态。
 *
 * @param {object|undefined} agent 目标会话的 agent（决定版本分支）。
 * @param {{form: string, summary: string}} context 上下文形式字段；v3 / v4
 *   都接纳 `notice` 形式（`summary` 为折叠行的一句话说明）。
 * @returns {object} 当前会话格式可接纳的 source 对象。
 */
export function pluginMessageSource(agent, context) {
  return sessionFormatVersion(agent) >= 4
    ? { kind: `plugin:${V3_PLUGIN}`, ...context }
    : { kind: 'plugin', plugin: V3_PLUGIN, ...context }
}
