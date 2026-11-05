# Changelog

## [0.0.9] - 2026-11-05

- **修复 DSH 0.2.x 下群聊面板不显示**：0.2.x 的 `SessionListState` 从 0.1.x 的
  `{ current, byId, … }` 改成 `{ ids, byId, phase, projectionsBySession }`，面板的
  会话归属判断（`state.current`）永远读到 `undefined`，随后 `return null` 把整个
  面板与收起浮钮藏掉。归属判断改为：有当前会话 id 时仍按发起会话过滤，读不到时
  以 `bus.sessionId` / 快照里的发起会话为准，不再隐藏；后台轮询也不再因
  `currentSession` 未知而跳过，命令触发后能自动打开面板
- 客户端产物 `lib/client.js` 随 `src/client/index.js` 重建（tsdown）

## [0.0.8] - 2026-11-05

- **修复 DSH 0.2.x 会话格式 v4 下 `/group-chat` 锁死会话**（issue #1）：讨论完成回注
  主会话的 user 消息仍用 v3 的 `{ kind: 'plugin', plugin: 'dsh-group-chat' }` 来源，v4
  持久化校验直接拒绝（`format v4 message requires a producer-owned source kind`），
  会话随之不可再发送消息。新增 `lib/message-source.js`：按目标会话 `header.version`
  选择来源形态——v3 保留 `plugin` 包装，v4 用生产者自持的 `plugin:dsh-group-chat`
  （迁移规范约定的第三方插件 kind）；`form: 'notice'` / `summary` 保持不变，回注消息
  仍以通知行呈现
- 新增 `engines.dsh: ">=0.1.5-rc <2"`：桌面版插件兼容校验按宿主版本声明，覆盖
  `0.1.5-rc` 与 `0.2.x` 预发布（含 `0.2.1-rc.*`）
- 新增 `test/host/message-source.test.mjs`：v3 / v4 来源形态与版本回落单测
- 修复单测在 Windows 下误败：两处独立子进程用例的 `cwd` 由 URL pathname
  （`/D:/...`）改为 `fileURLToPath`，`npm test` 在 Windows 可直接跑通

## [0.0.7] - 2026-09-15

- **适配 DSH 0.1.5-rc.2 与官方 Electron 桌面版**
- 面板通信通道迁移：`webServer.register('/dsh-group-chat')` 前缀路由 →
  `ctx.connection.fetch.register` 在共享 `/api` 通道注册精确 Fetch 路由
  （`GET /api/group-chat/state`、`POST /api/group-chat/command`，动作改由请求体
  `action` 字段携带）。桌面版默认不装配 webserver，旧前缀路由在桌面版下不可达
  （面板彻底失联）；迁移后 web 版与桌面版走同一条路径
- 修复桌面版启动校验拒绝：peer 范围 `>=0.0.1-rc <2` 按 semver 预发布元组规则
  不匹配 `0.1.5-rc.2`，改为 `>=0.1.5-rc <2`；从 peerDependencies 移除由 Web
  前端模块表提供的 client-only 包（`@deepseek-ai/dsh-client-ui-slots`）与
  包名不存在的 `cordis`/`schemastery`（后者正确包名是 `@deepseek-ai/schemastery`，
  且本插件未直接使用）
- 补齐可安装性：新增 `cordis.patch.yml` 并在 `package.json` 声明
  `dsh.bundle.patch`——此前经 `dsh plugin add` / 桌面版插件管理安装后 host 半
  不会被装配
- 修正 `dsh.client.inject`：移除 0.1.5 线已不存在的 `@deepseek-ai/dsh-client-runtime`，
  改为实际提供所用 slot 的 `@deepseek-ai/dsh-client-ui-conversation`（会话头按钮）
  与 `ui-layout`（`shell.overlay` 面板），保留 `ui-slots`
- 新增 `scripts/desktop-compat-check.mjs`（`npm run check:desktop`）：真值调用官方
  `apps/desktop/src/profile-packages.ts` 的 `validateDesktopPluginGraph`，对 npm pack
  产物做桌面版契约等价校验

## [0.0.6] - 2026-09-05

- 新会话页不再显示群聊悬浮按钮：快照新增 `sessionId`（群聊归属会话），
  收起的浮钮仅当本会话存在群聊上下文（活动/任务且归属当前会话）时显示；
  其它会话页与新会话/空闲页均隐藏

## [0.0.5] - 2026-09-05

- 修正安装命令参数顺序：`--profile <name>` 必须紧跟 `plugin` 子命令
  （`dsh plugin --profile web add …`；旧写 `dsh --profile web plugin …` 报
  `required option '--profile <name>' not specified`），并补充 PowerShell 引号提示

## [0.0.4] - 2026-09-05

- 安装文档改为 DSH 插件命令形态（`dsh --profile web plugin add @stars-w/dsh-group-chat`，
  底层为 profile 目录 pnpm 转发到 npm 仓库），补充市场一键安装/卸载/依赖树说明

## [0.0.3] - 2026-09-05

- 修复 README 被打包占位版本覆盖的问题（GitCode 初始提交冲突时误用占位文件），
  重写为资料齐全的开源文档：功能表 / 安装 / 使用 / 架构 / 状态机 / 控制语义 /
  HTTP API 参考（快照字段与动作表）/ 配置 / 错误处理 / 开发测试发布 / FAQ /
  版本兼容 / 非目标

## [0.0.2] - 2026-09-05

- 修正 npm registry 首个版本包元数据 packument 不可读问题（重发布以触发聚合层重建）；
  0.0.1 内容同 0.0.2

## [0.0.1] - 2026-09-05

首个开源版本。

### 新增
- **主持人制讨论**：角色生成产出 `{ host, roles }`（1 主持人 + 3~6 专家）；主持人对每步 LLM 动态决策 `speak`（点名/串场）、`host_message`（串场）、`summarize`（收尾），不固定轮数；隐藏安全上限 60 步后强制总结
- **成员深度推理**：被点名专家先做一次轻量 `direct/deep` 自主判断；`deep` 时派生一次性 spawn subagent（maxDepth 1、180s 超时、零工具面）深度分析，再以角色口吻流式整理为正式发言；subagent 失败/超时/不可用自动回退 `direct`，不打断讨论
- **深度推理开关**（默认开启，可随时切换）；**用户插话**由主持人下一步优先处理
- **控制语义**：暂停（不中断 deep）/ 继续 / 跳过 / 停止 / 专家重发（主持人优先点名），均基于统一 AbortController 实现可中断
- **讨论结论**：自动生成 markdown 结论（结论 / 关键分歧 / 行动建议 / 参考意见）并导出到工作区，结论自动回注主会话
- **面板交互**：可拖动面板（位置记忆）、收起态状态化悬浮按钮（讨论中呼吸脉冲+跳动点动画）、消息流与结论区按 markdown 渲染（窄面板小字号）
- **宿主集成**：`/group-chat <任务>` 斜杠命令、`/dsh-group-chat/api/*` HTTP 路由、会话头部入口

### 测试
- host 单测（node:test）40 项：角色生成兼容矩阵 / 主持人循环与失败回退 / 成员 plan 与 deep 管线 / 控制语义 / 历史预算 / 导出
- UI 回归（Playwright）：面板冒烟、无轮数控件、深度推理开关、主持人徽标、浮钮
