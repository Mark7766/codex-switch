# DESIGN: /v1/responses/compact 上下文压缩完整重构（v1.5.0）

- **日期**：2026-06-11
- **状态**：📋 待审查
- **目标版本**：v1.5.0
- **相关 ADR**：待写入（ADR-019）

---

## 1. 背景与问题

### 1.1 用户报告

Codex Desktop 在长时间对话后报错：

```
上下文已自动压缩
Error running remote compact task: unexpected status 502 Bad Gateway: Unknown error,
url: http://127.0.0.1:11440/v1/responses/compact
```

错误在 Codex Desktop 端表现为"上下文压缩失败"，同时用户感知对话上下文丢失。

### 1.2 当前实现（TASK-041，v1.2.3）分析

`electron/proxy/server.ts` 第 554–601 行的 compact 处理器：

```typescript
// 当前行为：仅"克隆"不压缩
if (req.method === 'POST' && url.pathname === '/v1/responses/compact') {
  let body = '';
  req.on('data', (c: Buffer) => (body += c));
  req.on('end', () => {
    const compactId = `resp_compact_${randomBytes(6).toString('hex')}`;
    // 读取 previous_response_id → 克隆历史到新 ID
    const existingHistory = prevRespId ? this.conversationStore.get(prevRespId) : undefined;
    this.conversationStore.set(compactId, existingHistory ? [...existingHistory] : []);
    // 返回 200 + 新 compactId
  });
  return;
}
```

### 1.3 根因链

```
┌──────────────────────────────────────────────────────────────┐
│                    层次一：502 的直接原因                       │
├──────────────────────────────────────────────────────────────┤
│ A. 无 req.on('error') 处理                                    │
│    → 请求流异常（连接断开/超时/reset）→ 未捕获 error            │
│    → HTTP 连接被操作系统强制关闭 → Codex Desktop 收到 502       │
│                                                              │
│ B. 无请求体大小限制                                           │
│    → 极长对话的 compact 请求体可能超过内存限制                  │
│    → OOM 或 JSON.parse 失败导致响应断裂                       │
│                                                              │
│ C. 无请求超时机制                                             │
│    → 请求体传输中断时，'end' 事件永不触发                      │
│    → TCP 连接挂死直到 OS 超时 → 502                           │
│                                                              │
│ D. WebSocket compact 事件未处理                               │
│    → WS 消息循环仅处理 'response.create'                      │
│    → Codex Desktop 通过 WS 发 compact → 静默丢弃              │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                  层次二：功能缺失的后果                         │
├──────────────────────────────────────────────────────────────┤
│ E. "克隆 ≠ 压缩"                                             │
│    → 历史只增不减，最终超出 DeepSeek 64K–128K 上下文窗口        │
│    → 后续 DeepSeek 请求报 400（context length exceeded）       │
│    → 多次失败后 Codex Desktop 可能再次触发 compact             │
│    → 死循环：compact 成功（克隆）→ 请求失败 → compact 重试     │
│                                                              │
│ F. conversationStore 纯内存                                   │
│    → 代理重启丢失全部历史                                     │
│    → Codex Desktop 持有的 compact ID 变成悬空引用              │
│    → 下一轮对话上下文全丢（"失忆"bug 复现）                    │
│                                                              │
│ G. CONV_STORE_MAX=200 只限制条目数                            │
│    → 每个条目（messages[]）可以无限大                          │
│    → 无法防御单条对话的无限膨胀                                │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. 方案总览

一次性综合重构，覆盖三个维度：

| 维度           | 目标                                                    | 优先级 |
| -------------- | ------------------------------------------------------- | ------ |
| **健壮性**     | 消除 502，compact 端点具备完整的错误处理、超时、限流    | P0     |
| **真正的压缩** | LLM 摘要 + 智能截断，对话历史可控且不超 DeepSeek 上下文 | P0     |
| **持久化**     | conversationStore 写入磁盘，代理重启可恢复              | P1     |

新增模块 `electron/proxy/compact.ts`（compact 核心逻辑）和 `electron/proxy/conversation-store.ts`（持久化层），不增加新依赖。

---

## 3. 健壮性修复（消除 502）

### 3.1 HTTP compact 端点加固

```
POST /v1/responses/compact

新流程：
┌─────────────────────────────────────────────────────────────┐
│ 1. req.setTimeout(30_000) — 30秒超时                         │
│ 2. 读取 body（最大 maxBodySize=1MB）                          │
│    ├─ Content-Length > 1MB → 413 Payload Too Large           │
│    └─ 读取中超出 1MB → req.destroy() + 413                   │
│ 3. req.on('error', handler) — 捕获流错误                       │
│    └─ → res.writeHead(500, { error: { code: 'stream_error' } })│
│ 4. req.on('timeout', handler) — 超时处理                      │
│    └─ → req.destroy() + 408 Request Timeout                  │
│ 5. JSON.parse(body) — 解析请求体                              │
│    └─ 失败 → 400 Bad Request                                 │
│ 6. 执行 compact 逻辑（见第 4 节）                              │
│ 7. 返回 200 JSON                                             │
└─────────────────────────────────────────────────────────────┘
```

**响应格式（成功）**：

```json
{
  "id": "resp_compact_a1b2c3d4e5f6",
  "object": "response",
  "created_at": 1718035200,
  "status": "completed",
  "model": "deepseek-v4-flash",
  "output": [],
  "usage": { "input_tokens": 0, "output_tokens": 0, "total_tokens": 0 },
  "_compact": {
    "compacted": true,
    "method": "llm_summary",
    "original_message_count": 156,
    "compacted_message_count": 11,
    "summary_tokens": 234
  }
}
```

**响应格式（失败）**：

```json
{
  "error": {
    "code": "stream_error",
    "message": "请求流在 compact 处理过程中断开"
  }
}
```

### 3.2 WebSocket compact 事件处理

当前 WS 消息循环（`server.ts` 约 952 行）只处理 `response.create`，需增加 `response.compact` 分支：

```
WS 收到 { type: "response.compact", response: { previous_response_id: "xxx" } }
  └─ 调用同一 compact 逻辑
     ├─ 异步执行（不阻塞其他 WS 消息）
     ├─ 完成后推送 { type: "response.completed", response: { id: newCompactId, ... } }
     └─ 失败时推送 { type: "error", error: { ... } }
```

**注意**：`response.compact` 的处理必须异步（不在 WS message 回调中 await），因为 LLM 摘要可能耗时数秒，不能阻塞 WebSocket 事件循环。

---

## 4. LLM 摘要——真正的上下文压缩

### 4.1 整体流程

```
compact(previousResponseId)
  │
  ├─ 1. 加载历史
  │   conversationStore.get(previousResponseId) → messages[]
  │
  ├─ 2. 判断是否需要压缩
  │   messages.length ≤ COMPACT_THRESHOLD(20)?
  │   ├─ Yes → 直接克隆，compacted=false，返回新 ID
  │   └─ No  → 继续执行压缩
  │
  ├─ 3. 切分消息
  │   keepRecent = messages.slice(-RECENT_KEEP(10))  // 最近 10 条不动
  │   toSummarize = messages.slice(0, -RECENT_KEEP)  // 更早的消息做摘要
  │
  ├─ 4. 调用 DeepSeek 做摘要
  │   POST https://api.deepseek.com/v1/chat/completions
  │   {
  │     model: "deepseek-chat",
  │     messages: [
  │       { role: "system", content: SUMMARIZE_SYSTEM_PROMPT },
  │       ...toSummarize,
  │       { role: "user", content: "请基于以上对话生成摘要" }
  │     ],
  │     max_tokens: 2000,
  │     temperature: 0.1
  │   }
  │   ├─ 成功 → summaryText = choices[0].message.content
  │   └─ 失败/超时(15s) → 回退截断模式
  │
  ├─ 5. 构造新历史
  │   compactedMessages = [
  │     { role: "system", content: `[对话历史摘要] ${summaryText}` },
  │     ...keepRecent
  │   ]
  │   conversationStore.set(newCompactId, compactedMessages)
  │
  └─ 6. 返回 newCompactId + 统计信息
```

### 4.2 摘要 system prompt

```
你是对话摘要助手。请将以上对话历史压缩为一段简洁的摘要文本。
严格遵循以下规则：

1. **必须保留**：
   - 用户的核心目标和意图（"想做什么"）
   - 已做出的关键决策和选择
   - 重要的文件路径、代码片段、命令
   - 关键数据值（版本号、配置参数、API 返回的关键字段）
   - 未解决的问题或待办项

2. **可以忽略**：
   - 重复的内容和修正过程
   - 问候语和礼貌性对话
   - 已完成的中间步骤的细节
   - 错误尝试的具体过程（保留最终结论即可）

3. **输出格式**：
   - 使用中文
   - 以"此前对话摘要："开头
   - 用分点或短段落组织，不超过 2000 字
   - 不要添加任何额外的解释或前缀

4. **长度**：整个摘要输出不超过 2000 字符。
```

### 4.3 回退机制（摘要失败时）

| 失败模式                      | 处理                                     |
| ----------------------------- | ---------------------------------------- |
| DeepSeek API 调用超时（>15s） | 截断模式：保留最近 30 条消息，丢弃更早的 |
| DeepSeek 返回 4xx/5xx         | 截断模式同上                             |
| 摘要返回空内容                | 截断模式同上                             |
| 网络错误（DNS/连接失败）      | 截断模式同上                             |

**截断模式**日志级别为 WARN，内容："compact LLM 摘要失败（原因），回退为截断模式，保留最近 30 条消息"。

### 4.4 关键参数

| 参数                 | 默认值 | 说明                            |
| -------------------- | ------ | ------------------------------- |
| `COMPACT_THRESHOLD`  | 20     | 消息数 ≤ 此值时不压缩，直接克隆 |
| `RECENT_KEEP`        | 10     | 压缩时保留最近 N 条消息不做摘要 |
| `FALLBACK_KEEP`      | 30     | LLM 摘要失败时截断保留的消息数  |
| `SUMMARY_MAX_TOKENS` | 2000   | 摘要输出最大 token 数           |
| `SUMMARY_TIMEOUT_MS` | 15000  | 摘要 API 调用超时（毫秒）       |
| `MAX_BODY_SIZE`      | 1MB    | compact 请求体最大大小          |
| `REQUEST_TIMEOUT_MS` | 30000  | compact HTTP 请求总超时         |

### 4.5 并发控制

同一 `previous_response_id` 的 compact 请求是幂等的：

- 首次 compact → 执行摘要 → 存储结果
- 随后相同 ID → 直接返回已有 compactId（`compactStore` 记录映射关系）
- 映射关系 `prevId → compactId` 在内存中，随 conversationStore 一起持久化

---

## 5. 对话历史持久化

### 5.1 存储格式

文件：`{logsDir}/conversation-store.ndjson`

每行一个 JSON 对象：

```json
{
  "id": "resp_abc123",
  "messages": [{"role":"user","content":"..."}, ...],
  "createdAt": 1718035200000,
  "lastAccessAt": 1718035300000,
  "compacted": false,
  "compactedFrom": null
}
```

### 5.2 写入策略

```
写入时机：
├─ 每条 response 完成后 → markDirty(id)，不立即写盘
└─ debounce 5 秒 → writeAll()
   ├─ 收集所有 dirty 条目
   ├─ 序列化为 ndjson
   ├─ 先写 .tmp 文件
   └─ rename(.tmp → .ndjson) 原子替换
```

**为什么 debounce 而不是每条立刻写？**

- compact + 正常 response 在短时间内可能产生多次写入
- debounce 合并写入减少磁盘 I/O
- 5 秒内崩溃最多丢最后一次 response 的历史（不丢 compact 结果，因为 compact 后立刻有 response）

**特殊情况**：compact 完成后强制立刻刷盘（不等待 debounce），因为 compact 是低频操作且后续 response 依赖它。

### 5.3 启动恢复

```
proxy.start() 时：
├─ 检查 {logsDir}/conversation-store.ndjson 是否存在
├─ 读入 → 解析 ndjson → 重建 Map<string, ChatMessage[]>
│   └─ 跳过损坏行（WARN 日志）
├─ 清理过期条目：
│   └─ lastAccessAt < 24h 前 → 删除
├─ 清理超量条目：
│   └─ 保留最近 50 个条目 → 删除更旧的
└─ 日志记录：恢复了 X 条对话历史
```

### 5.4 清理策略

| 条件                 | 动作             | 触发时机            |
| -------------------- | ---------------- | ------------------- |
| `lastAccessAt > 24h` | 删除条目         | 启动时 + 每小时定时 |
| 总条目数 > 50        | 删除最旧的       | 每次写入后检查      |
| 单条消息数 > 500     | 强制触发 compact | 写入时检查 + WARN   |

**注意**：`conversationStore` 的最大条目数从现有的 `CONV_STORE_MAX=200`（仅限制条目数）改为双层限制：

- **条目数** ≤ 50（降级，因为每条对话经压缩后体积可控）
- **单条消息数** ≤ 500（新增，兜底防止无限膨胀）

---

## 6. WebSocket compact 事件

### 6.1 事件格式

**收到（Codex Desktop → Proxy）**：

```json
{
  "type": "response.compact",
  "response": {
    "previous_response_id": "resp_abc123"
  }
}
```

**响应（Proxy → Codex Desktop）**：

```json
{
  "type": "response.completed",
  "response": {
    "id": "resp_compact_a1b2c3d4e5f6",
    "object": "response",
    "status": "completed",
    "created_at": 1718035200,
    "model": "deepseek-v4-flash",
    "output": [],
    "usage": { "input_tokens": 0, "output_tokens": 0, "total_tokens": 0 }
  }
}
```

### 6.2 异步处理

WS compact 不能直接在消息回调中 await（会阻塞整个 WebSocket 连接）。处理方式：

```
ws.on('message', async (raw) => {
  const msg = JSON.parse(raw);
  if (msg.type === 'response.compact') {
    // 触发异步 compact，不 await
    this.compactAsync(msg.response.previous_response_id)
      .then(result => ws.send(JSON.stringify(result)))
      .catch(err => ws.send(JSON.stringify({ type: 'error', error: err })));
    return; // 立即返回，不阻塞消息循环
  }
  // ... 其他消息处理
});
```

为防并发 compact 堆积，维护一个 `activeCompactions: Set<string>`，同一 `previous_response_id` 的 compact 只允许一个在执行。

---

## 7. 完整数据流

```
┌──────────────────────┐     ┌──────────────────────────────────────┐     ┌──────────────┐
│   Codex Desktop      │     │        Codex Switch Proxy             │     │  DeepSeek    │
│                      │     │                                      │     │              │
│  用户长对话 (150条)   │     │                                      │     │              │
│     │                │     │                                      │     │              │
│     │  POST           │     │                                      │     │              │
│     │  /v1/responses/ │     │                                      │     │              │
│     │  compact        │     │                                      │     │              │
│     │  {prev_id: X}   │     │                                      │     │              │
│     │────────────────►│     │                                      │     │              │
│     │                 │     │  1. 加载 history[X] (150条)           │     │              │
│     │                 │     │  2. 150 > 20 → 需要压缩               │     │              │
│     │                 │     │  3. keepRecent = 后10条               │     │              │
│     │                 │     │  4. toSummarize = 前140条             │     │              │
│     │                 │     │     │                                │     │              │
│     │                 │     │     │  POST /v1/chat/completions      │     │              │
│     │                 │     │     │  {model: deepseek-chat,         │     │              │
│     │                 │     │     │   messages: [system摘要提示,      │     │              │
│     │                 │     │     │     ...前140条, "请生成摘要"],     │     │              │
│     │                 │     │     │   max_tokens: 2000}             │     │              │
│     │                 │     │     │────────────────────────────────►│     │              │
│     │                 │     │     │                                 │     │              │
│     │                 │     │     │  {choices[0].message.content}   │     │              │
│     │                 │     │     │◄────────────────────────────────│     │              │
│     │                 │     │     │                                 │     │              │
│     │                 │     │  5. 新历史 = [system摘要, ...后10条]    │     │              │
│     │                 │     │  6. conversationStore[newId] = 新历史  │     │              │
│     │                 │     │  7. 强制立刻刷盘                       │     │              │
│     │                 │     │                                      │     │              │
│     │  200 {id: newId, │     │                                      │     │              │
│     │       _compact:  │     │                                      │     │              │
│     │        {compacted:│     │                                      │     │              │
│     │         true,     │     │                                      │     │              │
│     │         original: │     │                                      │     │              │
│     │         150,      │     │                                      │     │              │
│     │         compacted:│     │                                      │     │              │
│     │         11}}      │     │                                      │     │              │
│     │◄────────────────│     │                                      │     │              │
│     │                 │     │                                      │     │              │
│     │  下一轮对话       │     │                                      │     │              │
│     │  POST /v1/resp   │     │                                      │     │              │
│     │  {prev_id: newId}│     │                                      │     │              │
│     │────────────────►│     │  加载 history[newId] = [摘要...10条]   │     │              │
│     │                 │     │  → 转发 DeepSeek ✓                    │     │              │
└──────────────────────┘     └──────────────────────────────────────┘     └──────────────┘
```

---

## 8. 新增/变更文件

### 8.1 新建文件

| 文件                                    | 职责                                                                  | 预估行数 |
| --------------------------------------- | --------------------------------------------------------------------- | -------- |
| `electron/proxy/compact.ts`             | compact 核心逻辑：阈值判断、LLM 摘要调用、回退截断、幂等控制          | ~200     |
| `electron/proxy/conversation-store.ts`  | conversationStore 持久化：ndjson 读写、恢复、清理、原子写入           | ~180     |
| `tests/unit/compact.test.ts`            | 覆盖 HTTP/WS compact、阈值、摘要调用 mock、回退、幂等、边界情况       | ~200     |
| `tests/unit/conversation-store.test.ts` | 覆盖：读写 ndjson、启动恢复、过期清理、超量清理、损坏行跳过、原子写入 | ~150     |

### 8.2 修改文件

| 文件                       | 变更                                                                                                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron/proxy/server.ts` | ① compact HTTP handler 重写（加固错误处理+超时+大小限制）；② WS 消息循环新增 `response.compact` 分支；③ `DeepSeekProxy` 构造函数传入 `conversationStore` 实例；④ 启动时调用 `conversationStore.load()` 恢复历史 |
| `package.json`             | 版本号 1.4.0 → 1.5.0                                                                                                                                                                                            |
| `CHANGELOG.md`             | 新增 v1.5.0 条目                                                                                                                                                                                                |

---

## 9. 边界情况矩阵

| 场景                        | 输入                                     | 预期行为                                                           | 日志级别 |
| --------------------------- | ---------------------------------------- | ------------------------------------------------------------------ | -------- |
| 短对话 compact              | 5 条消息                                 | 直接克隆，不调 LLM，`compacted: false`                             | INFO     |
| 阈值边界                    | 恰好 20 条                               | 直接克隆（≤ 20 不压缩）                                            | INFO     |
| 正常压缩                    | 156 条消息                               | LLM 摘要 → 11 条（1 摘要 + 10 最近），`compacted: true`            | INFO     |
| 摘要 API 超时               | DeepSeek > 15s                           | 回退截断 → 保留最近 30 条，`compacted: true, method: "truncation"` | WARN     |
| 摘要 API 报错               | DeepSeek 返回 500                        | 同上                                                               | WARN     |
| 空历史 compact              | `previous_response_id` 指向 0 条消息     | 返回新 ID + 空历史，`compacted: false`                             | INFO     |
| ID 不存在                   | `previous_response_id` 在 store 中找不到 | 返回新 ID + 空历史（不报错），WARN 日志                            | WARN     |
| 重复 compact                | 同一 `previous_response_id` 两次         | 幂等返回已有 compact ID                                            | INFO     |
| 请求体超大                  | Content-Length > 1MB                     | 413 Payload Too Large                                              | WARN     |
| 请求体非 JSON               | body = "not json"                        | 400 Bad Request                                                    | WARN     |
| 请求流错误                  | TCP 连接在传输中 reset                   | 500 + error.code = "stream_error"                                  | ERROR    |
| 请求超时                    | 30s 内未收完 body                        | 408 Request Timeout                                                | WARN     |
| WS compact 并发             | 同一 WS 连发 3 个 compact                | 只执行第 1 个，后 2 个等待或直接返回已有结果                       | INFO     |
| 代理 stop 时 compact 进行中 | stop() 调用时正在做摘要                  | 摘要仍然完成并刷盘，但不再向客户端推送结果                         | INFO     |
| 启动恢复                    | ndjson 文件有 50 条有效记录              | 恢复 50 条 + 删除过期/超量                                         | INFO     |
| ndjson 损坏行               | 第 15 行 JSON 不完整                     | 跳过并 WARN，继续解析后续行                                        | WARN     |
| 单条对话超 500 条消息       | 历史上 600 条                            | WARN 日志 + 不阻塞（下次 compact 会压缩）                          | WARN     |

---

## 10. 测试策略

### 10.1 单元测试（Vitest）

**compact.test.ts** — 需要 mock `node:https` 和 `conversationStore`：

| 用例                                                               | 覆盖           |
| ------------------------------------------------------------------ | -------------- |
| `compact() with ≤20 messages returns clone without LLM call`       | 阈值判断       |
| `compact() with >20 messages calls LLM summary`                    | LLM 摘要主路径 |
| `compact() with >20 messages, LLM timeout → fallback truncation`   | 超时回退       |
| `compact() with >20 messages, LLM 500 → fallback truncation`       | API 失败回退   |
| `compact() with 0 messages returns empty history`                  | 空历史         |
| `compact() with unknown previous_response_id returns new empty ID` | ID 不存在      |
| `compact() idempotent: same previous_response_id twice`            | 幂等           |
| `compact() summary text merged into system message`                | 摘要消息结构   |
| `compactHttpHandler() returns 400 on non-JSON body`                | HTTP 输入校验  |
| `compactHttpHandler() returns 413 on oversized body`               | 请求体大小限制 |
| `compactHttpHandler() handles stream error gracefully`             | 流错误处理     |

**conversation-store.test.ts** — 使用 `tmpdir` + `vi.mock` 路径：

| 用例                                     | 覆盖          |
| ---------------------------------------- | ------------- |
| `save() writes ndjson file`              | 基本写入      |
| `load() recovers Map from ndjson`        | 启动恢复      |
| `load() skips corrupted lines`           | 损坏行跳过    |
| `load() expires entries > 24h`           | 过期清理      |
| `load() caps at 50 entries`              | 超量清理      |
| `atomicWrite() uses temp + rename`       | 原子写入      |
| `debounceFlush() batches multiple saves` | debounce 合并 |

### 10.2 集成/手动验证

| 步骤 | 操作                                                     | 验证点                         |
| ---- | -------------------------------------------------------- | ------------------------------ |
| 1    | 启动代理 + 发送 30 轮对话模拟长上下文                    | conversationStore 有 30+ 条    |
| 2    | Codex Desktop 触发 compact（或 curl 手动）               | 返回 200 + `compacted: true`   |
| 3    | 检查 ndjson 文件                                         | 新 compact ID 已写入           |
| 4    | 发送下一轮对话（`previous_response_id` = 新 compact ID） | 摘要作为上下文正常工作         |
| 5    | 重启代理                                                 | `load()` 恢复 compact 后的历史 |
| 6    | 再次用恢复的 ID 发请求                                   | 上下文仍在，不丢               |
| 7    | 模拟摘要超时 (mock delay)                                | 回退截断模式，对话仍可用       |

---

## 11. 风险与缓解

| 风险                           | 概率 | 影响                                             | 缓解措施                                                            |
| ------------------------------ | ---- | ------------------------------------------------ | ------------------------------------------------------------------- |
| 摘要质量不足，丢失关键信息     | 中   | 用户感知上下文断裂                               | 保留最近 10 条不做摘要；摘要 prompt 强调关键事实保留                |
| 摘要 API 调用增加延迟          | 低   | compact 耗时 2-5s（vs 当前 <1ms）                | compact 是后台任务，不阻塞用户对话；超时回退保证不卡死              |
| 摘要消耗 DeepSeek token        | 中   | 每次 compact 多消耗约 2000 output + input tokens | compact 低频操作（每长对话 1-2 次）；比"无限增长导致每轮都报错"便宜 |
| 持久化文件与日志文件争抢磁盘   | 低   | 极端场景下 I/O 抖动                              | debounce 5s + 原子写入最小化 I/O 窗口；ndjson 文件远小于日志        |
| 旧版 ndjson 格式与新版本不兼容 | 低   | 启动恢复失败                                     | ndjson 每行自包含，加 `version` 字段预留迁移能力                    |
| compact 过程中代理被 stop      | 低   | 摘要丢失，下次 compact 重做                      | stop 时不 abort 进行中的摘要（让它完成并刷盘）                      |

---

## 12. 未纳入范围（明确不做）

- **compact 策略可配置化**（LLM vs 截断切换开关）：v1.5.0 固定 LLM 摘要 + 失败回退截断。后续可加。
- **对话导出/导入**（.ndjson 手动管理）：不作为本版本需求。
- **摘要缓存跨会话共享**（不同对话的摘要复用）：摘要与对话严格绑定，不跨会话共享。
- **DeepSeek CSV 上传功能**（context caching API）：DeepSeek 目前无此 API，等官方支持。
- **UI 层 compact 进度显示**：compact 是快速后台任务；后续如有需要可在 Logs 页显示。

---

## 13. 版本规划

```
v1.4.0（当前）
  └─ 无真正的上下文压缩
  └─ compact 端点存在 502 风险
  └─ 对话历史纯内存

v1.5.0（本方案）
  ├─ compact 端点全加固（错误处理+超时+限流）
  ├─ LLM 摘要上下文压缩
  ├─ conversationStore 持久化
  └─ WebSocket compact 事件支持
```

---

## 14. Review 检查项

- [ ] HTTP compact handler 错误处理是否覆盖所有路径
- [ ] LLM 摘要 prompt 是否遗漏关键信息类别
- [ ] 持久化 debounce 策略与 compact 强制刷盘是否合理
- [ ] 清理策略的阈值（24h / 50 条目 / 500 消息）是否恰当
- [ ] WebSocket compact 异步处理是否会导致消息乱序
- [ ] 回退截断模式的消息数（30）是否合适
- [ ] 测试用例是否覆盖所有边界情况
- [ ] 是否需要在 UI 展示 compact 日志（Logs 页面）
