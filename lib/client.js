window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-group-chat",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/index.js
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
		*    update-roles/sync-settings/chat/export-md
		*/
		/** 收起哨兵：确保 dismissedTask 永远不等于任何任务文本（关闭后绝不自动弹出）。 */
		const DISMISS_SENTINEL = "\0dismissed";
		const bus = {
			open: false,
			sessionId: "",
			dismissedTask: "",
			lastTask: "",
			listeners: /* @__PURE__ */ new Set()
		};
		function subscribeBus(fn) {
			bus.listeners.add(fn);
			return () => bus.listeners.delete(fn);
		}
		function dispatchBus() {
			for (const fn of bus.listeners) try {
				fn();
			} catch {}
		}
		function openPanel(sessionId) {
			if (sessionId) bus.sessionId = sessionId;
			bus.dismissedTask = "";
			bus.open = true;
			dispatchBus();
		}
		function closePanel() {
			bus.dismissedTask = bus.lastTask || DISMISS_SENTINEL;
			bus.open = false;
			dispatchBus();
		}
		async function fetchState() {
			const res = await fetch("/dsh-group-chat/api/state", { cache: "no-store" });
			if (!res.ok) throw new Error("HTTP " + res.status);
			return res.json();
		}
		async function postAction(action, extra = {}) {
			const res = await fetch("/dsh-group-chat/api/" + action, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					sessionId: bus.sessionId,
					...extra
				})
			});
			const data = await res.json().catch(() => ({ ok: false }));
			if (!res.ok || data.ok !== true) throw new Error(data && data.error || "请求失败（" + res.status + "）");
			return data;
		}
		const STYLE_ID = "dsh-group-chat-style";
		const CSS = `
.dshgc-trigger {
  min-height: 28px; color: var(--dsw-alias-label-tertiary, #888);
  cursor: pointer; background: none; border: 0; border-radius: 6px;
  align-items: center; gap: 6px; padding: 3px 8px; font-size: 12px;
  line-height: 18px; display: inline-flex; font-family: inherit;
}
.dshgc-trigger:hover, .dshgc-trigger:focus-visible { color: var(--dsw-alias-label-secondary, #aaa); background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06)); }

/* 群聊面板（默认右侧停靠；拖动后浮动模式 data-float='1'） */
.dshgc-overlay {
  position: fixed; top: 52px; right: 12px; bottom: 12px;
  width: 380px; max-width: calc(100vw - 24px);
  z-index: 95; display: flex; pointer-events: auto;
  touch-action: none;
}
.dshgc-overlay[data-float='1'] { right: auto; bottom: auto; }
.dshgc-panel {
  width: 100%; box-sizing: border-box; display: flex; flex-direction: column;
  background: var(--dsw-specific-menu, #1c1e24); color: var(--dsw-alias-label-primary, #eee);
  border: 1px solid var(--dsw-alias-border-l2, #333); border-radius: 14px;
  box-shadow: var(--dsw-shadow-lv3, 0 8px 32px rgba(0,0,0,.4));
  overflow: hidden; font-size: 13px; line-height: 20px; min-height: 0;
}
.dshgc-head { flex: none; display: flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 10px 0 12px; border-bottom: 1px solid var(--dsw-alias-border-l2, #333); cursor: move; user-select: none; }
.dshgc-head button { cursor: pointer; }
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
.dshgc-hostChip { border-color: var(--dsw-alias-state-business-primary, #4a8); background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4a8) 12%, transparent); }
.dshgc-hostTag { font-size: 9px; color: var(--dsw-alias-state-business-primary, #4a8); border: 1px solid var(--dsw-alias-state-business-primary, #4a8); border-radius: 6px; padding: 0 4px; line-height: 14px; }
.dshgc-toggle { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--dsw-alias-label-secondary, #bbb); cursor: pointer; user-select: none; }
.dshgc-roleForm { display: flex; flex-direction: column; gap: 4px; border: 1px dashed var(--dsw-alias-border-l2, #333); border-radius: 8px; padding: 6px 8px; }
.dshgc-input { border: 1px solid var(--dsw-alias-border-l2, #333); border-radius: 6px; background: transparent; color: inherit; padding: 3px 8px; font: inherit; font-size: 11px; }

/* 消息区（竖长：flex-1 滚动）；消息文本按 md 渲染（字号显著小于标准 md） */
.dshgc-msgs { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; overflow-y: auto; }
.dshgc-msg { display: flex; align-items: flex-start; gap: 6px; }
.dshgc-msgBody { min-width: 0; flex: 1; }
.dshgc-msgName { font-size: 10px; font-weight: 600; color: var(--dsw-alias-label-tertiary, #888); margin-bottom: 1px; }
.dshgc-msgText { word-break: break-word; font-size: 12.5px; line-height: 1.6; color: var(--dsw-alias-label-primary, #eee); }
.dshgc-msgText[data-failed='true'] { color: var(--dsw-alias-state-error-primary, #c55); }
/* md 元素（小字号适配窄面板） */
.dshgc-msgText p { margin: 0 0 5px; }
.dshgc-msgText p:last-child { margin-bottom: 0; }
.dshgc-msgText h1, .dshgc-msgText h2, .dshgc-msgText h3, .dshgc-msgText h4 {
  margin: 6px 0 4px; font-weight: 600; line-height: 1.35;
  font-size: 13px; /* 标准 md 标题 16-20px，面板内显著缩小 */
}
.dshgc-msgText h1 { font-size: 14px; }
.dshgc-msgText h2 { font-size: 13.5px; }
.dshgc-msgText h3 { font-size: 13px; }
.dshgc-msgText h4 { font-size: 12.5px; }
.dshgc-msgText ul, .dshgc-msgText ol { margin: 3px 0; padding-left: 17px; }
.dshgc-msgText li { margin: 2px 0; }
.dshgc-msgText code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px; background: rgba(127,127,127,.16);
  padding: 1px 4px; border-radius: 4px;
}
.dshgc-msgText pre {
  background: rgba(0,0,0,.28); border: 1px solid var(--dsw-alias-border-l2, #333);
  border-radius: 8px; padding: 7px 9px; margin: 5px 0; overflow-x: auto;
  font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;
}
.dshgc-msgText pre code { background: none; padding: 0; font-size: 11.5px; }
.dshgc-msgText blockquote {
  border-left: 3px solid var(--dsw-alias-border-l2, #555); margin: 4px 0;
  padding: 2px 8px; color: var(--dsw-alias-label-secondary, #aaa); font-size: 12px;
}
.dshgc-msgText a { color: var(--dsw-alias-state-business-primary, #4a8); text-decoration: none; }
.dshgc-msgText a:hover { text-decoration: underline; }
.dshgc-msgText hr { border: 0; border-top: 1px solid var(--dsw-alias-border-l2, #333); margin: 6px 0; }
.dshgc-msgText em { font-style: italic; }
.dshgc-msgText strong { font-weight: 600; }
.dshgc-msgText del { opacity: .65; }
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

/* 收起态悬浮按钮（主会话内容区左上方——会话侧栏右侧、tab 行下方；不遮挡内容主体） */
.dshgc-float {
  position: fixed; left: 292px; top: 92px; z-index: 96;
  width: 46px; height: 46px; border-radius: 14px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  /* 固定深色高对比（不依赖主题变量，深浅主题均可辨识） */
  background: linear-gradient(160deg, rgba(46,52,68,.96), rgba(30,34,46,.96));
  border: 1px solid rgba(255,255,255,.22);
  box-shadow: 0 4px 16px rgba(0,0,0,.35);
  cursor: pointer; font-family: inherit; font-size: 17px; line-height: 1;
  color: #cfd6e4;
  opacity: .85; transition: opacity .15s, border-color .25s, color .25s, transform .15s;
}
.dshgc-float:hover { opacity: 1; transform: scale(1.05); background: linear-gradient(160deg, rgba(54,62,82,.98), rgba(38,44,60,.98)); }
.dshgc-float-active {
  opacity: 1; color: #6fe6b0;
  border-color: rgba(111,230,176,.65);
  animation: dshgc-float-pulse 2s ease-in-out infinite;
}
.dshgc-float-error { color: #ff8a8a; border-color: rgba(255,138,138,.65); }
@keyframes dshgc-float-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(111,230,176,.38); }
  50% { box-shadow: 0 0 0 10px rgba(111,230,176,0); }
}
.dshgc-float-dots { display: inline-flex; gap: 3px; height: 5px; align-items: center; }
.dshgc-float-dots i { width: 4px; height: 4px; border-radius: 50%; background: currentColor; animation: dshgc-dot-bounce 1.2s ease-in-out infinite; }
.dshgc-float-dots i:nth-child(2) { animation-delay: .15s; }
.dshgc-float-dots i:nth-child(3) { animation-delay: .3s; }
@keyframes dshgc-dot-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: .45; } 30% { transform: translateY(-3px); opacity: 1; } }
`;
		function adoptStyles() {
			if (typeof document === "undefined") return;
			if (document.getElementById(STYLE_ID) !== null) return;
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.dataset.plugin = "@dsh-external/dsh-group-chat";
			style.textContent = CSS;
			document.head.appendChild(style);
		}
		/**
		* 安全 markdown 渲染（零依赖）：把 LLM 消息文本解析为 React 元素树；
		* 文本始终按字符串输出，任何 HTML 标记都不会被解释（无注入面）。
		* 支持：## 标题 / - 列表 / 1. 有序列表 / > 引用 / ``` 代码块 / --- 分隔 /
		*       **粗体** / *斜体* / `代码` / [链接](url) / ~~删除~~。
		* 字号遵循 .dshgc-msgText 的窄面板缩放宽限（显著小于标准 md）。
		*/
		function mdInline(text, keyPrefix) {
			const out = [];
			const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|~~[^~]+~~)/g;
			let last = 0;
			let m;
			let i = 0;
			while ((m = re.exec(text)) !== null) {
				if (m.index > last) out.push(text.slice(last, m.index));
				const tok = m[0];
				const key = keyPrefix + i++;
				if (tok.startsWith("**")) out.push((0, react.createElement)("strong", { key }, tok.slice(2, -2)));
				else if (tok.startsWith("`")) out.push((0, react.createElement)("code", { key }, tok.slice(1, -1)));
				else if (tok.startsWith("[")) {
					const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
					if (mm) out.push((0, react.createElement)("a", {
						key,
						href: mm[2],
						target: "_blank",
						rel: "noreferrer"
					}, mm[1]));
					else out.push(tok);
				} else if (tok.startsWith("*")) out.push((0, react.createElement)("em", { key }, tok.slice(1, -1)));
				else if (tok.startsWith("~~")) out.push((0, react.createElement)("del", { key }, tok.slice(2, -2)));
				last = m.index + tok.length;
			}
			if (last < text.length) out.push(text.slice(last));
			return out;
		}
		function mdToReact(markdown) {
			const lines = String(markdown || "").split("\n");
			const nodes = [];
			let i = 0;
			let k = 0;
			const key = () => "md" + k++;
			while (i < lines.length) {
				const t = lines[i].trim();
				if (t === "") {
					i += 1;
					continue;
				}
				if (t.startsWith("```")) {
					const buf = [];
					i += 1;
					while (i < lines.length && !lines[i].trim().startsWith("```")) {
						buf.push(lines[i]);
						i += 1;
					}
					i += 1;
					nodes.push((0, react.createElement)("pre", { key: key() }, (0, react.createElement)("code", null, buf.join("\n"))));
					continue;
				}
				const heading = /^(#{1,4})\s+(.+)$/.exec(t);
				if (heading) {
					const level = heading[1].length;
					nodes.push((0, react.createElement)("h" + level, { key: key() }, ...mdInline(heading[2], "h" + k)));
					i += 1;
					continue;
				}
				if (/^---+$/.test(t)) {
					nodes.push((0, react.createElement)("hr", { key: key() }));
					i += 1;
					continue;
				}
				if (t.startsWith(">")) {
					const buf = [];
					while (i < lines.length && lines[i].trim().startsWith(">")) {
						buf.push(lines[i].trim().replace(/^>\s?/, ""));
						i += 1;
					}
					nodes.push((0, react.createElement)("blockquote", { key: key() }, ...mdInline(buf.join(" "), "q" + k)));
					continue;
				}
				if (/^[-*•]\s+/.test(t) || /^\d+[.)]\s+/.test(t)) {
					const ordered = /^\d+[.)]\s+/.test(t);
					const items = [];
					while (i < lines.length) {
						const line = lines[i].trim();
						const um = /^[-*•]\s+/.exec(line);
						const om = /^\d+[.)]\s+/.exec(line);
						if (ordered ? om : um) {
							items.push((0, react.createElement)("li", { key: items.length }, ...mdInline(line.replace(ordered ? om[0] : um[0], ""), "li" + k + items.length)));
							i += 1;
						} else break;
					}
					nodes.push((0, react.createElement)(ordered ? "ol" : "ul", { key: key() }, items));
					continue;
				}
				const para = [];
				while (i < lines.length) {
					const line = lines[i];
					const lt = line.trim();
					if (lt === "" || /^(#{1,4}\s|```|---$|>\s|[-*•]\s|\d+[.)]\s)/.test(lt)) break;
					para.push(line);
					i += 1;
				}
				nodes.push((0, react.createElement)("p", { key: key() }, para.map((line, idx) => {
					const children = [];
					if (idx > 0) children.push((0, react.createElement)("br", { key: "br" + idx }));
					children.push(...mdInline(line, "p" + k + idx));
					return children;
				})));
			}
			return nodes;
		}
		const AVATAR_COLORS = [
			"#5ad1a6",
			"#6ab0f3",
			"#f3b562",
			"#e88a8a",
			"#b48cf2",
			"#7dd3a8",
			"#f2a06b",
			"#89c2f0"
		];
		function avatarColor(roleId) {
			if (!roleId) return "#999";
			const m = /(\d+)/.exec(roleId);
			const index = m ? Number(m[1]) : 0;
			return AVATAR_COLORS[index % AVATAR_COLORS.length];
		}
		function roleInitial(name) {
			return String(name || "?").slice(0, 1).toUpperCase();
		}
		const PHASE_LABEL = {
			idle: "待命",
			"generating-roles": "拉群中",
			discussing: "讨论中",
			summarizing: "总结中",
			done: "已完成",
			error: "出错"
		};
		function HeaderAction({ sessionId }) {
			return (0, react.createElement)("button", {
				className: "dshgc-trigger",
				title: "多角色群聊：基于会话发起群聊（也可用 /group-chat <任务> 指令呼起）",
				onClick: () => openPanel(sessionId)
			}, "💬", (0, react.createElement)("span", null, "群聊"));
		}
		const PANEL_POS_KEY = "dsh-group-chat-panel-pos";
		function loadPanelPos() {
			try {
				const raw = localStorage.getItem(PANEL_POS_KEY);
				if (!raw) return null;
				const p = JSON.parse(raw);
				if (typeof p.x === "number" && typeof p.y === "number") return {
					x: Math.max(4, Math.min(p.x, window.innerWidth - 396)),
					y: Math.max(4, Math.min(p.y, window.innerHeight - 120))
				};
			} catch {}
			return null;
		}
		function savePanelPos(pos) {
			try {
				if (pos) localStorage.setItem(PANEL_POS_KEY, JSON.stringify(pos));
				else localStorage.removeItem(PANEL_POS_KEY);
			} catch {}
		}
		function Panel() {
			const [, setOpenTick] = (0, react.useState)(0);
			const [snap, setSnap] = (0, react.useState)(null);
			const [offline, setOffline] = (0, react.useState)(false);
			const [draft, setDraft] = (0, react.useState)("");
			const [compose, setCompose] = (0, react.useState)("");
			const [notice, setNotice] = (0, react.useState)("");
			const [generating, setGenerating] = (0, react.useState)(false);
			const [showSettings, setShowSettings] = (0, react.useState)(false);
			const [showRoleForm, setShowRoleForm] = (0, react.useState)(false);
			const [roleDraft, setRoleDraft] = (0, react.useState)({
				name: "",
				persona: "",
				duty: ""
			});
			const msgsRef = (0, react.useRef)(null);
			const overlayRef = (0, react.useRef)(null);
			const [pos, setPos] = (0, react.useState)(() => loadPanelPos());
			const posRef = (0, react.useRef)(pos);
			posRef.current = pos;
			const dragRef = (0, react.useRef)(null);
			const dragHandlersRef = (0, react.useRef)(null);
			const clampViewport = (x, y) => {
				const vw = window.innerWidth;
				const vh = window.innerHeight;
				return {
					x: Math.max(4, Math.min(Math.round(x), vw - 396)),
					y: Math.max(4, Math.min(Math.round(y), vh - 100))
				};
			};
			const onDragMove = (e) => {
				const d = dragRef.current;
				if (!d) return;
				setPos(clampViewport(e.clientX - d.dx, e.clientY - d.dy));
			};
			const onDragEnd = () => {
				if (!dragRef.current) return;
				dragRef.current = null;
				const h = dragHandlersRef.current;
				if (h) {
					window.removeEventListener("pointermove", h.move);
					window.removeEventListener("pointerup", h.end);
				}
				savePanelPos(posRef.current);
			};
			dragHandlersRef.current = {
				move: onDragMove,
				end: onDragEnd
			};
			(0, react.useEffect)(() => () => {
				const h = dragHandlersRef.current;
				if (h) {
					window.removeEventListener("pointermove", h.move);
					window.removeEventListener("pointerup", h.end);
				}
				dragRef.current = null;
			}, []);
			const onDragStart = (e) => {
				if (e.button !== 0 || !overlayRef.current) return;
				if (e.target && e.target.closest && e.target.closest("button")) return;
				e.preventDefault();
				const rect = overlayRef.current.getBoundingClientRect();
				dragRef.current = {
					dx: e.clientX - rect.left,
					dy: e.clientY - rect.top
				};
				const h = dragHandlersRef.current;
				if (h) {
					window.addEventListener("pointermove", h.move);
					window.addEventListener("pointerup", h.end);
				}
			};
			(0, react.useEffect)(() => subscribeBus(() => setOpenTick((n) => n + 1)), []);
			(0, react.useEffect)(() => {
				adoptStyles();
			}, []);
			(0, react.useEffect)(() => {
				if (!bus.open) return;
				let alive = true;
				let last = 0;
				const tick = async () => {
					try {
						const snapNow = await fetchState();
						if (!alive) return;
						setOffline(false);
						setGenerating(snapNow.phase === "generating-roles");
						if (snapNow.version !== last) {
							last = snapNow.version;
							setSnap(snapNow);
							if (typeof snapNow.task === "string") bus.lastTask = snapNow.task;
						}
					} catch {
						if (alive) setOffline(true);
					}
				};
				tick();
				const timer = setInterval(tick, 500);
				return () => {
					alive = false;
					clearInterval(timer);
				};
			}, [bus.open]);
			(0, react.useEffect)(() => {
				const el = msgsRef.current;
				if (el) el.scrollTop = el.scrollHeight;
			}, [snap && snap.version]);
			(0, react.useEffect)(() => {
				if (snap && snap.task && draft === "") setDraft(snap.task);
			}, [snap, draft]);
			const phase = snap ? snap.phase : "idle";
			const roles = snap ? snap.roles : [];
			const messages = snap ? snap.messages : [];
			const run = (0, react.useCallback)(async (fn, okText) => {
				setNotice("");
				try {
					await fn();
					if (okText) setNotice(okText);
				} catch (err) {
					setNotice("操作失败：" + String(err && err.message ? err.message : err).slice(0, 160));
				}
			}, []);
			const send = (0, react.useCallback)(() => {
				const text = compose.trim();
				if (text === "") return;
				setCompose("");
				run(() => postAction("chat", { text }), "");
			}, [compose, run]);
			const canGenerate = phase !== "discussing" && phase !== "generating-roles" && phase !== "summarizing";
			const inDiscuss = phase === "discussing";
			const paused = inDiscuss && snap && snap.paused === true;
			const controls = (0, react.createElement)("div", { className: "dshgc-row" }, (phase === "idle" || phase === "done" || phase === "error") && roles.length > 0 ? (0, react.createElement)("button", {
				className: "dshgc-btn dshgc-btn-primary",
				disabled: offline,
				onClick: () => run(async () => {
					await postAction("start");
				})
			}, "▶ 开始讨论") : null, inDiscuss && !paused ? (0, react.createElement)("button", {
				className: "dshgc-btn",
				onClick: () => run(() => postAction("pause"))
			}, "⏸ 暂停") : null, inDiscuss && paused ? (0, react.createElement)("button", {
				className: "dshgc-btn dshgc-btn-primary",
				onClick: () => run(() => postAction("resume"))
			}, "▶ 继续") : null, inDiscuss ? (0, react.createElement)("button", {
				className: "dshgc-btn",
				onClick: () => run(() => postAction("skip"))
			}, "⏭ 跳过") : null, inDiscuss ? (0, react.createElement)("button", {
				className: "dshgc-btn dshgc-btn-danger",
				onClick: () => run(() => postAction("stop"))
			}, "■ 停止") : null, messages.length > 0 ? (0, react.createElement)("button", {
				className: "dshgc-btn",
				onClick: () => run(() => postAction("export-md"))
			}, "📄 导出 MD") : null);
			const overlayStyle = pos ? {
				left: pos.x,
				top: pos.y,
				right: "auto",
				bottom: "auto",
				height: Math.max(320, Math.min(640, window.innerHeight - pos.y - 16))
			} : void 0;
			return (0, react.createElement)("div", {
				className: "dshgc-overlay",
				ref: overlayRef,
				"data-float": pos ? "1" : void 0,
				style: overlayStyle
			}, (0, react.createElement)("div", { className: "dshgc-panel" }, (0, react.createElement)("div", {
				className: "dshgc-head",
				onPointerDown: onDragStart,
				title: "按住空白处可拖动面板"
			}, (0, react.createElement)("span", {
				className: "dshgc-avatar",
				style: { background: "#6ab0f3" }
			}, "💬"), (0, react.createElement)("div", { className: "dshgc-title" }, "群聊讨论", (0, react.createElement)("span", { className: "dshgc-taskMini" }, snap && snap.task ? "· " + snap.task.slice(0, 26) : "")), (0, react.createElement)("span", { className: "dshgc-badge" }, PHASE_LABEL[phase] || phase), (0, react.createElement)("button", {
				className: "dshgc-iconbtn",
				title: showSettings ? "收起设置" : "任务与角色设置",
				onClick: () => setShowSettings((v) => !v)
			}, showSettings ? "▾" : "⚙"), (0, react.createElement)("button", {
				className: "dshgc-iconbtn dshgc-close",
				onClick: () => closePanel(),
				title: "收起面板（群聊在后台继续，完成后结论仍会回到会话）"
			}, "×")), showSettings ? (0, react.createElement)("div", { className: "dshgc-settings" }, offline ? (0, react.createElement)("div", { className: "dshgc-offline" }, "⚠ 与群聊服务断开（插件可能已卸载/重载）") : null, notice ? (0, react.createElement)("div", { className: "dshgc-notice" }, notice) : null, (0, react.createElement)("div", { className: "dshgc-label" }, "任务 / 设计需求"), (0, react.createElement)("textarea", {
				className: "dshgc-textarea",
				placeholder: "输入任务或设计方案…",
				value: draft,
				disabled: inDiscuss || generating,
				onChange: (e) => setDraft(e.target.value)
			}), (0, react.createElement)("div", { className: "dshgc-row" }, (0, react.createElement)("label", {
				className: "dshgc-toggle",
				title: "成员被点名后可自主调用 subagent 深度推理；随时切换，当前发言/推理中的成员不受影响，下次发言时生效"
			}, (0, react.createElement)("input", {
				type: "checkbox",
				checked: snap ? snap.allowDeepReasoning === true : true,
				onChange: (e) => run(async () => {
					await postAction("sync-settings", { allowDeepReasoning: e.target.checked });
				})
			}), " 允许成员深度推理")), (0, react.createElement)("div", { className: "dshgc-row" }, (0, react.createElement)("button", {
				className: "dshgc-btn dshgc-btn-primary",
				disabled: !canGenerate || offline || draft.trim() === "",
				onClick: () => run(async () => {
					setNotice("正在生成角色团队…");
					await postAction("generate-roles", { task: draft });
					setNotice("");
				})
			}, generating ? "⏳ 生成中…" : "✨ 生成角色团队")), roles.length > 0 || snap && snap.host ? (0, react.createElement)("div", {}, (0, react.createElement)("div", { className: "dshgc-label" }, "角色团队" + (snap && snap.host ? "（主持人 + " + roles.length + " 专家）" : `（${roles.length}）`)), (0, react.createElement)("div", { className: "dshgc-roles" }, snap && snap.host ? (0, react.createElement)("span", {
				className: "dshgc-roleChip dshgc-hostChip",
				key: "host",
				title: "主持人：" + ((snap.host.duty ? "【" + snap.host.duty + "】" : "") + snap.host.persona) + "（主持人不参与增删改，更换请重新生成角色团队）"
			}, (0, react.createElement)("span", {
				className: "dshgc-avatar",
				style: { background: "#f3b562" }
			}, "主"), snap.host.name, (0, react.createElement)("span", { className: "dshgc-hostTag" }, "主持")) : null, roles.map((r) => (0, react.createElement)("span", {
				className: "dshgc-roleChip",
				key: r.id,
				title: (r.duty ? "【" + r.duty + "】" : "") + r.persona
			}, (0, react.createElement)("span", {
				className: "dshgc-avatar",
				style: { background: avatarColor(r.id) }
			}, roleInitial(r.name)), r.name, (0, react.createElement)("button", {
				className: "dshgc-rm",
				title: "让 TA 重新发言",
				onClick: (e) => {
					e.stopPropagation();
					run(() => postAction("reroll", { roleId: r.id }));
				}
			}, "↻"), (0, react.createElement)("button", {
				className: "dshgc-rm",
				title: "删除该角色",
				disabled: inDiscuss,
				onClick: (e) => {
					e.stopPropagation();
					run(() => postAction("update-roles", { roles: roles.filter((x) => x.id !== r.id) }));
				}
			}, "✕"))), showRoleForm ? (0, react.createElement)("span", { className: "dshgc-roleForm" }, (0, react.createElement)("input", {
				className: "dshgc-input",
				placeholder: "角色名",
				value: roleDraft.name,
				onChange: (e) => setRoleDraft({
					...roleDraft,
					name: e.target.value
				})
			}), (0, react.createElement)("input", {
				className: "dshgc-input",
				placeholder: "persona 定位…",
				value: roleDraft.persona,
				onChange: (e) => setRoleDraft({
					...roleDraft,
					persona: e.target.value
				})
			}), (0, react.createElement)("input", {
				className: "dshgc-input",
				placeholder: "职责（可选）",
				value: roleDraft.duty,
				onChange: (e) => setRoleDraft({
					...roleDraft,
					duty: e.target.value
				})
			}), (0, react.createElement)("div", { className: "dshgc-row" }, (0, react.createElement)("button", {
				className: "dshgc-btn dshgc-btn-primary",
				disabled: roleDraft.name.trim() === "" || roleDraft.persona.trim() === "",
				onClick: () => run(async () => {
					await postAction("update-roles", { roles: [...roles, {
						id: "r" + (roles.length + 1),
						name: roleDraft.name.trim(),
						persona: roleDraft.persona.trim(),
						duty: roleDraft.duty.trim()
					}] });
					setRoleDraft({
						name: "",
						persona: "",
						duty: ""
					});
					setShowRoleForm(false);
				})
			}, "添加"), (0, react.createElement)("button", {
				className: "dshgc-btn",
				onClick: () => {
					setShowRoleForm(false);
					setRoleDraft({
						name: "",
						persona: "",
						duty: ""
					});
				}
			}, "取消"))) : (0, react.createElement)("button", {
				className: "dshgc-btn",
				disabled: inDiscuss,
				onClick: () => setShowRoleForm(true)
			}, "+ 加角色"))) : null, (0, react.createElement)("div", { className: "dshgc-row" }, (0, react.createElement)("button", {
				className: "dshgc-btn",
				disabled: !canGenerate || offline,
				onClick: () => run(() => postAction("generate-roles", { task: snap ? snap.task : draft }))
			}, "🔄 重新生成"))) : null, (0, react.createElement)("div", {
				className: "dshgc-msgs",
				ref: msgsRef
			}, messages.length === 0 ? (0, react.createElement)("div", { className: "dshgc-empty" }, inDiscuss ? "讨论准备中…" : generating ? "正在生成角色团队…" : "暂无发言。\n主会话输入 /group-chat <任务>，或点 ⚙ 配置任务后开始。") : null, messages.map((m) => (0, react.createElement)("div", {
				className: "dshgc-msg",
				key: m.id
			}, (0, react.createElement)("span", {
				className: "dshgc-avatar",
				style: { background: m.roleId === "user" ? "#e88a8a" : m.roleId === "host" ? "#f3b562" : avatarColor(m.roleId) }
			}, m.roleId === "host" ? "主" : roleInitial(m.name)), (0, react.createElement)("div", { className: "dshgc-msgBody" }, (0, react.createElement)("div", { className: "dshgc-msgName" }, m.name + (m.roleId === "host" ? " · 主持" : "")), (0, react.createElement)("div", {
				className: "dshgc-msgText",
				"data-failed": String(m.failed === true)
			}, m.failed === true ? [m.text] : mdToReact(m.text))))), inDiscuss && snap && snap.deepThinkingRoleId ? (0, react.createElement)("div", { className: "dshgc-typing" }, "◌ " + roleName(snap, snap.deepThinkingRoleId) + " 正在调用 subagent 深度推理…") : null, inDiscuss && snap && snap.moderatorBusy === true ? (0, react.createElement)("div", { className: "dshgc-typing" }, "● 主持人正在调度…") : null, inDiscuss && snap && snap.streamingRoleId ? (0, react.createElement)("div", { className: "dshgc-typing" }, "● " + roleName(snap, snap.streamingRoleId) + " 正在输入…") : null), snap && snap.error ? (0, react.createElement)("div", { className: "dshgc-error" }, "⚠ " + snap.error) : null, offline ? (0, react.createElement)("div", { className: "dshgc-offline" }, "⚠ 已与群聊服务断开") : null, roles.length > 0 || messages.length > 0 || inDiscuss ? (0, react.createElement)("div", { className: "dshgc-section" }, controls) : null, (0, react.createElement)("div", { className: "dshgc-compose" }, (0, react.createElement)("textarea", {
				className: "dshgc-compose-input",
				placeholder: "以主持人身份参与讨论：输入你的意见，点发送，角色会回应你…",
				value: compose,
				onChange: (e) => setCompose(e.target.value),
				onKeyDown: (e) => {
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						send();
					}
				}
			}), (0, react.createElement)("div", { className: "dshgc-compose-row" }, (0, react.createElement)("span", { className: "dshgc-compose-hint" }, "Enter 发送 · Shift+Enter 换行"), (0, react.createElement)("button", {
				className: "dshgc-btn dshgc-btn-primary",
				disabled: offline || compose.trim() === "",
				onClick: send
			}, "发送"))), snap && snap.summary ? (0, react.createElement)("div", { className: "dshgc-section" }, (0, react.createElement)("div", { className: "dshgc-label" }, "结论"), (0, react.createElement)("div", { className: "dshgc-summary" }, ...mdToReact(snap.summary)), snap.mdPath ? (0, react.createElement)("div", { className: "dshgc-path" }, "已保存：" + snap.mdPath) : null) : null));
		}
		function roleName(snap, roleId) {
			if (roleId === "host") return snap && snap.host && snap.host.name || "主持人";
			const r = snap.roles.find((x) => x.id === roleId);
			return r ? r.name : "?";
		}
		/**
		* 面板收起时的左上方悬浮入口：按讨论状态切换样式（待命/讨论中动画/出错）。
		* snap 由 OverlayHost 的低频轮询提供（面板关闭时 2s 一次）。
		*/
		function FloatingButton({ currentSession, snap }) {
			const phase = snap ? snap.phase : "idle";
			const active = phase === "discussing" || phase === "generating-roles" || phase === "summarizing";
			const cls = "dshgc-float" + (active ? " dshgc-float-active" : "") + (phase === "error" ? " dshgc-float-error" : "");
			const label = (snap && snap.task ? snap.task.slice(0, 18) + " · " : "") + (PHASE_LABEL[phase] || phase) + " — 点击展开群聊面板";
			const [sideW, setSideW] = (0, react.useState)(280);
			(0, react.useEffect)(() => {
				const el = document.querySelector("[class*=\"sidebarCol\"]") || document.querySelector("aside");
				if (el) {
					const r = el.getBoundingClientRect();
					if (r.width > 100) setSideW(Math.round(r.width));
				}
			}, []);
			return (0, react.createElement)("button", {
				className: cls,
				title: label,
				"aria-label": label,
				style: { left: sideW + 12 },
				onClick: () => openPanel(currentSession)
			}, "💬", active ? (0, react.createElement)("span", { className: "dshgc-float-dots" }, (0, react.createElement)("i"), (0, react.createElement)("i"), (0, react.createElement)("i")) : null);
		}
		function OverlayHost({ useSessions }) {
			const [tick, setTick] = (0, react.useState)(0);
			(0, react.useEffect)(() => subscribeBus(() => setTick((n) => n + 1)), []);
			const currentSession = typeof useSessions === "function" ? useSessions((s) => s ? s.current : void 0) : void 0;
			const [closedSnap, setClosedSnap] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (!currentSession || bus.open) return;
				let alive = true;
				const probe = async () => {
					try {
						const s = await fetchState();
						if (!alive || bus.open) return;
						setClosedSnap(s);
						if (!(s.phase === "discussing" || s.phase === "generating-roles" || s.phase === "summarizing")) return;
						if (s.task === bus.dismissedTask) return;
						if (bus.sessionId !== "" && bus.sessionId !== currentSession) return;
						openPanel(currentSession);
					} catch {}
				};
				probe();
				const timer = setInterval(probe, 2e3);
				return () => {
					alive = false;
					clearInterval(timer);
				};
			}, [currentSession, bus.open]);
			if (!bus.open) {
				if (bus.sessionId !== "" && currentSession !== bus.sessionId) return null;
				return (0, react.createElement)(FloatingButton, {
					currentSession,
					snap: closedSnap
				});
			}
			if (bus.sessionId !== "" && currentSession !== bus.sessionId) return null;
			return (0, react.createElement)(Panel, null);
		}
		const inject = ["slots"];
		function apply(ctx) {
			adoptStyles();
			ctx.effect(() => ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "dsh-group-chat-open",
				order: 30
			}, HeaderAction)), "@dsh-external/dsh-group-chat: header action");
			ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "dsh-group-chat-panel",
				order: 90
			}, OverlayHost)), "@dsh-external/dsh-group-chat: overlay panel");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map