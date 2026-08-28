/**
 * @dsh-external/dsh-group-chat — client 群聊面板 v2。
 *
 * 交互形态（基于会话的群聊，不隔离会话）：
 *  - 指令呼起：主会话输入 /group-chat <任务>（host 命令）→ 引擎建团并自动讨论，
 *    client 后台轮询感知活动后自动打开右侧竖长面板
 *  - 右侧竖长停靠面板（shell.overlay，无全屏遮罩）：紧凑头部 + 可折叠设置区 +
 *    消息流 + 底部参与输入框（用户可插话，角色会回应）
 *  - 会话头部「群聊」按钮保留（打开面板查看/管理）
 *
 * 与 host 通信：同源 fetch（webServer /dsh-group-chat 前缀路由）：
 *  - GET  /api/state —— 轮询快照（打开 500ms / 后台 2s，版本去重）
 *  - POST /api/<action> —— generate-roles/start/pause/resume/skip/stop/reroll/
 *    update-roles/sync-rounds/chat/export-md
 */

import { createElement as h, useState, useEffect, useRef, useCallback } from 'react'

/* ───────────────────────── 共享 bus（入口 ↔ 面板 ↔ 自动探测） ───────────────────────── */

const bus = {
  open: false,
  sessionId: '',
  listeners: new Set(),
}

function subscribeBus(fn) {
  bus.listeners.add(fn)
  return () => bus.listeners.delete(fn)
}

function dispatchBus() {
  for (const fn of bus.listeners) { try { fn() } catch { /* ignore */ } }
}

function openPanel(sessionId) {
  if (sessionId) bus.sessionId = sessionId
  bus.open = true
  dispatchBus()
}

function closePanel() {
  bus.open = false
  dispatchBus()
}

/* ───────────────────────── Host API ───────────────────────── */

const API = '/dsh-group-chat/api'

async function fetchState() {
  const res = await fetch(API + '/state', { cache: 'no-store' })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

async function postAction(action, extra = {}) {
  const res = await fetch(API + '/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: bus.sessionId, ...extra }),
  })
  const data = await res.json().catch(() => ({ ok: false }))
  if (!res.ok || data.ok !== true) {
    throw new Error((data && data.error) || '请求失败（' + res.status + '）')
  }
  return data
}

/* ───────────────────────── 样式 ───────────────────────── */

const STYLE_ID = 'dsh-group-chat-style'
const CSS = `
.dshgc-trigger {
  min-height: 28px; color: var(--dsw-alias-label-tertiary, #888);
  cursor: pointer; background: none; border: 0; border-radius: 6px;
  align-items: center; gap: 6px; padding: 3px 8px; font-size: 12px;
  line-height: 18px; display: inline-flex; font-family: inherit;
}
.dshgc-trigger:hover, .dshgc-trigger:focus-visible { color: var(--dsw-alias-label-secondary, #aaa); background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06)); }

/* 右侧竖长停靠面板（无全屏遮罩；shell.overlay 层默认 click-through，此处 opt-in） */
.dshgc-overlay {
  position: fixed; top: 52px; right: 12px; bottom: 12px;
  width: 380px; max-width: calc(100vw - 24px);
  z-index: 95; display: flex; pointer-events: auto;
}
.dshgc-panel {
  width: 100%; box-sizing: border-box; display: flex; flex-direction: column;
  background: var(--dsw-specific-menu, #1c1e24); color: var(--dsw-alias-label-primary, #eee);
  border: 1px solid var(--dsw-alias-border-l2, #333); border-radius: 14px;
  box-shadow: var(--dsw-shadow-lv3, 0 8px 32px rgba(0,0,0,.4));
  overflow: hidden; font-size: 13px; line-height: 20px; min-height: 0;
}
.dshgc-head { flex: none; display: flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 10px 0 12px; border-bottom: 1px solid var(--dsw-alias-border-l2, #333); }
.dshgc-title { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.dshgc-taskMini { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 400; color: var(--dsw-alias-label-tertiary, #888); font-size: 11px; }
.dshgc-badge { background: var(--dsw-alias-button-ghost-active-fill, rgba(0,0,0,.12)); color: var(--dsw-alias-label-caption, #999); border-radius: 10px; padding: 0 8px; font-size: 10px; line-height: 18px; flex: none; }
.dshgc-iconbtn { color: var(--dsw-alias-label-tertiary, #888); background: none; border: 0; cursor: pointer; font-size: 13px; padding: 2px 6px; border-radius: 6px; flex: none; }
.dshgc-iconbtn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.07)); }
.dshgc-close { font-size: 16px; }

/* 设置区（可折叠） */
.dshgc-settings { flex: none; border-bottom: 1px solid var(--dsw-alias-border-l2, #333); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; max-height: 45%; }
.dshgc-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--dsw-alias-label-caption, #999); margin: 0 0 4px; }
.dshgc-textarea { width: 100%; box-sizing: border-box; min-height: 56px; resize: vertical; border: 1px solid var(--dsw-alias-border-l2, #333); border-radius: 8px; background: transparent; color: inherit; padding: 6px 8px; font: inherit; font-size: 12px; }
.dshgc-textarea:focus { outline: 1px solid var(--dsw-alias-state-business-primary, #4a8); }
.dshgc-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dshgc-btn { border: 1px solid var(--dsw-alias-border-l2, #333); background: transparent; color: var(--dsw-alias-label-secondary, #bbb); border-radius: 8px; padding: 4px 10px; font: inherit; font-size: 11px; cursor: pointer; }
.dshgc-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.07)); }
.dshgc-btn:disabled { opacity: .4; cursor: default; }
.dshgc-btn-primary { border-color: var(--dsw-alias-state-business-primary, #4a8); color: var(--dsw-alias-state-business-primary, #4a8); }
.dshgc-btn-danger { border-color: var(--dsw-alias-state-error-primary, #c55); color: var(--dsw-alias-state-error-primary, #c55); }
.dshgc-num { width: 48px; border: 1px solid var(--dsw-alias-border-l2, #333); border-radius: 6px; background: transparent; color: inherit; padding: 3px 6px; font: inherit; font-size: 11px; text-align: center; }
.dshgc-roles { display: flex; flex-wrap: wrap; gap: 4px; }
.dshgc-roleChip { flex: none; display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--dsw-alias-border-l2, #333); border-radius: 999px; padding: 1px 6px 1px 3px; font-size: 11px; }
.dshgc-avatar { flex: none; width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; color: #10121a; }
.dshgc-roleChip .dshgc-avatar { width: 18px; height: 18px; font-size: 10px; }
.dshgc-roleChip .dshgc-rm { color: var(--dsw-alias-label-tertiary, #888); cursor: pointer; border: 0; background: none; padding: 0 2px; font-size: 11px; }
.dshgc-roleForm { display: flex; flex-direction: column; gap: 4px; border: 1px dashed var(--dsw-alias-border-l2, #333); border-radius: 8px; padding: 6px 8px; }
.dshgc-input { border: 1px solid var(--dsw-alias-border-l2, #333); border-radius: 6px; background: transparent; color: inherit; padding: 3px 8px; font: inherit; font-size: 11px; }

/* 消息区（竖长：flex-1 滚动） */
.dshgc-msgs { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; overflow-y: auto; }
.dshgc-msg { display: flex; align-items: flex-start; gap: 6px; }
.dshgc-msgBody { min-width: 0; flex: 1; }
.dshgc-msgName { font-size: 10px; font-weight: 600; color: var(--dsw-alias-label-tertiary, #888); margin-bottom: 1px; }
.dshgc-msgText { white-space: pre-wrap; word-break: break-word; font-size: 12px; color: var(--dsw-alias-label-primary, #eee); }
.dshgc-msgText[data-failed='true'] { color: var(--dsw-alias-state-error-primary, #c55); }
.dshgc-typing { color: var(--dsw-alias-label-tertiary, #888); font-size: 11px; font-style: italic; padding: 2px 0; }
.dshgc-empty { color: var(--dsw-alias-label-tertiary, #888); text-align: center; padding: 18px 0; font-size: 12px; }
.dshgc-error { color: var(--dsw-alias-state-error-primary, #c55); font-size: 11px; padding: 0 12px; }
.dshgc-offline { color: var(--dsw-alias-state-warn-label, #da4); font-size: 11px; padding: 0 12px; }
.dshgc-notice { font-size: 11px; padding: 0 12px; }
.dshgc-summary { white-space: pre-wrap; word-break: break-word; font-size: 11.5px; }
.dshgc-path { color: var(--dsw-alias-label-tertiary, #888); font-size: 10px; word-break: break-all; }
.dshgc-section { flex: none; padding: 8px 12px; border-top: 1px solid var(--dsw-alias-border-l2, #333); max-height: 38%; overflow-y: auto; }

/* 底部参与输入框 */
.dshgc-compose { flex: none; border-top: 1px solid var(--dsw-alias-border-l2, #333); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.dshgc-compose-input { width: 100%; box-sizing: border-box; min-height: 38px; max-height: 120px; resize: none; border: 1px solid var(--dsw-alias-border-l2, #333); border-radius: 10px; background: transparent; color: inherit; padding: 7px 10px; font: inherit; font-size: 12px; }
.dshgc-compose-input:focus { outline: 1px solid var(--dsw-alias-state-business-primary, #4a8); }
.dshgc-compose-row { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
.dshgc-compose-hint { margin-right: auto; color: var(--dsw-alias-label-tertiary, #888); font-size: 10px; }
`

function adoptStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.plugin = '@dsh-external/dsh-group-chat'
  style.textContent = CSS
  document.head.appendChild(style)
}

/* ───────────────────────── 小部件 ───────────────────────── */

const AVATAR_COLORS = ['#5ad1a6', '#6ab0f3', '#f3b562', '#e88a8a', '#b48cf2', '#7dd3a8', '#f2a06b', '#89c2f0']

function avatarColor(roleId) {
  if (!roleId) return '#999'
  const m = /(\d+)/.exec(roleId)
  const index = m ? Number(m[1]) : 0
  return AVATAR_COLORS[index % AVATAR_COLORS.length]
}

function roleInitial(name) {
  return String(name || '?').slice(0, 1).toUpperCase()
}

const PHASE_LABEL = {
  idle: '待命',
  'generating-roles': '拉群中',
  discussing: '讨论中',
  summarizing: '总结中',
  done: '已完成',
  error: '出错',
}

/* ───────────────────────── 入口按钮 ───────────────────────── */

function HeaderAction({ sessionId }) {
  useEffect(() => {
    if (sessionId) bus.sessionId = sessionId
  }, [sessionId])
  return h('button', {
    className: 'dshgc-trigger',
    title: '多角色群聊：基于会话发起群聊（也可用 /group-chat <任务> 指令呼起）',
    onClick: () => openPanel(sessionId),
  }, '💬', h('span', null, '群聊'))
}

/* ───────────────────────── 面板 ───────────────────────── */

function Panel() {
  const [, setOpenTick] = useState(0)
  const [snap, setSnap] = useState(null)
  const [offline, setOffline] = useState(false)
  const [draft, setDraft] = useState('')
  const [rounds, setRounds] = useState(3)
  const [compose, setCompose] = useState('')
  const [notice, setNotice] = useState('')
  const [generating, setGenerating] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showRoleForm, setShowRoleForm] = useState(false)
  const [roleDraft, setRoleDraft] = useState({ name: '', persona: '', duty: '' })
  const msgsRef = useRef(null)

  useEffect(() => subscribeBus(() => setOpenTick((n) => n + 1)), [])
  useEffect(() => { adoptStyles() }, [])

  // 打开时 500ms 轮询快照（版本去重）
  useEffect(() => {
    if (!bus.open) return
    let alive = true
    let last = 0
    const tick = async () => {
      try {
        const snapNow = await fetchState()
        if (!alive) return
        setOffline(false)
        setGenerating(snapNow.phase === 'generating-roles')
        if (snapNow.version !== last) {
          last = snapNow.version
          setSnap(snapNow)
        }
      } catch {
        if (alive) setOffline(true)
      }
    }
    tick()
    const timer = setInterval(tick, 500)
    return () => { alive = false; clearInterval(timer) }
  }, [bus.open])

  // 新消息自动滚动到底
  useEffect(() => {
    const el = msgsRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [snap && snap.version])

  useEffect(() => {
    if (snap && snap.task && draft === '') setDraft(snap.task)
  }, [snap, draft])

  const phase = snap ? snap.phase : 'idle'
  const roles = snap ? snap.roles : []
  const messages = snap ? snap.messages : []

  const run = useCallback(async (fn, okText) => {
    setNotice('')
    try {
      await fn()
      if (okText) setNotice(okText)
    } catch (err) {
      setNotice('操作失败：' + String(err && err.message ? err.message : err).slice(0, 160))
    }
  }, [])

  const send = useCallback(() => {
    const text = compose.trim()
    if (text === '') return
    setCompose('')
    void run(() => postAction('chat', { text }), '')
  }, [compose, run])

  const canGenerate = phase !== 'discussing' && phase !== 'generating-roles' && phase !== 'summarizing'
  const inDiscuss = phase === 'discussing'
  const paused = inDiscuss && snap && snap.paused === true

  const controls = h('div', { className: 'dshgc-row' },
    (phase === 'idle' || phase === 'done' || phase === 'error') && roles.length > 0
      ? h('button', {
          className: 'dshgc-btn dshgc-btn-primary',
          disabled: offline,
          onClick: () => run(async () => {
            await postAction('sync-rounds', { rounds })
            await postAction('start')
          }),
        }, '▶ 开始讨论')
      : null,
    inDiscuss && !paused
      ? h('button', { className: 'dshgc-btn', onClick: () => run(() => postAction('pause')) }, '⏸ 暂停')
      : null,
    inDiscuss && paused
      ? h('button', { className: 'dshgc-btn dshgc-btn-primary', onClick: () => run(() => postAction('resume')) }, '▶ 继续')
      : null,
    inDiscuss
      ? h('button', { className: 'dshgc-btn', onClick: () => run(() => postAction('skip')) }, '⏭ 跳过')
      : null,
    inDiscuss
      ? h('button', { className: 'dshgc-btn dshgc-btn-danger', onClick: () => run(() => postAction('stop')) }, '■ 停止')
      : null,
    messages.length > 0
      ? h('button', { className: 'dshgc-btn', onClick: () => run(() => postAction('export-md')) }, '📄 导出 MD')
      : null,
  )

  return h('div', { className: 'dshgc-overlay' },
    h('div', { className: 'dshgc-panel' },
      h('div', { className: 'dshgc-head' },
        h('span', { className: 'dshgc-avatar', style: { background: '#6ab0f3' } }, '💬'),
        h('div', { className: 'dshgc-title' },
          '群聊讨论',
          h('span', { className: 'dshgc-taskMini' }, (snap && snap.task) ? '· ' + snap.task.slice(0, 26) : ''),
        ),
        h('span', { className: 'dshgc-badge' }, PHASE_LABEL[phase] || phase),
        h('button', {
          className: 'dshgc-iconbtn',
          title: showSettings ? '收起设置' : '任务与角色设置',
          onClick: () => setShowSettings((v) => !v),
        }, showSettings ? '▾' : '⚙'),
        h('button', { className: 'dshgc-iconbtn dshgc-close', onClick: closePanel, title: '收起面板' }, '×'),
      ),

      showSettings
        ? h('div', { className: 'dshgc-settings' },
            offline
              ? h('div', { className: 'dshgc-offline' }, '⚠ 与群聊服务断开（插件可能已卸载/重载）')
              : null,
            notice
              ? h('div', { className: 'dshgc-notice' }, notice)
              : null,
            h('div', { className: 'dshgc-label' }, '任务 / 设计需求'),
            h('textarea', {
              className: 'dshgc-textarea',
              placeholder: '输入任务或设计方案…',
              value: draft,
              disabled: inDiscuss || generating,
              onChange: (e) => setDraft(e.target.value),
            }),
            h('div', { className: 'dshgc-row' },
              h('label', null, '轮数'),
              h('input', {
                className: 'dshgc-num',
                type: 'number', min: 1, max: 10, value: rounds,
                onChange: (e) => setRounds(Math.max(1, Math.min(10, Number(e.target.value) || 1))),
              }),
              h('button', {
                className: 'dshgc-btn dshgc-btn-primary',
                disabled: !canGenerate || offline || (draft.trim() === ''),
                onClick: () => run(async () => {
                  setNotice('正在生成角色团队…')
                  await postAction('generate-roles', { task: draft, rounds })
                  setNotice('')
                }),
              }, generating ? '⏳ 生成中…' : '✨ 生成角色团队'),
            ),
            roles.length > 0
              ? h('div', {},
                  h('div', { className: 'dshgc-label' }, `角色团队（${roles.length}）`),
                  h('div', { className: 'dshgc-roles' },
                    roles.map((r) => h('span', { className: 'dshgc-roleChip', key: r.id, title: (r.duty ? '【' + r.duty + '】' : '') + r.persona },
                      h('span', { className: 'dshgc-avatar', style: { background: avatarColor(r.id) } }, roleInitial(r.name)),
                      r.name,
                      h('button', {
                        className: 'dshgc-rm', title: '让 TA 重新发言',
                        onClick: (e) => { e.stopPropagation(); void run(() => postAction('reroll', { roleId: r.id })) },
                      }, '↻'),
                      h('button', {
                        className: 'dshgc-rm', title: '删除该角色',
                        disabled: inDiscuss,
                        onClick: (e) => { e.stopPropagation(); void run(() => postAction('update-roles', { roles: roles.filter((x) => x.id !== r.id) })) },
                      }, '✕'),
                    )),
                    showRoleForm
                      ? h('span', { className: 'dshgc-roleForm' },
                          h('input', { className: 'dshgc-input', placeholder: '角色名', value: roleDraft.name, onChange: (e) => setRoleDraft({ ...roleDraft, name: e.target.value }) }),
                          h('input', { className: 'dshgc-input', placeholder: 'persona 定位…', value: roleDraft.persona, onChange: (e) => setRoleDraft({ ...roleDraft, persona: e.target.value }) }),
                          h('input', { className: 'dshgc-input', placeholder: '职责（可选）', value: roleDraft.duty, onChange: (e) => setRoleDraft({ ...roleDraft, duty: e.target.value }) }),
                          h('div', { className: 'dshgc-row' },
                            h('button', { className: 'dshgc-btn dshgc-btn-primary', disabled: roleDraft.name.trim() === '' || roleDraft.persona.trim() === '', onClick: () => run(async () => {
                              await postAction('update-roles', { roles: [...roles, { id: 'r' + (roles.length + 1), name: roleDraft.name.trim(), persona: roleDraft.persona.trim(), duty: roleDraft.duty.trim() }] })
                              setRoleDraft({ name: '', persona: '', duty: '' })
                              setShowRoleForm(false)
                            }) }, '添加'),
                            h('button', { className: 'dshgc-btn', onClick: () => { setShowRoleForm(false); setRoleDraft({ name: '', persona: '', duty: '' }) } }, '取消'),
                          ),
                        )
                      : h('button', { className: 'dshgc-btn', disabled: inDiscuss, onClick: () => setShowRoleForm(true) }, '+ 加角色'),
                  ),
                )
              : null,
            h('div', { className: 'dshgc-row' },
              h('button', {
                className: 'dshgc-btn',
                disabled: !canGenerate || offline,
                onClick: () => run(() => postAction('generate-roles', { task: snap ? snap.task : draft, rounds })),
              }, '🔄 重新生成'),
            ),
          )
        : null,

      h('div', { className: 'dshgc-msgs', ref: msgsRef },
        messages.length === 0
          ? h('div', { className: 'dshgc-empty' },
              inDiscuss ? '讨论准备中…'
                : (generating ? '正在生成角色团队…' : '暂无发言。\n主会话输入 /group-chat <任务>，或点 ⚙ 配置任务后开始。'))
          : null,
        messages.map((m) => h('div', { className: 'dshgc-msg', key: m.id },
          h('span', {
            className: 'dshgc-avatar',
            style: { background: m.roleId === 'user' ? '#e88a8a' : avatarColor(m.roleId) },
          }, roleInitial(m.name)),
          h('div', { className: 'dshgc-msgBody' },
            h('div', { className: 'dshgc-msgName' }, m.name),
            h('div', { className: 'dshgc-msgText', 'data-failed': String(m.failed === true) }, m.text),
          ),
        )),
        inDiscuss && snap && snap.streamingRoleId
          ? h('div', { className: 'dshgc-typing' }, '● ' + roleName(snap, snap.streamingRoleId) + ' 正在输入…')
          : null,
      ),

      snap && snap.error
        ? h('div', { className: 'dshgc-error' }, '⚠ ' + snap.error)
        : null,
      offline
        ? h('div', { className: 'dshgc-offline' }, '⚠ 已与群聊服务断开')
        : null,

      (roles.length > 0 || messages.length > 0 || inDiscuss)
        ? h('div', { className: 'dshgc-section' }, controls)
        : null,

      h('div', { className: 'dshgc-compose' },
        h('textarea', {
          className: 'dshgc-compose-input',
          placeholder: '以主持人身份参与讨论：输入你的意见，点发送，角色会回应你…',
          value: compose,
          onChange: (e) => setCompose(e.target.value),
          onKeyDown: (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
          },
        }),
        h('div', { className: 'dshgc-compose-row' },
          h('span', { className: 'dshgc-compose-hint' }, 'Enter 发送 · Shift+Enter 换行'),
          h('button', {
            className: 'dshgc-btn dshgc-btn-primary',
            disabled: offline || compose.trim() === '',
            onClick: send,
          }, '发送'),
        ),
      ),

      snap && snap.summary
        ? h('div', { className: 'dshgc-section' },
            h('div', { className: 'dshgc-label' }, '结论'),
            h('div', { className: 'dshgc-summary' }, snap.summary),
            snap.mdPath
              ? h('div', { className: 'dshgc-path' }, '已保存：' + snap.mdPath)
              : null,
          )
        : null,
    ),
  )
}

function roleName(snap, roleId) {
  const r = snap.roles.find((x) => x.id === roleId)
  return r ? r.name : '?'
}

/* ───────────────────────── 注册与自动探测 ───────────────────────── */

function OverlayHost() {
  const [tick, setTick] = useState(0)
  useEffect(() => subscribeBus(() => setTick((n) => n + 1)), [])

  // 后台探测：面板关闭时低频轮询；检测到活动（指令呼起 / 引擎被操作）→ 自动打开面板
  useEffect(() => {
    let alive = true
    let seenVersion = 0
    const tick = async () => {
      if (bus.open) return
      try {
        const s = await fetchState()
        if (!alive || bus.open) return
        if (s.phase === 'discussing' || s.phase === 'generating-roles' || s.phase === 'summarizing') {
          openPanel(bus.sessionId)
        }
      } catch { /* host 不可达：静默 */ }
    }
    tick()
    const timer = setInterval(tick, 2000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  void tick
  if (!bus.open) return null
  // 必须以元素形式渲染 Panel（组件自带 hooks）：直接调用 Panel() 会把其 hooks
  // 计入 OverlayHost，bus.open 切换时 hooks 数量跳变 → React #310 崩溃。
  return h(Panel, null)
}

export const inject = ['slots']

export function apply(ctx) {
  adoptStyles()
  ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'dsh-group-chat-open',
      order: 30,
    }, HeaderAction),
  ), '@dsh-external/dsh-group-chat: header action')
  ctx.effect(() => ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({
      name: 'shell.overlay',
      id: 'dsh-group-chat-panel',
      order: 90,
    }, OverlayHost),
  ), '@dsh-external/dsh-group-chat: overlay panel')
}
