# dsh-group-chat 实现计划

> **面向 AI 代理的工作者：** 本计划在当前会话内联执行（用户已授权"开始实施"）。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 构建 DSH 群聊插件——任务驱动生成角色团队、自动多轮讨论、总结结论、导出 md 到工作区。

**架构：** Bundle 插件（hybrid：host 编排引擎 + client 群聊面板）。Host 用 `llm.stream`（与 dsh-parallel-pool 相同调用方式）驱动角色生成/逐轮发言/总结；Client 注册 `conversation.session.header.actions` 入口按钮 + `shell.overlay` 浮层面板，Client→Host 走 `host.call` RPC，Host→Client 用 500ms 轮询 `get-state` 快照。

**技术栈：** TS + tsdown（client）+ tsc（host），peerDeps：@deepseek-ai/dsh-llm、@deepseek-ai/dsh-tools；注入器 dev_scaffold_plugin → dev_build_plugin → dev_inject_plugin。

**规格：** `docs/specs/2026-08-28-dsh-group-chat-design.md`

---

## 文件结构

- `package.json` — 包声明（peerDeps 范围、dsh.client 平台、main=lib/index.js）
- `scripts/build.sh` — DSH_CHECKOUT 探测 + tsc 编译 host + tsdown 编译 client → lib/
- `src/index.ts` — Host 插件入口：引擎实例化、RPC 注册、注入声明
- `src/engine.ts` — GroupChatEngine：状态机、角色生成、发言引擎、总结、导出
- `src/llm.ts` — LLM 调用封装（stream + BlockAssembler 聚合、JSON 解析辅助）
- `src/client.ts` / `src/client/*.tsx` — Client 面板 UI（入口按钮、overlay、消息流、控制条、结论区）
- `lib/` — 构建产物（index.js + client.js）
- `docs/specs/2026-08-28-dsh-group-chat-design.md` — 已批准的设计文档

## 任务清单

### 任务 1：脚手架生成项目骨架

- [ ] 步骤 1：`dev_scaffold_plugin(dir=/projects/dsh/dsh-group-chat, name=dsh-group-chat, form=hybrid)` 生成骨架
- [ ] 步骤 2：阅读生成的结构（package.json、src/、scripts/build.sh），确认 host/client 双端入口与构建脚本
- [ ] 步骤 3：调整 package.json（名称 @dsh-external/dsh-group-chat、描述、keywords），commit 初始骨架

### 任务 2：Host LLM 调用封装（src/llm.ts）

- [ ] 步骤 1：导出 `callLLM(handler, opts)`：调 `llm.stream({provider, model, messages, system, maxTokens, sessionId, purpose, signal})`，BlockAssembler 聚合 text
- [ ] 步骤 2：导出 `parseJSONFrom(text) -> unknown|null`：去掉代码围栏、截取首个 JSON 对象/数组，容错解析（失败返回 null 供重试）

### 任务 3：Host 引擎（src/engine.ts）

- [ ] 步骤 1：`GroupChatEngine` 类：state 字段（task/roles/messages/currentRound/summary/phase…）
- [ ] 步骤 2：`generateRoles(task, signal)`：roleGen 提示词（JSON 输出 3~6 角色 name/persona/duty），解析失败重试 1 次
- [ ] 步骤 3：`start()`：置 discussing，按轮次遍历角色，`speak(role)` 流式发言追加消息；pause/resume/skip/stop/reroll 控制
- [ ] 步骤 4：`summarize()`：总结提示词生成结论摘要（一句话结论+关键分歧+建议）
- [ ] 步骤 5：`exportMd()`：拼装 md（任务/角色/纪要/结论）→ 写入工作区 `group-chat-<slug>-<ts>.md`，返回 {path, content}
- [ ] 步骤 6：错误处理：单轮失败标记 failed 跳过；连续 ≥3 次失败 → phase=error；AbortSignal 贯穿

### 任务 4：Host 入口与 RPC（src/index.ts）

- [ ] 步骤 1：插件声明（inject: llm/fs/agent/…，ctx.effect 生命周期）
- [ ] 步骤 2：`harness.handle` 注册：get-state / start / pause / resume / skip / stop / regenerate-roles / reroll / update-roles / export-md
- [ ] 步骤 3：handler 中取当前 agent（provider/model + sessionId + cwd→工作区）

### 任务 5：Client 群聊面板（src/client）

- [ ] 步骤 1：入口按钮注册 `conversation.session.header.actions`（id: group-chat-open，打开 overlay）
- [ ] 步骤 2：overlay 注册 `shell.overlay`：任务输入区、角色预览卡片、消息流、控制条、结论区
- [ ] 步骤 3：状态同步：500ms 轮询 `host.call('get-state')`，只在 version 变化时 setState
- [ ] 步骤 4：交互：调 host.call(start/pause/…)；流式文本渲染（消息逐条出现 + 当前发言者打字动效提示）
- [ ] 步骤 5：结论区：摘要展示 + 导出按钮（调 export-md，显示路径）+ 复制内容按钮

### 任务 6：构建与注入验证

- [ ] 步骤 1：`dev_build_plugin(dir=/projects/dsh/dsh-group-chat)` 构建通过
- [ ] 步骤 2：`dev_inject_plugin(dir=/projects/dsh/dsh-group-chat)` 注入成功（host + client 双端）
- [ ] 步骤 3：端到端：面板打开 → 输入"设计一个家庭记账 App 的方案" → 生成角色 → 自动讨论 → 总结 → 导出 md → 校验工作区文件
- [ ] 步骤 4：README（用法、配置、架构说明）+ 修复发现的问题
