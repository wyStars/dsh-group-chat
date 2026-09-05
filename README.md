# @stars-w/dsh-group-chat

基于当前会话的 **AI 主持人驱动多角色群聊**：在主会话输入 `/group-chat <任务/设计方案>` 即呼起群聊 —— 自动生成 **1 位 AI 主持人 + 3~6 位专家**（各有 persona 与职责）并拉入群聊，右侧竖长聊天面板自动展开；**主持人动态调度**（不固定轮数）：每步决定点名谁发言、是否串场、何时收尾；被点名的专家可自主判断是否调用 **subagent 深度推理** 再整理为正式发言；**你可以随时插话参与**；讨论结束自动生成结论并导出 Markdown 文档到工作区。

> 适用：**DeepSeek Harness（DSH）** Host 环境（whale-girl 纯 ESM 模式 + Web 浏览器面板）。英文项目名 `group-chat`，常被本地装配为 `dsh-group-chat`。

## 功能

| 能力 | 说明 |
|---|---|
| 指令呼起 | `/group-chat <任务>`（主会话输入框）→ 基于当前会话建团拉群并自动开始讨论，右侧面板自动打开 |
| 主持人制 | 角色生成时 LLM 产出 `{host, roles}`（1 主持人 + 3~6 专家）；主持人每步决策 `speak`（点名/串场）、`host_message`（串场）、`summarize`（收尾）——同一专家可被多次点名，不被强制全员发言 |
| 角色实时生成 | 专家可重新生成/增删；**主持人固定展示（不参与增删改）**，更换请「重新生成角色团队」 |
| 右侧竖长聊天框 | `shell.overlay` 右停靠窄面板（无全屏遮罩、不隔离会话），头部紧凑；**按住头部空白区可拖动面板**（位置记忆，拖出停靠区后为浮动模式） |
| 收起态悬浮按钮 | 面板收起后，主会话内容区左上方出现悬浮入口（不遮挡内容主体）：**待命**（常规样式）/ **讨论中**（绿色呼吸脉冲 + 三个跳动点动画）/ **出错**（红色描边）——点击即展开面板 |
| **成员深度推理** | 被点名专家先做一次轻量 `direct/deep` 判断；`deep` 时派生一次性 spawn subagent（maxDepth 1、180s 超时、零工具面）深度分析，再把素材流式整理为正式发言；subagent 失败/超时/不可用自动回退 `direct`，不打断讨论 |
| 深度推理开关 | ⚙ 设置区「允许成员深度推理」默认开启，可随时切换（当前发言/推理中的成员不受影响） |
| **用户参与讨论** | 面板底部消息输入框：以主持人身份插话，消息进入共享群聊历史，主持人下一步优先处理（若消息点名了某专家，主持人会调用 TA） |
| **MD 格式显示** | 消息流与结论区按 markdown 渲染（标题/粗斜体/列表/代码块/引用/链接/删除线），**字号显著小于标准 md**（12.5px 基准，适配窄面板展示密度） |
| 讨论干预 | 暂停（不中断 deep）/ 继续 / 跳过（中断当前发言与 deep）/ 停止 / 让某专家重发（↻，主持人优先点名该专家） |
| 结论总结 | 讨论结束自动生成 markdown 结论（结论 / 关键分歧 / 行动建议 / 参考意见）并**自动回注主会话** |
| 导出 MD | 任务 + 主持人 + 团队 + 完整讨论纪要 + 结论 → 写入工作区 `group-chat-<slug>-<时间戳>.md` |
| 自动呼起 | 面板关闭时后台 2s 轻轮询：检测到群聊活动（指令/命令触发）自动打开面板 |

## 安装

本插件是 **DeepSeek Harness（DSH）** 宿主插件（host 编排引擎 + 浏览器面板），作为 Bundle 插件注入/装配：

```bash
# 从 npm 安装（发布包含 lib/ 运行产物 + README + LICENSE + CHANGELOG）
npm install @stars-w/dsh-group-chat
```

- **peer 依赖**（由 DSH 宿主运行时提供）：`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-tools`、`cordis`（≥4.0.0-rc）、`schemastery`、`@deepseek-ai/dsh-client-ui-slots`
- **DSH 装配**：在 DSH 的 `cordis.yml`（`include` 装配）或注入器（`dev_inject_plugin`）中加载本包；插件提供 `/group-chat` 命令、Web 面板与 `/dsh-group-chat/api/*` HTTP 路由。
- **源码开发**：`git clone` 后 `npm install && npm run build`（构建依赖注入器工具链，见 `scripts/build.sh`）。

## 使用步骤

1. **主会话输入框**输入指令：`/group-chat <任务/设计方案>` 回车（如 `/group-chat 设计一款家庭记账 App 的核心产品方案`）
2. 右侧「群聊」面板自动打开：角色团队生成中（拉群中）→ 主持人开始调度讨论
3. 随时在面板**底部输入框**插话（Enter 发送）——主持人会在下一步优先处理；也可 ⚙ 调整任务/深度推理开关/角色，暂停/跳过/停止
4. 讨论结束自动展示**结论** → **📄 导出 MD**（写入工作区并显示路径）
5. 也可点会话顶部「💬 群聊」按钮，或收起后点击左上方悬浮按钮打开面板查看/管理

## 架构

```
浏览器（client bundle）                     host 进程（lib/index.js + engine.js）
─────────────────────────────              ──────────────────────────────────
主会话 composer                            slash command：/group-chat <任务>
  └── 输入 /group-chat <任务> ──────────────▶ commands.register → 建团+自动讨论
conversation.session.header.actions          GroupChatEngine 状态机：
  └──「💬 群聊」入口按钮                       idle → generating-roles → discussing
shell.overlay（右停靠/可拖动面板）           → summarizing → done（/ paused / error）
  └── 头部(摘要+状态+⚙设置折叠)                · llm.stream 驱动：角色生成 {host, roles} /
      消息流（主持人/角色/用户气泡）             主持人调度决策 / 成员发言 / 总结
      状态提示（调度中/deep 中/输入中）          · 主持人步进循环：speak | host_message |
      深度推理开关 + 主持人徽标                  summarize（隐藏上限 60 步后强制总结）
      底部参与输入框（主持人插话）              · 成员管线：plan(direct/deep) → 流式发言
      │  fetch（打开 500ms / 后台 2s 快照）      或 deep(spawn subagent maxDepth 1, 180s)
      └──────────────▶ /dsh-group-chat/api     · 失败回退：主持 JSON 非法→least-spoken；
      GET  /state（快照）                       子代理失败/超时→direct 发言
      POST /generate-roles | start | pause | resume | skip | stop | chat
           | reroll | update-roles | sync-settings | export-md
```

- **基于会话发起**：命令 handler 取当前 agent 的 session（绑定 sessionId）；模型路由优先该会话 agent 的 `options.provider/model`，回退「默认模型选择」（deep subagent 继承同一路由）。
- **上下文共享**：主持人、专家、用户共用同一份 `messages`；主持人决策与成员发言均注入「任务 + 群聊历史（预算 24k 字符，超限保留最近）」。
- **Deep 子代理**：一次性 `spawn`（全新上下文、无父历史），prompt 自包含（角色 persona / 任务 / 相关历史 / 主持人 instruction / 分析作业）；`await run.result` 取最终输出，**不向主会话注入任何内部推理通知**；与 skip/stop/reroll/超时共用同一 AbortController。
- **面板交互**：面板可拖动（位置持久化到 `localStorage`）；收起态悬浮按钮按讨论状态切换样式；消息/结论按 markdown 小字号渲染。

## 状态机

```
idle ──generateRoles(task)──▶ generating-roles ──成功──▶ idle（角色就绪）
idle ──start()──▶ discussing ──主持人步进循环──▶ summarizing ──▶ done
                    │                              （隐藏上限 60 步 → 强制 summarize）
                    ├─ pause()  ──▶ paused（门闩；不中断 deep，动作完成后暂停）
                    ├─ 连续 3 次最终发言失败 / 主持人连续 3 次调度失败 ──▶ error（保留历史）
                    └─ stop()    ──▶ done（保留已有历史，可导出）
```

## 控制语义

| 操作 | 讨论中 | deep 推理中 | 效果 |
|---|---|---|---|
| 暂停 | 有效 | 不中断当前 subagent | 当前动作完成后，在下一步调度前暂停 |
| 继续 | 有效 | — | 释放暂停门闩 |
| 跳过 | 有效 | 有效 | abort 当前发言/subagent；移除半截消息；进入下一轮主持人调度 |
| 停止 | 有效 | 有效 | abort 当前发言 + interrupt subagent；清空后续；`phase=done` |
| 重发（专家） | 有效 | 有效 | 删除该专家最近一条消息；若在推理则 interrupt；主持人下一步优先点名 |
| 重发（主持人） | v1 不支持 | — | 不提供该能力 |
| 用户插话 | 有效 | 有效 | 只追加用户消息，不打断当前动作；下一步主持人优先处理 |

## HTTP API

宿主进程注册前缀路由 `/dsh-group-chat`，浏览器面板与外部脚本以**同源 fetch** 调用（请求可携带 `sessionId`，用于模型路由/导出目录解析）。

### GET `/api/state` —— 快照轮询

| 字段 | 说明 |
|---|---|
| `phase` | `idle` / `generating-roles` / `discussing` / `summarizing` / `done` / `error` |
| `task` | 本次讨论任务文本 |
| `host` | 主持人 `{id:'host', name, persona, duty}`（未生成时 `null`） |
| `roles` | 专家数组 `{id, name, persona, duty}`（id 固定 `r1..rN`） |
| `messages` | 群聊消息 `{id, roleId, name, text, at, failed}`（`roleId` ∈ `host`/`user`/`r1..rN`） |
| `turn` | 已进行的调度次数（隐藏上限 60 用） |
| `allowDeepReasoning` | 成员深度推理开关 |
| `deepThinkingRoleId` | 正在调用 subagent 深度推理的成员 id（无则 `null`） |
| `moderatorBusy` | 主持人正在调度/决策 |
| `streamingRoleId` | 正在流式发言的角色 id |
| `paused` | 暂停中 |
| `summary` / `error` / `mdPath` / `mdContent` | 结论 / 错误 / 最近导出路径与内容 |
| `version` | 快照版本号（轮询去重用） |

### POST `/api/<action>`

| Action | 参数 | 说明 |
|---|---|---|
| `generate-roles` | `{ task }` | 生成 `{host, roles}`；讨论/生成中拒绝 |
| `start` | — | 开始讨论（需角色已生成） |
| `pause` / `resume` | — | 暂停（不中断 deep）/ 继续 |
| `skip` / `stop` | — | 跳过当前动作 / 停止讨论（保留历史） |
| `reroll` | `{ roleId }` | 专家重发（host 拒绝） |
| `chat` | `{ text }` | 用户插话（入历史，不打断当前动作） |
| `update-roles` | `{ roles: [...] }` | 增删改专家（仅非讨论中；主持人不可改） |
| `sync-settings` | `{ allowDeepReasoning }` | 开关深度推理 |
| `export-md` | — | 导出 md（写入会话 cwd，返回 `{path, content, cwd, error}`） |

响应：`{ ok: true, phase, version }`；错误：`{ ok: false, error }`。

## 配置

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `GC_DEEP_TIMEOUT_MS` | `180000` | deep subagent 超时（ms）；超时中断并回退 direct |
| `GC_MAX_MODERATOR_TURNS` | `60` | 主持人调度隐藏上限；达到后强制总结 |

引擎常量（`lib/engine.js`）：`HISTORY_BUDGET=24000`（历史注入字符预算）、`DEFAULT_MAX_CHARS=900`（单条发言约值）、`MAX_FAILURE_STREAK=3`（连续发言失败中止阈值）。

## 错误处理

| 场景 | 行为 |
|---|---|
| 主持人决策 JSON 非法 | 重试 1 次；再失败回退「发言最少专家」direct 发言 |
| 主持人连续 3 次调度失败 | `phase=error`（保留已有历史） |
| 成员 plan JSON 非法 | 按 direct 回退 |
| subagent 不可用 / 失败 / 超时 | 按 direct 回退，不报错 |
| 最终成员发言失败 | 该条 `failed`，计入连续失败 |
| 连续 ≥3 次最终发言失败 | `phase=error`，保留历史 |
| 隐藏上限 60 次调度 | 强制 summarize |
| 导出失败 | 返回 `error` 字段；`mdContent` 仍可复制 |

## 开发 / 测试 / 发布

```bash
npm test                    # host 单测（node:test，40 项：角色生成/主持人循环/member-deep/控制语义）
bash scripts/build.sh       # 依赖链接 + host 语法/导入链校验 + tsdown 打包 client
npm run build:client        # 仅打包 client（tsdown → lib/client.js）
# UI 回归（Playwright；需本地 dsh web 认证 cookie）：
python3 test/ui-panel-smoke.py
python3 test/ui-e2e.py
# 注入器环境（DSH 开发工作流）：
dev_build_plugin . && dev_inject_plugin . && dev_reload_package dsh-group-chat
# 发布：
npm publish --dry-run && npm publish    # 需 @stars-w scope 权限（publishConfig.access=public 已声明）
```

- Host：纯 ESM JS（`lib/`，无编译步骤）；Client：`src/client/index.js` → tsdown → `lib/client.js`（`ModuleLoader.load` 注册）。
- 注入后刷新 Web 页面，会话头部即出现「💬 群聊」。

## 文件结构

```
lib/index.js        host 入口：webServer 前缀路由 /dsh-group-chat + 动作分发 + 模型路由/导出目录解析
lib/engine.js       GroupChatEngine：状态机、角色生成 {host,roles}、主持人步进循环、成员 plan/deep、总结、导出
lib/llm.js          LLM 封装（llm.stream + BlockAssembler 聚合、JSON 容错提取）
src/client/index.js 群聊面板 UI（入口按钮 + overlay 面板 + 轮询 + 悬浮按钮 + md 渲染）
scripts/build.sh    构建脚本
test/               host 单测（node:test）+ Playwright UI 回归脚本
docs/specs/         设计规格（2026-08-28 初版 / 2026-09-05 主持人制 + 实现注记）
docs/superpowers/plans/  实现计划（含任务勾选与验证记录）
```

## 常见问题（FAQ）

- **面板显示「已与群聊服务断开」**：插件被卸载/热重载或 DSH 重启。重载后刷新页面即可恢复。
- **讨论显示「出错」**：多为主持人/成员连续调度失败（模型瞬时输出非 JSON）。保留历史可直接导出；点「重新生成」换任务重试。
- **深度推理没触发？**：成员 plan 是轻量判断，简单问题会走 direct。可在 ⚙ 设置区关闭/开启「允许成员深度推理」；当前发言/推理中的成员不受切换影响。
- **导出的 md 在哪？**：会话工作目录（会话 `header.cwd`），面板显示相对路径；讨论完成会自动导出并回注主会话。
- **面板挡住主会话？**：按住面板头部空白区可拖动到任意位置（贴右侧恢复停靠形态）；收起时悬浮按钮在内容区左上方且不遮挡内容主体。

## 版本兼容

- DSH 宿主：`dsh-web` rc 系列（`/dsh-group-chat` 前缀路由 + `webServer`/`commands`/`agents`/`subagents` 服务）。
- 深层依赖（peer）：见 `peerDependencies`。Deep 推理需宿主装配 `@deepseek-ai/dsh-subagent` 与 `@deepseek-ai/dsh-subagent-spawn-in-process`（provider `spawn`）；缺失时自动回退 direct 发言。

## 非目标（YAGNI）

- 角色不执行通用工具（仅深度推理 subagent 一种内部能力）
- 不做持久化（插件生命周期内状态即存）
- 不做多群聊并行（一次一个群聊会话）
- 不做主持人单独编辑/删除、不做用户手动点名（可通过插话让主持人调度）

## License

[BSD-3-Clause](./LICENSE) © 2026 wy_stars
