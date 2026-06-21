# 上下文超限误报分析 — 为什么 39K tokens 就"超长"了？

## 问题

用户报告：上一轮请求仅 `↑39367` tokens 成功（`req_1dccd8`），紧接下一轮（`req_a2d97b`）就报上下文超限。用户困惑：明明才 39K tokens，远不到 128K 上限，为什么就超了？

## 日志解读

```
req_1dccd8  ✓ deepseek-v4-pro · ↑39367↓232 tokens · finish=tool_calls
             → 成功，但响应的 finish_reason 是 tool_calls（不是 stop）

req_a2d97b  ✗ 上下文超限（110 条消息）· 耗时 4315ms
             → DeepSeek 直接拒收，连 token 数都没返回
```

**关键线索**：`req_1dccd8` 的 `finish=tool_calls`。这意味着 Codex 在这一轮要求执行工具（读文件/跑命令/搜索等）。Codex 执行完工具后，把工具执行结果（tool_result）附加到下一轮请求 `req_a2d97b` 中。工具结果可能非常大——几十 KB 甚至几百 KB 的文件内容、命令输出等。

**`req_a2d97b` 的真实上下文** = 39,367（req_1dccd8 的历史消息）+ **工具执行结果（未知大小）**+ 110 条消息的累积。很可能远超 128K。

> 日志里 `↑39367` 只代表 `req_1dccd8` 这一轮的输入量，不是 `req_a2d97b` 的。`req_a2d97b` 被 DeepSeek 在预处理阶段拒收，根本没有进入推理，所以日志里不会显示 token 数。

## 错误是谁报的？

链路：**DeepSeek API → errors.ts:isContextExceededError() → http-handler.ts / ws-handler.ts**

1. DeepSeek API 返回 HTTP 400 + error body（含 "context length" 或类似关键词）
2. `electron/proxy/errors.ts:151` 的 `isContextExceededError()` 用关键词匹配捕获（第 154-161 行）：

```typescript
msg.includes('context length') ||
  msg.includes('too long') ||
  msg.includes('maximum context') ||
  msg.includes('exceed') ||
  msg.includes('对话过长') ||
  msg.includes('上下文限制') ||
  msg.includes('超过模型') ||
  (msg.includes('400') && msg.includes('context'));
```

3. `http-handler.ts:237` 匹配到后，返回 HTTP 413 + 中文提示文案
4. `ws-handler.ts:354` 同理，WebSocket 发 `{ type: 'error', error: {...} }`

**结论：错误根源在 DeepSeek，代理只是翻译和转发。** 不是代理误判。

## 为什么以前能用、现在不行？

**v1.13.0 的 "对话缓存纯内存化" 把补偿机制也一起删了。**

v1.5.0 时代，上下文超限时代理会启动 `emergencyCompact`：

1. 调 DeepSeek 对旧消息做 LLM 摘要压缩
2. 失败则截断保留最近 N 条
3. 压缩后自动重试 → 用户无感知，长对话能继续

v1.13.0（ADR-023）删除了 compact 和自动重试。现在的行为：

- DeepSeek 报 context exceeded → 代理直接返回错误 → 对话中断
- **没有任何自动恢复机制**

旧时代的"4 分钟视频也能做出来"，是因为 emergencyCompact 在背后默默压缩。现在没了。

## 解决方案

### 方案 A：截断重试（推荐，低风险，立即可做）

**思路**：上下文超限时，不直接报错，而是裁剪掉最早的 N 条消息，用裁剪后的消息列表自动重试一次。裁剪规则：

- 保留 system 消息
- 保留最近 K 条对话（含 tool 消息配对）
- 丢弃中间的历史非关键消息
- K 默认保留最近 30 条，可在设置中调整

**优点**：

- 不需要额外 API 调用（不像 LLM 摘要需要调 DeepSeek）
- 用户无感知，对话继续
- 代码改动量小（~100 行）
- 不重蹈 v1.5.0 LLM 摘要的维护负担

**风险**：

- 丢弃的消息可能包含关键上下文
- 截断保守（保留 30 条）通常足够，agent 循环的前几轮指令 + 最近操作保留完整

### 方案 B：LLM 摘要压缩（v1.5.0 回滚）

恢复 v1.5.0 的 compact 逻辑但精简：只保留摘要核心（删掉 ndjson 持久化层），摘要结果作为 system 消息注入。

**优点**：保留更多上下文语义信息（不丢逻辑）

**缺点**：

- 每次 compact 多一次 DeepSeek API 调用（token 消耗）
- Codex 的 compact 依赖 `encrypted_content`（OpenAI 专有），走代理的摘要方案始终是 workaround
- 代码量更大（~400 行）
- 之前正是因此删除的（ADR-023）

### 方案 C：在超限前主动截断（预防式）

**思路**：每次请求前，估算当前对话的 token 数量，超过阈值（如 100K）时主动裁剪。不等 DeepSeek 报错，提前预防。

**优点**：不会浪费一次失败请求（超限请求 DeepSeek 直接拒，API 调用白费）

**缺点**：

- 需要本地 token 估算（tiktoken 或近似算法），引入依赖或自写估算器
- 估算不准可能误截断

### 推荐

**方案 A（截断重试）**，理由：

1. **改动最小**，不引入新依赖
2. **用户体验最好**，对话无缝继续
3. 比 LLM 摘要更可预测（用户明确知道只保留了最近 N 条）
4. 与 cc-switch/Codex++ 策略一致：简单、可控
5. 日志里记一条 "自动截断" 信息，用户可在 Codex Switch 日志页看到发生了什么

同时**修复错误响应的协议格式**（返回 SSE `response.failed` 而非 HTTP 413），让 Codex 不再卡在"等待中"的 spinner 状态——如果截断后仍超限，至少 Codex 能正常显示错误而不是卡住。
