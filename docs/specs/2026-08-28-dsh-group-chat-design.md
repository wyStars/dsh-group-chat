# dsh-group-chat 设计文档

> 日期：2026-08-28
> 状态：已获用户批准（引擎=轻量 LLM 模拟；形态=群聊面板 UI；角色=由任务实时生成；节奏=全自动+可干预；交付=结论展示+导出 md 存工作区；交付形态=Bundle 插件）

## 1. 目标

一个 DSH 群聊插件：用户输入一个任务 / 设计方案 → 插件根据任务实时生成多个角色（带 persona）的团队 → 团队在群聊界面中自动逐轮讨论、头脑风暴 → 讨论结束后生成结论摘要，并可导出为一份 md 文档写入工作区。所有角色共享同一份群聊历史上下文。

## 2. 交付形态

- 项目目录：`/projects/dsh/dsh-group-chat`
- Bundle 插件（hybrid：host 编排 + client 面板），走 `dev_scaffold_plugin` → `dev_build_plugin` → `dev_inject_plugin` 注入
- 与现有生态（dsh-parallel-pool / dsh-shell-callback）一致：`package.json`（peerDeps 范围声明）+ `src/`（TS）+ `scripts/build.sh` + `lib/` 产物

## 3. 架构

```
Host（编排引擎）
  GroupChatEngine 状态机： idle → generating-roles → discussing → summarizing → done
    分支： paused（讨论中暂停）/ error（连续失败后中止）
  · generateRoles(task)   LLM 生成角色团队 JSON（3~6 个角色：name/persona/duty）
  · speak(role, history)  LLM 按 persona+群聊历史逐轮发言（流式）
  · summarize()           LLM 生成结论摘要（一句话结论+关键分歧+建议）
  · exportMd()            任务+角色+完整纪要+结论 → md → fs 写入工作区
  · RPC（harness.handle）: get-state / start / pause / resume / skip /
    stop / regenerate-roles / export-md / reroll / update-roles
    - reroll(roleId)：删除该角色最后一条发言并从同轮重新生成（替换语义）
    - update-roles：面板上用户增删改角色后同步到引擎（讨论进行中仅停止后生效）

Client（群聊面板）
  · 入口：conversation.session.header.actions（会话头部「群聊」按钮）
  · 主浮层：shell.overlay（可开合全宽面板）
  · 组件：任务输入区 / 角色预览卡片（可增删改、重新生成）/ 消息流（气泡+流式）/
    控制条（开始/暂停/继续/跳过/停止）/ 结论区（摘要+导出md+复制）
  · 通信：Client→Host 走 host.call；Host→Client 轮询 get-state（500ms 快照）
```

## 4. 数据模型

```ts
interface ChatRole { id: string; name: string; persona: string; duty: string }
interface ChatMessage { roleId: string; name: string; text: string; at: number; failed?: boolean }
interface ChatState {
  phase: 'idle'|'generating-roles'|'discussing'|'summarizing'|'done'|'error'
  task: string
  roles: ChatRole[]
  messages: ChatMessage[]
  currentRound: number
  totalRounds: number
  summary?: string          // 结论摘要
  error?: string
  mdPath?: string           // 导出后的工作区路径
  mdContent?: string        // 最近一次导出内容（客户端可复制）
}
```

共享上下文实现：所有角色共用同一份 `messages`（群聊历史），每次发言前把历史注入发言 prompt —— 每个角色都能看到前面所有人的发言。

## 5. LLM 调用

统一走宿主 `llm.stream`（与 dsh-parallel-pool 相同用法）：

```ts
llm.stream({ provider, model, messages, system, maxTokens, sessionId, purpose, signal })
// 返回 chunk 流；用 BlockAssembler 聚合，blocks() 取 text
// messages 格式：[{ role: 'user', content: [{ type: 'text', text }] }]
```

- provider/model 取自当前 agent 的 options（`agent.options.provider/model`），未取到时回退默认模型路由
- 角色生成要求 JSON 输出（system 明确约束），解析失败自动重试 1 次
- 每次发言独立调用；暂停/停止通过 AbortSignal 中断

## 6. 错误处理

| 场景 | 处理 |
|---|---|
| 单角色单轮发言失败 | 该条消息标记 failed，记入历史，跳过继续下一轮 |
| 连续失败（≥3 次） | 讨论中止，phase=error，保留历史与已生成角色 |
| 角色生成 JSON 解析失败 | 重试 1 次后报 error |
| export 写入失败 | 面板提示错误，mdContent 仍可复制 |
| 插件卸载后轮询 | 面板显示离线态并禁用控件 |

## 7. 默认参数（面板可覆盖）

- 角色数量：3~6（按任务复杂度由 LLM 决定，默认上下限 3~6）
- 讨论轮数：3 轮（一轮 = 所有角色各发言一次）
- 每轮发言长度：默认 400 token
- 轮询间隔：500ms

## 8. 测试

### 单元测试（Host，mock llm）
- 角色生成 JSON 解析（合法/非法/重试）
- 轮次推进与发言顺序
- 失败跳过与连续失败中止
- 导出 md 拼接正确性（任务/角色/纪要/结论齐全）

### 端到端验证
- 注入插件 → 输入真实任务（如"设计一个家庭记账 App 的方案"）→ 生成角色 → 自动讨论 → 总结 → 导出 md → 确认工作区文件存在且内容合理

## 9. 非目标（YAGNI）

- 不做持久化（插件生命周期内状态即存；动态插件不需要耐用存储）
- 不做角色真实工具执行（纯讨论者，如需要动手的结论由当前会话/主 agent 产出）
- 不做多群聊并行管理（一次一个群聊会话）
