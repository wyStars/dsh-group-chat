# dsh-group-chat 升级计划：主持人驱动讨论 + 成员 Subagent 深度推理

> 面向执行者的实施计划（复选框进度）。
> 规格：`docs/specs/2026-09-05-dsh-group-chat-moderator-redesign.md`（草案）
> 目标：彻底替换「固定轮数 + 全员轮流发言」为「AI 主持人动态调度；成员可自主调用 subagent 深度推理」。
> 基线：当前工作区实现（lib/index.js、lib/engine.js、lib/llm.js、src/client/index.js、lib/client.js）。注意：工作区相对 HEAD 已有未提交改动（lib/engine.js、lib/index.js），执行前先提交，避免升级 diff 混杂。

---

## 0. 前置验证结论（已完成的宿主 API 调研，直接指导实现决策）

| # | 调研问题 | 结论 |
|---|---|---|
| 1 | 开放项 1：startContinuable 是否自动向主会话推送完成通知 | **是，且无法关闭**。`SubagentContinuationManager.notifySettlement` 在子代理 settle 后无条件向 parent 注入 `subagent-settled` notice 消息并 `followup/steer` 唤醒父 agent（源码 `dsh-subagent/lib/index.js:notifySettlement`，`announced` 在初始/任意 submit 后置位）。**因此采用一次性 one-shot 路线，不用 continuable** |
| 2 | 开放项 2：能否携带 maxTokens / 模型路由 | **能**。spawn provider（`subagent-spawn-in-process`）capabilities 全支持：`agentOptions`（provider/model/reasoningEffort 覆盖，merge over parent）、`depthLimit`（maxDepth）、`toolFilter`、`persona`、`outputSchema` |
| 3 | 开放项 3：pause 语义 | 设计接受「不立即中断 subagent」。实现为：pause 只置门闩，deep 推理继续，当前动作完成后、下一步主持人调度前等待 |
| 4 | 深推理实现方式 | 采用 **one-shot**：`ctx.subagents.start('spawn', { parent, prompt, maxDepth: 1, agentOptions?, signal })` → 返回 `SubagentRun`，`await run.result` 获得 `{ output: ContentBlock[], stopReason, error? }`。`startInProcessRun` 子代理完成单轮后 result resolve；signal abort → stopReason=`aborted`。**不需要**监听 `subagent/end` 事件（该事件按 parent scope 派发，host 级插件收不到），且 one-shot 不会向主会话注入任何 notice |
| 5 | provider 装配 | profile 已装配 `subagent`（dsh-subagent）+ `subagent-spawn-in-process`（provider 名默认 `spawn`）+ fork；host 级 `ctx.subagents` 可用，`ctx.subagents.getProvider('spawn')` 可探测/兜底 |
| 6 | 主持人调度状态 | 设计文档 snapshot 未列字段，但 UI §9.3 要求区分「主持人正在调度」。**最小扩展**：snapshot 增加 `moderatorBusy: boolean`（其余按 §8.1：host/turn/allowDeepReasoning/deepThinkingRoleId） |
| 7 | 工具面控制 | one-shot child 默认继承父 agent 全部工具；deep 推理应只推理 → prompt 明确约束 + 可选 `toolFilter`（实现时验证 `ToolRestriction` 语法，最小可用即可；若不稳，退化为仅 prompt 约束） |

**关键实现决策汇总**：
- 深推理 = one-shot `spawn` + 自建 AbortController（同时服务超时 180s / skip / stop / reroll / 插件卸载清理）。
- 主持人决策、成员 plan 均为轻量 LLM 补全（`completeText` + `extractJSON`），沿用现有容错。
- `subagent` 服务缺失 / parent 拿不到 / 超时 / 空结果 / 非 completed → 一律回退 direct（不报错，符合 §6.4）。

---

## 任务 0：基线清理与环境探针

- [x] 步骤 1：审视并提交工作区未提交改动（`git status` 当前 lib/engine.js、lib/index.js 有未提交 diff；确认是上一轮 f091cd4/ba69550 之后的遗留还是新改动，先 commit 再开始）
- [x] 步骤 2：用 `dev_stage_add` 挂一个临时探针工具（宿主 ctx）：`ctx.subagents.getProvider('spawn')` → `start('spawn', { parent: agents.get(<当前会话>), prompt: '用一句话回答 1+1', maxDepth: 1, signal })` → 打印 `run.result` 形状、stopReason、耗时；确认：a) 子代理完成后父会话**无**新增消息；b) abort 信号生效；c) `agentOptions` 显式带 provider/model 可用
- [x] 步骤 3：探针通过后 `dev_stage_demote` 清理；结论（若与第 0 节不一致）回写本节

**完成标准**：one-shot 路径在真实宿主跑通；无副作用通知。**结论**：probing 通过（completed / 1.5s / maxDepth 1 / agentOptions 可传；父会话 JSONL `subagent-settled` 与 childId 均为 0 次）。已 commit `1dc5024`（基线健壮性修正）。

---

## 任务 1：引擎数据模型与角色生成（lib/engine.js）

- [x] 步骤 1：常量与状态字段：新增 `HOST` 默认主持人常量（name=主持人 / persona / duty 按设计 §4.2）；`MAX_MODERATOR_TURNS = 60`；构造器增加 `host = null`、`turn = 0`、`allowDeepReasoning = true`、`deepThinkingRoleId = null`、`moderatorBusy = false`；**删除** `totalRounds` / `currentRound`（替换为 `turn`）
- [x] 步骤 2：`snapshot()`：新增 host/turn/allowDeepReasoning/deepThinkingRoleId/moderatorBusy；删除 currentRound/totalRounds；`paused` 保留
- [x] 步骤 3：`generateRoles(task)`：
  - prompt system 改为要求严格 JSON `{ "host": {name,persona,duty}, "roles": [...] }`；host 固定 1 个不占专家名额
  - 解析兼容：`{host,roles}` 对象 → 校验 host（缺失/非法 → 默认主持人）；**旧格式纯数组** → 数组即 roles + 默认主持人（§4.2）
  - roles 校验：3~6 个（容忍截断最多 8）、名称去重、id 固定 `r1..rN`；空 roles → error（保留现有行为）
  - 移除 `opts.rounds` 参数；调用方（generate-roles/命令）不再传轮数
- [x] 步骤 4：`updateRoles` 仅专家（去重逻辑保留）；`reroll` 拒绝 `roleId === 'host'`（v1 不支持主持人重发/改）

**完成标准**：单测（任务 6 的 role-gen 组）覆盖：`{host,roles}` 合法 / 旧数组兼容 / host 缺失兜底默认 / roles 空报错。

---

## 任务 2：主持人驱动循环（lib/engine.js，核心重构）

- [x] 步骤 1：`start()`：不再构建 `[speak×N, summarize]` 队列；置 `phase='discussing'`、`turn=0`、清空门上残留门闩后启动 `_runLoop()`
- [x] 步骤 2：`_runLoop()` 重构为主持人步进循环：
  ```
  while (phase === 'discussing') {
    检查 _stopped / 门闩(pause) / 连续失败上限 → break 或等待
    if (turn >= MAX_MODERATOR_TURNS) { 强制 summarize; break }
    turn++
    await _moderatorStep()   // 一次调度决策 + 执行
  }
  ```
  保留 finally 兜底（phase 仍 discussing 且无后续 → done）
- [x] 步骤 3：`_moderatorStep()`（主持人决策）：
  - 输入组装：task / 完整群聊历史（`_buildHistory` 预算内）/ 专家摘要（name+duty+已发言次数+最近一条消息摘要）/ 主持人 persona / 用户最新消息（若为最后一条）/ 当前 turn
  - system prompt 强制严格 JSON：`{action: 'speak'|'host_message'|'summarize', speakTo?, text?, instruction?}`；speakTo 必须是专家 id；host_message 必须有 text；speak 的 text 可选（非空则先串场）
  - 解析失败 → 重试 1 次；仍失败 / speakTo 无效 → 回退「发言次数最少专家」direct 发言（instruction 空）
  - 连续 3 次调度失败 → `phase='error'`（保留历史）
  - 执行期间 `moderatorBusy = true`（进入决策即置位，决策+执行结束复位）
- [x] 步骤 4：三分支执行：
  - `speak`：text 非空则先 `_speakAs('host', ...)` 追加主持人串场消息（流式，简短）→ 进入任务 3 成员管线
  - `host_message`：主持人串场（流式，`roleId='host'`）
  - `summarize`：`_summarize()`（复用现有实现）
- [x] 步骤 5：主持人消息写入共享 `messages`（`roleId='host'`、`name=host.name`）；导出 `_composeMd()`：团队成员区先主持人（徽标行）再专家；讨论过程含主持人消息
- [x] 步骤 6：`chat()` 行为调整：用户消息追加进历史后**不再** unshift 队首发言（由主持人下一步自然读取并决定是否点名）；`_bump()` 保留

**完成标准**：单测覆盖 speak / host_message / summarize 三分支；JSON 非法重试；least-spoken 回退；连续 3 次失败 error；turn≥60 强制总结。

---

## 任务 3：成员自主判断 + Deep 推理管线（lib/engine.js + deps 注入）

- [x] 步骤 1：`_memberPlan(role, instruction)`：轻量 LLM（maxTokens 小，约 300）→ 严格 JSON `{mode: 'direct'|'deep', subagentTask?}`；`allowDeepReasoning === false` → 直接 direct；解析失败/非法 → direct；该调用**不入消息流**
- [x] 步骤 2：`_runDeep(role, instruction, subagentTask)`：
  - 前置：`this.deps.subagents`（ctx.get('subagents')）可用 + `getProvider('spawn')` 存在 + `resolveParentAgent()` 拿到 Agent → 否则回退 direct
  - 组装自包含 prompt（spawn 无父上下文）：role persona / task / 相关群聊历史（预算内截断）/ instruction / subagentTask / 输出约束（中文化、不提及 AI、聚焦分析、可输出结论要点）
  - `const run = await subagents.start('spawn', { parent, prompt, maxDepth: 1, agentOptions: { provider, model }（继承 resolveRoute 结果）, signal: controller.signal })`；`deepThinkingRoleId = role.id`、`moderatorBusy = false`、状态提示置位
  - 超时：180s（`AbortSignal` + 定时器，挂 `ctx.effect`/统一清理）；超时 → `controller.abort()` → 回退 direct
  - `await run.result`：校验 `stopReason === 'completed'` 且 `output` 非空 → 提取文本为素材；否则（aborted/error/max-tokens/空）回退 direct
- [x] 步骤 3：成员整理发言：新增 `_speakWithMaterial(role, material, instruction)` —— 复用 `_speak` 的流式路径，system/用户提示改为「以该角色口吻，基于以下深度分析素材，整理成一段正式群聊发言（勿粘贴分析过程）」；流式中 `streamingRoleId = role.id`；结束后清 `deepThinkingRoleId`
- [x] 步骤 4：错误归一：最终整理发言失败 → 该条 `failed` + `_failureStreak += 1`；`_speak` 现有「连续 3 次失败 → error」逻辑保留；abort（skip/stop/reroll）→ 移除半截消息，不记失败
- [x] 步骤 5：index.js 注入 deps：`subagents: () => ctx.get('subagents')`、`resolveParentAgent: () => { const a = ctx.get('agents'); return a?.get?.(lastSessionId) ?? lastAgent }`；超时定时器宿主侧尽量用 Node 全局 `setTimeout`（host 进程），并保证 `_stop/_dispose` 清理
- [x] 步骤 6：并发保证：讨论串行（循环内 await deep 完成），无并行池；若实现时「深推理期间用户又插话」，插话只入历史，不打断当前 deep（符合 §7 表格）

**完成标准**：单测覆盖：direct / deep / 非法回退 direct / subagents 不可用回退 / start 抛错回退 / 超时回退 / 空结果与非 completed 回退 / deep 中 abort 生效（skip/stop/reroll）。

---

## 任务 4：控制语义对齐（lib/engine.js，§7 表格）

- [x] 步骤 1：统一 abort 面：`this._abort` 仍为当前动作的 AbortController（覆盖：主持人决策 LLM / 成员 plan LLM / subagent 的 signal / 最终发言流式，全部同源）；`_current` 记录当前阶段（`'moderator'|'plan'|'deep'|'speak'|'summarize'`）供 skip/reroll 分流
- [x] 步骤 2：`pause()`：仅置门闩；**不 abort** 当前 subagent/发言；当前动作完成后在下一步调度前等待（门闩检查放在每步循环顶部与 deep 前）
- [x] 步骤 3：`resume()`：释放门闩（现有逻辑）
- [x] 步骤 4：`skip()`：abort 当前动作；若为 deep → interrupt subagent（同信号）；移除半截发言消息；进入下一轮主持人调度（= 现有队列 shift 的语义替换）
- [x] 步骤 5：`stop()`：abort 当前动作（含 deep subagent）+ 清除 deepThinkingRoleId + 释放门闩 + `phase='done'`（保留现有收尾）
- [x] 步骤 6：`reroll(roleId)`：
  - `roleId === 'host'` → 忽略/报错（v1 不支持）
  - 专家：删除该专家最近一条消息；若 deep/发言推理中 → abort；补插「下一步调度优先点名该专家」（用一个 `_forcedRoleId` 标志，主持人决策前注入提示或直接跳过决策点名该成员）
- [x] 步骤 7：`chat()`：仅追加用户消息（不打断当前动作）；若讨论未运行（idle/done），保持现有仅追加行为

**完成标准**：控制矩阵单测：deep 中 skip/stop/reroll 均 abort subagent 且不残留 deepThinkingRoleId；pause 不中断 deep 且恢复后续调度；reroll host 被拒绝。

---

## 任务 5：HTTP API 与入口（lib/index.js）

- [x] 步骤 1：`handleAction`：
  - `generate-roles`：移除 `rounds` 参数（忽略 body.rounds）
  - **移除** `sync-rounds`；新增 `sync-settings`：`{ allowDeepReasoning: boolean }` → `engine.allowDeepReasoning = !!body.allowDeepReasoning; engine._bump()`
  - `reroll` / `update-roles`：host 不可操作（engine 层拒绝即可，入口透传）
  - 其余（start/pause/resume/skip/stop/chat/export-md）不变
- [x] 步骤 2：引擎构造 `deps` 增加任务 3 步骤 5 的 subagents / resolveParentAgent
- [x] 步骤 3：`/group-chat` 命令：`generateRoles(task)` 不再传 rounds；其余不变
- [x] 步骤 4：确认 GET /api/state 返回新 snapshot（含 host / turn / allowDeepReasoning / deepThinkingRoleId / moderatorBusy；不再有轮数）

**完成标准**：API 冒烟：generate-roles 不带 rounds、sync-settings 生效、state 无轮数字段。

---

## 任务 6：Client UI（src/client/index.js）

- [x] 步骤 1：设置区：**删除**「轮数」输入与 `rounds` state；新增「允许成员深度推理」开关（checkbox，初值 = snap.allowDeepReasoning（默认 true），onChange → `postAction('sync-settings', { allowDeepReasoning })`）；`generate-roles` 调用不再传 rounds；「开始讨论」不再先 sync-rounds
- [x] 步骤 2：角色区：主持人徽标块置于角色区最前（固定展示：昵称「主持人」+ 「主持」小徽标 + persona 提示，**无删除/重发/编辑按钮**）；专家 chips 照旧（含 ↻ 重发/✕ 删除）
- [x] 步骤 3：消息流：`roleId === 'host'` 走独立头像配色（金色系，如 `#f3b562`）+ 消息名用 `snap.host.name`；`deepThinkingRoleId` 非空 → 状态行「{name} 正在调用 subagent 深度推理…」；`moderatorBusy === true` → 状态行「主持人正在调度…」；`streamingRoleId === 'host'` → 「主持人正在输入…」；`streamingRoleId` 为专家 → 现有「正在输入…」
- [x] 步骤 4：`roleName()` 扩展对 'host' 的解析（host.name）；进度/状态提示优先级：deep 状态 > 主持人调度 > 正在输入
- [x] 步骤 5：结论区 / 导出 MD / 底部输入框不变；删除全部 `currentRound`/`totalRounds`/轮数相关引用

**完成标准**：client 构建通过；面板回归：无轮数控件、主持人徽标可见、deep 状态提示出现、开关切换生效。

---

## 任务 7：测试建设

- [x] 步骤 1：package.json 增加 `"test": "node --test test/host/"`；新增 `test/host/` 目录（node:test + 注入 fake llm：`llm.stream` 返回可迭代 chunk 或抛错的自定义对象；fake subagents（可模拟成功/超时/缺失/抛错））
- [x] 步骤 2：单测覆盖（对应设计 §11）：
  - role-gen：`{host,roles}` 合法 / 旧数组 / host 缺失兜底 / roles 空报错 / 名称去重 / 3-6 校验
  - 主持人循环：speak / host_message / summarize；JSON 非法重试 1 次；least-spoken 回退；连续 3 次调度失败 error；MAX_MODERATOR_TURNS 强制总结；同一成员多次点名 / 某成员全程不发言
  - 成员 plan：direct / deep / 非法回退；allowDeepReasoning=false 不触发 deep
  - subagent：成功 / 失败 / 超时 / 服务不可用回退 direct；deep 中 skip/stop/reroll interrupt；最终整理发言失败记 failed
  - 导出 md：含主持人 + 专家；host 消息在纪要中
- [x] 步骤 3：UI 测试：更新 `test/ui-panel-smoke.py`（断言：无轮数输入框、主持人徽标存在、⚙ 设置区含深度推理开关）；`test/ui-e2e.py` 增加 deep 状态提示检查（可选真实 deep 或 mock 版）
- [x] 步骤 4：`npm test` 全绿

---

## 任务 8：构建、注入与端到端验证

- [ ] 步骤 1：`dev_build_plugin(dir=/projects/dsh/dsh-group-chat)`（host 语法检查 + 导入链 + client tsdown 打包）通过
- [ ] 步骤 2：`dev_reload_package('dsh-group-chat')` 或 `dev_inject_plugin` 热装载
- [ ] 步骤 3：真实 E2E：`/group-chat 设计一款家庭记账 App 的 MVP 方案` → 主持人逐次点名（观察 host_message / 追问）→ 触发一次 deep（面板显示状态提示）→ 验证：
  a) 主会话**无** subagent-settled / 内部推理打扰消息
  b) 讨论结束自动总结 + 导出 md 含主持人区
  c) skip/stop/reroll 在 deep 中即时生效
  d) 关闭「深度推理」开关后不再触发 deep
  e) 暂停/继续语义符合 §7
- [x] 步骤 4：`test/ui-panel-smoke.py`、`test/ui-e2e.py` 回归通过

---

## 任务 9：文档与提交

- [x] 步骤 1：更新 `docs/specs/2026-09-05-dsh-group-chat-moderator-redesign.md`：状态 草案 → 已批准（经用户确认后）；在文末追加「实现注记」：记录 one-shot 决策（开放项 1 结论：startContinuable 必然推送 subagent-settled notice 且无关闭开关 → 改用 one-shot start + await result）与 snapshot 新增 `moderatorBusy` 扩展
- [x] 步骤 2：更新 `README.md`：主持人机制说明、无轮数（隐藏上限 60）、深度推理开关、控制语义表、API 变更（sync-settings）
- [ ] 步骤 3：按 `chinese-commit-conventions` 提交（feat：主持人驱动讨论 + 成员 subagent 深度推理）；删除/更新过时文档引用（如旧计划文件不做改动，仅新增本计划）

---

## 风险与注意

1. **one-shot child 会话可见性**：spawn child 是真实 session（origin=subagent），可能在 UI 会话列表短暂可见；实现时验证，若影响观感，考虑 child 完成后 `run.dispose()` 时机与 UI 过滤（先记录，非目标不阻塞）。
2. **工具面**：默认继承父 agent 全部工具；deep prompt 已约束「只推理」；实现时验证 `toolFilter` 是否能排除 subagent 工具（防递归派生）——若 ToolRestriction 语法不适配，退化为 prompt 约束（设计 §12 边界：「角色不执行通用工具」由 prompt + 只读历史保证）。
3. **成本与节奏**：deep 默认开启会显著增加调用成本；面板开关可关；主持人「不刷屏」规则与历史预算（24k 字符）沿用。
4. **模型路由**：子代理 `agentOptions` 继承主会话 route（与现有 resolveRoute 一致），无需用户额外配置。
5. **遗留 diff**：任务 0 必须先清理基线（当前工作区有未提交改动），否则升级 diff 不可审查。

---

## 预估工作量

| 任务 | 量级 |
|---|---|
| 任务 0 探针 | 0.5h（含验证） |
| 任务 1-2 引擎重构 | 2-3h |
| 任务 3 deep 管线 | 1.5-2h |
| 任务 4 控制语义 | 1h |
| 任务 5 API | 0.5h |
| 任务 6 Client | 1-1.5h |
| 任务 7 测试 | 1.5-2h |
| 任务 8 构建/E2E | 1h |
| 任务 9 文档 | 0.5h |
| **合计** | **~10-12h** |
