/**
 * @dsh-external/dsh-group-chat — client 群聊面板。
 *
 * 两个 slot 注册点：
 *  - conversation.session.header.actions：会话头部「群聊」入口按钮（打开面板）
 *  - shell.overlay：全宽浮层，群聊主界面（任务输入/角色卡片/消息流/控制/结论）
 *
 * 与 host 通信：同源 fetch（host 经 webServer 注册 /dsh-group-chat 前缀路由）：
 *  - GET /dsh-group-chat/api/state —— 500ms 轮询快照（版本去重）
 *  - POST /dsh-group-chat/api/<action> —— start/pause/resume/skip/stop/reroll/
 *    generate-roles/update-roles/sync-rounds/export-md
 *
 * 构建：tsdown（lib/client.js，ModuleLoader.load 注册）。
 */

import { createElement as h, useState, useEffect, useRef, useCallback } from 'react'

/* ───────────────────────── 共享 bus（按钮 ↔ 面板） ───────────────────────── */

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
.dshgc-overlay {
  position: fixed; inset: 0; z-index: 999; display: flex; align-items: center;
  justify-content: center; background: rgba(10,12,16,.45); backdrop-filter: blur(2px);
}
.dshgc-panel {
  width: min(880px, calc(100vw - 48px)); height: min(760px, calc(100vh - 64px));
  max-width: 100%; box-sizing: border-box; display: flex; flex-direction: column;
  background: var(--dsw-specific-menu, #1c1e24); color: var(--dsw-alias-label-primary, #eee);
  border: 1px solid var(--dsw-alias-border-l2, #333); border-radius: 14px;
  box-shadow: var(--dsw-shadow-lv3, 0 12px 40px rgba(0,0,0,.5));
  overflow: hidden; font-size: 13px; line-height: 20px;
}
.dshgc-head { flex: none; display: flex; align-items: center; justify-content: space-between; min-height: 44px; padding: 0 12px; border-bottom: 1px solid var(--dsw-alias-border-l2, #333); }
.dshgc-title { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.dshgc-badge { background: var(--dsw-alias-button-ghost-active-fill, rgba(0,0,0,.12)); color: var(--dsw-alias-label-caption, #999); border-radius: 10px; padding: 0 8px; font-size: 11px; line-height: 20px; }
.dshgc-close { color: var(--dsw-alias-label-tertiary, #888); cursor: pointer; background: none; border: 0; font-size: 18px; line-height: 24px; padding: 4px 8px; border-radius: 8px; }
.dshgc-close:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.08)); }
.dshgc-body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding: 12px; overflow-y: auto; }
.dshgc-section { flex: none; border: 1px solid var(--dsw-alias-border-l2, #333); border-radius: 12px; padding: 12px; background: var(--dsw-alias-bg-base, transparent); }
.dshgc-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--dsw-alias-label-caption, #999); margin: 0 0 6px; }
.dshgc-textarea { width: 100%; box-sizing: border-box; min-height: 64px; resize: vertical; border: 1px solid var(--dsw-alias-border-l2, #333); border-radius: 8px; background: transparent; color: inherit; padding: 8px 10px; font: inherit; }
.dshgc-textarea:focus { outline: 1px solid var(--dsw-alias-state-business-primary, #4a8); }
.dshgc-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.dshgc-btn { border: 1px solid var(--dsw-alias-border-l2, #333); background: transparent; color: var(--dsw-alias-label-secondary, #bbb); border-radius: 8px; padding: 5px 12px; font: inherit; font-size: 12px; cursor: pointer; }
.dshgc-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.07)); }
.dshgc-btn:disabled { opacity: .4; cursor: default; }
.dshgc-btn-primary { border-color: var(--dsw-alias-state-business-primary, #4a8); color: var(--dsw-alias-state-business-primary, #4a8); }
.dshgc-btn-danger { border-color: var(--dsw-alias-state-error-primary, #c55); color: var(--dsw-alias-state-error-primary, #c55); }
.dshgc-num { width: 56px; border: 1px solid var(--dsw-alias-border-l2, #333); border-radius: 6px; background: transparent; color: inherit; padding: 4px 6px; font: inherit; font-size: 12px; text-align: center; }
.dshgc-roles { display: flex; flex-direction: column; gap: 6px; }
.dshgc-role { display: flex; align-items: flex-start; gap: 8px; border: 1px solid var(--dsw-alias-border-l2, #333); border-radius: 10px; padding: 8px 10px; }
.dshgc-avatar { flex: none; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; color: #10121a; }
.dshgc-roleInfo { flex: 1; min-width: 0; }
.dshgc-roleName { font-weight: 600; font-size: 12px; }
.dshgc-roleMeta { color: var(--dsw-alias-label-tertiary, #888); font-size: 11px; line-height: 16px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.dshgc-iconbtn { color: var(--dsw-alias-label-tertiary, #888); background: none; border: 0; cursor: pointer; font-size: 12px; padding: 2px 6px; border-radius: 6px; }
.dshgc-iconbtn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.07)); }
.dshgc-roleForm { display: flex; flex-direction: column; gap: 6px; border: 1px dashed var(--dsw-alias-border-l2, #333); border-radius: 10px; padding: 8px 10px; }
.dshgc-input { border: 1px solid var(--dsw-alias-border-l2, #333); border-radius: 6px; background: transparent; color: inherit; padding: 4px 8px; font: inherit; font-size: 12px; }
.dshgc-msgs { flex: 1; min-height: 120px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
.dshgc-msg { display: flex; align-items: flex-start; gap: 8px; max-width: 92%; }
.dshgc-msgBody { min-width: 0; }
.dshgc-msgName { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-tertiary, #888); margin-bottom: 2px; }
.dshgc-msgText { white-space: pre-wrap; word-break: break-word; font-size: 13px; color: var(--dsw-alias-label-primary, #eee); }
.dshgc-msgText[data-failed='true'] { color: var(--dsw-alias-state-error-primary, #c55); }
.dshgc-typing { color: var(--dsw-alias-label-tertiary, #888); font-size: 11px; font-style: italic; padding: 4px 0; }
.dshgc-empty { color: var(--dsw-alias-label-tertiary, #888); text-align: center; padding: 24px 0; }
.dshgc-summary { white-space: pre-wrap; word-break: break-word; font-size: 12.5px; }
.dshgc-error { color: var(--dsw-alias-state-error-primary, #c55); font-size: 12px; }
.dshgc-offline { color: var(--dsw-alias-state-warn-label, #da4); font-size: 12px; }
.dshgc-copied { color: var(--dsw-alias-state-success-primary, #4a8); font-size: 12px; }
.dshgc-path { color: var(--dsw-alias-label-tertiary, #888); font-size: 11px; word-break: break-all; }
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

/* ───────────────────────── 入口按钮 ───────────────────────── */

function HeaderAction({ sessionId }) {
  useEffect(() => {
    if (sessionId) bus.sessionId = sessionId
  }, [sessionId])
  return h('button', {
    className: 'dshgc-trigger',
    title: '多角色群聊：生成角色团队，围绕任务讨论并产出结论',
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
  const [notice, setNotice] = useState('')
  const [generating, setGenerating] = useState(false)
  const [showRoleForm, setShowRoleForm] = useState(false)
  const [roleDraft, setRoleDraft] = useState({ name: '', persona: '', duty: '' })
  const msgsRef = useRef(null)

  useEffect(() => subscribeBus(() => setOpenTick((n) => n + 1)), [])
  useEffect(() => { adoptStyles() }, [])

  // 轮询快照（500ms，version 去重）
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
          if (snapNow.phase === 'idle' && snapNow.roles.length > 0 && !snapNow.error) {
            setGenerating(false)
          }
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

  const refreshDraft = useCallback(() => {
    if (snap && snap.task && draft === '') setDraft(snap.task)
  }, [snap, draft])

  useEffect(() => { refreshDraft() }, [snap, draft])

  const canGenerate = phase !== 'discussing' && phase !== 'generating-roles' && phase !== 'summarizing'
  const canStart = phase === 'idle' || phase === 'done' || phase === 'error'
  const inDiscuss = phase === 'discussing'
  const paused = inDiscuss && snap && snap.paused === true

  const controls = h('div', { className: 'dshgc-row' },
    canStart && roles.length > 0
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
      ? h('button', { className: 'dshgc-btn', onClick: () => run(() => postAction('skip')) }, '⏭ 跳过当前')
      : null,
    inDiscuss
      ? h('button', { className: 'dshgc-btn dshgc-btn-danger', onClick: () => run(() => postAction('stop')) }, '■ 停止')
      : null,
    messages.length > 0
      ? h('button', { className: 'dshgc-btn', onClick: () => run(async () => {
          const data = await postAction('export-md')
          setNotice('')
          setOffline((old) => old)
          // 导出成功后轮询会带回 mdPath；直接触发一次拉取
          try {
            const snapNow = await fetchState()
            setSnap(snapNow)
          } catch { /* ignore */ }
        }) }, '📄 导出 MD')
      : null,
  )

  return h('div', { className: 'dshgc-overlay', onClick: (e) => { if (e.target === e.currentTarget) closePanel() } },    h('div', { className: 'dshgc-panel' },
      h('div', { className: 'dshgc-head' },
        h('div', { className: 'dshgc-title' }, '💬 群聊讨论',
          h('span', { className: 'dshgc-badge' }, PHASE_LABEL[phase] || phase),
        ),
        h('button', { className: 'dshgc-close', onClick: closePanel, title: '关闭' }, '×'),
      ),
      h('div', { className: 'dshgc-body' },
        offline
          ? h('div', { className: 'dshgc-offline' }, '⚠ 已与群聊服务断开（插件可能已卸载/重载）')
          : null,
        notice
          ? h('div', {}, notice)
          : null,

        h('div', { className: 'dshgc-section' },
          h('div', { className: 'dshgc-label' }, '任务 / 设计需求'),
          h('textarea', {
            className: 'dshgc-textarea',
            placeholder: '输入任务或设计方案，例如：设计一款家庭记账 App 的核心方案…',
            value: draft,
            disabled: phase === 'discussing' || phase === 'generating-roles',
            onChange: (e) => setDraft(e.target.value),
          }),
          h('div', { className: 'dshgc-row' },
            h('label', null, '讨论轮数'),
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
        ),

        roles.length > 0
          ? h('div', { className: 'dshgc-section' },
              h('div', { className: 'dshgc-label' }, `角色团队（${roles.length} 人）`),
              h('div', { className: 'dshgc-roles' },
                roles.map((r, i) => h('div', { className: 'dshgc-role', key: r.id },
                  h('span', { className: 'dshgc-avatar', style: { background: avatarColor(r.id) } }, roleInitial(r.name)),
                  h('div', { className: 'dshgc-roleInfo' },
                    h('div', { className: 'dshgc-roleName' }, r.name),
                    h('div', { className: 'dshgc-roleMeta' }, (r.duty ? '【' + r.duty + '】' : '') + r.persona),
                  ),
                  h('button', {
                    className: 'dshgc-iconbtn', title: '让 TA 重新发言',
                    disabled: offline,
                    onClick: () => run(() => postAction('reroll', { roleId: r.id })),
                  }, '↻'),
                  h('button', {
                    className: 'dshgc-iconbtn', title: '删除该角色',
                    disabled: inDiscuss,
                    onClick: () => run(() => postAction('update-roles', { roles: roles.filter((x) => x.id !== r.id) })),
                  }, '🗑'),
                )),
                showRoleForm
                  ? h('div', { className: 'dshgc-roleForm', key: 'role-form' },
                      h('input', { className: 'dshgc-input', placeholder: '角色名（如：UX 设计师）', value: roleDraft.name, onChange: (e) => setRoleDraft({ ...roleDraft, name: e.target.value }) }),
                      h('input', { className: 'dshgc-input', placeholder: 'persona：一至两段角色定位…', value: roleDraft.persona, onChange: (e) => setRoleDraft({ ...roleDraft, persona: e.target.value }) }),
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
                  : h('button', { className: 'dshgc-btn', disabled: inDiscuss, onClick: () => setShowRoleForm(true) }, '+ 添加角色'),
                h('div', null,
                  h('button', {
                    className: 'dshgc-btn',
                    disabled: !canGenerate || offline,
                    onClick: () => run(() => postAction('generate-roles', { task: snap ? snap.task : draft, rounds })),
                  }, '🔄 重新生成角色团队'),
                ),
              ),
            )
          : null,

        h('div', { className: 'dshgc-msgs', ref: msgsRef },
          messages.length === 0
            ? h('div', { className: 'dshgc-empty' }, inDiscuss ? '讨论准备中…' : '暂无发言：先输入任务并生成角色团队，再开始讨论')
            : null,
          messages.map((m) => h('div', { className: 'dshgc-msg', key: m.id },
            h('span', { className: 'dshgc-avatar', style: { background: avatarColor(m.roleId) } }, roleInitial(m.name)),
            h('div', { className: 'dshgc-msgBody' },
              h('div', { className: 'dshgc-msgName' }, m.name),
              h('div', { className: 'dshgc-msgText', 'data-failed': String(m.failed === true) }, m.text),
            ),
          )),
          inDiscuss && snap && snap.streamingRoleId
            ? h('div', { className: 'dshgc-typing' }, '● ' + roleName(snap, snap.streamingRoleId) + ' 正在输入…')
            : null,
        ),

        inDiscuss
          ? h('div', { className: 'dshgc-section' }, controls)
          : (phase === 'idle' || phase === 'done' || phase === 'error') && (roles.length > 0 || messages.length > 0)
            ? h('div', { className: 'dshgc-section' }, controls)
            : null,

        snap && snap.error
          ? h('div', { className: 'dshgc-error' }, '⚠ ' + snap.error)
          : null,

        snap && snap.summary
          ? h('div', { className: 'dshgc-section' },
              h('div', { className: 'dshgc-label' }, '结论'),
              h('div', { className: 'dshgc-summary' }, snap.summary),
              h('div', { className: 'dshgc-row' },
                h('button', { className: 'dshgc-btn', disabled: offline, onClick: () => run(async () => { await postAction('export-md') }) }, '📄 导出 MD'),
                h('button', { className: 'dshgc-btn', onClick: () => run(async () => {
                  if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(snap.mdContent || snap.summary)
                    setNotice('已复制到剪贴板')
                  } else {
                    setNotice('当前环境不支持剪贴板')
                  }
                }) }, '📋 复制内容'),
                h('button', {
                  className: 'dshgc-btn', disabled: offline,
                  onClick: () => run(async () => { await postAction('sync-rounds', { rounds }); await postAction('start') }),
                }, '🔄 再来一轮'),
              ),
              snap.mdPath
                ? h('div', { className: 'dshgc-path' }, '已保存：' + snap.mdPath)
                : null,
            )
          : null,
      ),
    ),
  )
}

function roleName(snap, roleId) {
  const r = snap.roles.find((x) => x.id === roleId)
  return r ? r.name : '?'
}

const PHASE_LABEL = {
  idle: '待命',
  'generating-roles': '生成角色中',
  discussing: '讨论中',
  summarizing: '总结中',
  done: '已完成',
  error: '出错',
}

/* ───────────────────────── 注册 ───────────────────────── */

function OverlayHost() {
  const [tick, setTick] = useState(0)
  useEffect(() => subscribeBus(() => setTick((n) => n + 1)), [])
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
