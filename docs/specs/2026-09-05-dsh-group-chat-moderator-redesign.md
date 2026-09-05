# dsh-group-chat 主持人驱动讨论 + 成员 Subagent 深度推理 设计文档

> 日期：2026-09-05
> 状态：草案（待用户审查）
> 关联旧设计：`docs/specs/2026-08-28-dsh-group-chat-design.md`
> 目标：彻底替换“固定轮数 + 全员轮流发言”，改为 AI 主持人动态调度；成员可自主判断是否调用 subagent 做深度推理。

---

## 1. 背景与目标

当前实现是预设 `totalRounds`，每一轮让所有团队成员按固定顺序各发一次言。问题：

- 不是所有问题都需要每个成员都发言；
- 同一个问题可能需要某位成员多次深入回答；
- 讨论节奏由“轮数”硬性决定，不符合真实群聊逻辑。

本次改造目标：

1. 新增一个随团队生成的 AI 主持人，动态掌控讨论。
2. 由主持人每步决定：点名谁发言、主持人是否串场、何时结束。
3. 成员被点名后可以自行判断是否需要 subagent 深度推理，再将推理结果整理成正式发言。
4. 面板可关闭“成员深度推理”，保留成本控制。
5. 保留现有暂停/继续/跳过/停止/重发/用户插话等控制能力。

---

## 2. 总体架构

```
generateRoles(task)
  → LLM 生成 { host, roles }（1 个主持人 + 3~6 个专家）

start()
  → phase = discussing
  → 主持人驱动循环：

      ┌────────────────────────────────────────────┐
      │ 主持人调度决策（LLM）                        │
      │  action = speak | host_message | summarize   │
      └───────────────┬────────────────────────────┘
                      │
        ┌─────────────┼───────────────────┐
        ▼             ▼                   ▼
   speak          host_message        summarize
        │             │                   │
   （可选先加主持人   追加主持人消息      进入总结
     公开串场消息）      → 继续下一轮
        │
        ▼
   成员自主判断：direct / deep
        │                    │
        ▼                    ▼
   直接流式发言        派 subagent 深度推理
                          → 成员流式整理发言
        │                    │
        └────────→ 下一轮调度 / 或 summarize
```

- 主持人、专家、用户都共享同一份 `messages` 群聊历史。
- 讨论串行执行：同一时间最多一个成员正在发言，最多一个 deep subagent 在运行。

---

## 3. 数据模型

```ts
interface HostRole {
  id: 'host'
  name: string
  persona: string
  duty: string
}

interface ChatRole {
  id: string       // 'r1'...'rN'
  name: string
  persona: string
  duty: string
}

interface ChatMessage {
  id: string
  roleId: string   // 'host' | 'user' | 'r1'...'rN'
  name: string
  text: string
  at: number
  failed?: boolean
}

interface ChatState {
  phase: 'idle' | 'generating-roles' | 'discussing' | 'summarizing' | 'done' | 'error'
  task: string
  host: HostRole | null
  roles: ChatRole[]                // 仅专家，3~6 个
  messages: ChatMessage[]
  turn: number                     // 已进行的调度次数（隐藏上限用）
  allowDeepReasoning: boolean      // 默认 true
  deepThinkingRoleId: string | null // 正在跑 subagent 的成员
  streamingRoleId: string | null
  summary: string
  error: string
  mdPath: string
  mdContent: string
  version: number
}
```

- 移除公开的 `totalRounds` / `currentRound`；不再向客户端暴露“轮数”。
- 内部保留 `MAX_MODERATOR_TURNS = 60` 作为隐藏安全上限。

---

## 4. 角色与主持人生成

### 4.1 LLM 输出格式

生成角色时，要求 LLM 返回严格 JSON 对象：

```json
{
  "host": {
    "name": "主持人",
    "persona": "2-3 句话的主持人人设...",
    "duty": "掌控讨论节奏、追问、纠偏、判断何时收尾"
  },
  "roles": [
    { "name": "产品专家", "persona": "...", "duty": "..." },
    { "name": "技术专家", "persona": "...", "duty": "..." },
    { "name": "市场专家", "persona": "...", "duty": "..." }
  ]
}
```

- `host` 只生成 1 个，不占 3~6 个专家名额。
- `roles` 校验 3~6 个，名称去重，最多 8 个容忍截断。
- 主持人 id 固定为 `host`，专家 id 固定为 `r1`...`rN`。

### 4.2 兼容与兜底

- 若 LLM 仍返回旧格式“纯数组”：尝试把数组当作 `roles`，并用内置默认主持人兜底：

```text
默认主持人：
name: 主持人
persona: 经验丰富的议题主持人，善于归纳观点、追问关键问题、控制讨论节奏
duty: 主持讨论、点名追问、判断何时进入总结
```

- 若 `host` 字段缺失或校验失败：同样使用默认主持人。
- 若 `roles` 为空：仍按现有逻辑报 error。

### 4.3 主持人不可单独编辑/删除

- v1 主持人不进入专家增删改列表。
- 要更换主持人：直接“重新生成角色团队”。

---

## 5. 主持人驱动循环

### 5.1 主持人调度决策

每步由主持人 LLM 读取：

- 任务；
- 完整群聊历史（受 `HISTORY_BUDGET` 字符预算限制）；
- 专家列表：`name` + `duty` + 已发言次数 + 最近一次发言时间/内容摘要；
- 主持人 persona；
- 用户最新消息（如有）；
- 当前 `turn`。

主持人必须返回严格 JSON：

```json
{
  "action": "speak",
  "speakTo": "r2",
  "text": "请产品专家补充一下成本方案",
  "instruction": "重点分析落地成本和风险"
}
```

```json
{
  "action": "host_message",
  "text": "大家的意见已经比较集中，还有谁要补充？"
}
```

```json
{
  "action": "summarize"
}
```

字段语义：

| 字段 | 说明 |
|---|---|
| `action` | `speak` / `host_message` / `summarize` |
| `speakTo` | 仅在 `speak` 时有效，必须是专家 id 之一 |
| `text` | `host_message` 必填；`speak` 可选，非空则先追加一条主持人公开串场消息 |
| `instruction` | 仅 `speak` 时可选，作为给被点名专家的内部提示 |

### 5.2 主持人规则

- 不强制每个专家都发言；同一专家可被多次点名。
- 主持人串场不刷屏：只在追问、纠偏、串场、宣布结束时输出 `text`。
- 用户最近一条消息优先处理：若主持人判断用户消息是给某人的指令，应点名该专家。
- 主持人公开串场时，必须使用主持人 persona 的语气，并保持简短。

### 5.3 调度失败与回退

- 主持人返回 JSON 解析失败：重试 1 次。
- 仍失败，或 `speakTo` 无效：回退为“发言次数最少的专家”直接发言，`instruction` 置空。
- 连续 3 次调度失败：`phase = error`，保留已有历史。

### 5.4 隐藏安全上限

- 内部常量 `MAX_MODERATOR_TURNS = 60`。
- 达到上限时不再调用主持人，直接强制进入 `summarize`。
- 面板可显示“达到讨论上限，自动总结”（可选，不阻塞流程）。

---

## 6. 成员深度推理

### 6.1 开关

- `allowDeepReasoning` 默认 `true`。
- 设置区新增开关，可随时切换；当前正在发言/推理中的成员不受影响，下一次成员发言时生效。

### 6.2 成员自主判断（Member Plan）

主持人点名某专家后，先调用一次轻量 LLM 做“成员自主判断”：

```json
{
  "mode": "direct"
}
```

或

```json
{
  "mode": "deep",
  "subagentTask": "请深入分析该方案在中小团队中的落地成本、风险和可替代方案"
}
```

- `mode: direct` → 走现有流式发言路径。
- `mode: deep` → 进入 subagent 深度推理流程。
- 该判断调用不进入消息流、不写入导出纪要。
- 判断调用失败或结果无效 → 按 `direct` 回退。

### 6.3 Deep 流水线

1. 生成 `subagentTask`（由成员 plan 返回）。
2. 使用 `ctx.subagents.startContinuable` 派生一个一次性 subagent，provider 使用 `'spawn'`，`maxDepth: 1`。
3. subagent prompt 为自包含文本，包含：
   - 该角色 persona；
   - 当前任务；
   - 相关群聊历史（截断到预算内）；
   - 主持人 `instruction`；
   - 待深入分析的问题 / `subagentTask`。
4. 等待 `subagent/end` 事件，读取 `lastAssistantMessage` 文本。
5. 将 subagent 输出作为素材，让该成员以角色口吻流式整理成一段正式群聊发言。
6. 面板显示“XX 正在调用 subagent 深度推理…”；导出纪要只保留整理后的正式发言，不写 subagent 全文。

### 6.4 Subagent 失败与回退

| 情况 | 处理 |
|---|---|
| `subagents` 服务不可用 | 本次回退 direct，不报错 |
| 拿不到 parent agent | 本次回退 direct |
| 无可用 provider | 本次回退 direct |
| `startContinuable` 抛错 | 本次回退 direct |
| 超时（建议 180s） | interrupt 该 subagent，回退 direct |
| 结果为空 / `stopReason` 非 completed | 回退 direct |
| 成员最终整理发言失败 | 按普通发言失败处理，计入连续失败 |

### 6.5 并发

- 讨论为串行，同一时刻最多一个 deep subagent。
- 不引入并行池。

---

## 7. 控制语义

| 操作 | 讨论中 | deep 推理中 | 效果 |
|---|---|---|---|
| 暂停 | 有效 | 不中断当前 subagent | 当前动作完成后，在下一步前暂停 |
| 继续 | 有效 | - | 释放暂停门闩 |
| 跳过 | 有效 | 有效 | abort 当前发言；若有 subagent 则 interrupt 它；移除半截消息；进入下一轮主持人调度 |
| 停止 | 有效 | 有效 | abort 当前发言 + interrupt subagent；清空后续；`phase=done` |
| 重发（专家） | 有效 | 有效 | 删除该专家最近一条消息；若在推理则 interrupt；重新触发主持人调度 |
| 重发（主持人） | v1 不支持 | - | 不提供该能力 |
| 用户插话 | 有效 | 有效 | 只追加用户消息，不打断当前动作；下一步主持人会看到并处理 |

---

## 8. 状态与 HTTP API

### 8.1 Snapshot 字段变化

新增：

- `host`
- `turn`
- `allowDeepReasoning`
- `deepThinkingRoleId`

移除/不再使用：

- `totalRounds`
- `currentRound`（客户端不再展示）

### 8.2 Post Action 变化

| Action | 变化 |
|---|---|
| `generate-roles` | 移除 `rounds` 参数 |
| `start` | 不再接收轮数 |
| `sync-rounds` | 移除，替换为 `sync-settings` |
| `sync-settings` | 新增，接收 `{ allowDeepReasoning: boolean }` |
| `update-roles` | 仅更新专家，不影响主持人 |
| `reroll` | 仅专家；v1 不接受 `roleId=host` |
| `pause/resume/skip/stop/chat/export-md` | 行为按第 7 节调整 |

---

## 9. 客户端 UI

### 9.1 设置区

- 移除“轮数”输入。
- 新增“允许成员深度推理”开关，默认开启。
- 保留任务输入、角色生成、重新生成角色团队、角色增删改。

### 9.2 主持人展示

- 角色区单独展示“主持人”徽标，标注“主持”，不可删除、不可编辑。
- 主持人消息在消息流中正常显示，使用独立头像/标识。
- 导出 MD 的团队区先列主持人，再列专家。

### 9.3 状态提示

消息流/头部需要区分：

- “主持人正在调度”
- “XX 正在发言”
- “XX 正在调用 subagent 深度推理”

### 9.4 其他

- 底部参与输入框不变。
- 讨论结束后的结论区、导出 MD 按钮不变。

---

## 10. 错误处理汇总

| 场景 | 行为 |
|---|---|
| 主持人决策 JSON 非法 | 重试 1 次；再失败回退 least-spoken |
| 主持人连续 3 次调度失败 | `phase=error` |
| 成员 plan JSON 非法 | 按 direct 回退 |
| subagent 不可用/失败/超时 | 按 direct 回退 |
| 最终成员发言失败 | 该条 `failed`，计入连续失败 |
| 连续 ≥3 次最终发言失败 | `phase=error`，保留历史 |
| 隐藏上限 60 次调度 | 强制 summarize |
| 导出失败 | 保留 `mdContent` 可复制 |

---

## 11. 测试计划

- 角色生成：`{host, roles}` 合法 / 旧数组兼容 / host 缺失兜底 / roles 空报错。
- 主持人循环：speak / host_message / summarize 三种决策。
- 主持人失败：JSON 非法后重试 / 回退 least-spoken / 连续失败进 error。
- 成员 plan：direct / deep / 非法回退 direct。
- subagent：成功、失败、超时、不可用时回退 direct。
- deep 中 skip / stop / reroll 能 interrupt subagent。
- 同一成员被多次点名、某成员全程不发言。
- 隐藏上限达到后强制总结。
- 开关关闭后不再触发 subagent。
- UI：主持人徽标、无轮数控件、deep 状态提示、导出纪要含主持人。

---

## 12. 实现边界 / 非目标

- 角色仍不执行通用工具；只允许“深度推理 subagent”这一种内部能力。
- 不做持久化。
- 不做多群聊并行。
- 不做主持人单独编辑/删除。
- v1 不允许用户手动点名某个专家（用户可通过插话让主持人调度，主持人决定是否采纳）。

---

## 13. 实现前需要验证的开放项

1. `ctx.subagents.startContinuable` 完成时是否会自动向主会话推送完成通知；若会，需要静默/抑制，避免主对话被内部推理结果打扰。
2. 子代理能否携带自定义 `maxTokens` / 模型路由；不能时需要在 prompt 中约束输出长度，或在整理阶段截断。
3. `pause` 在 subagent 运行中的具体交互是否可接受“不立即中断”这一语义。
