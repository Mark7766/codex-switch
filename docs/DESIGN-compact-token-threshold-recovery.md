# DESIGN: 上下文压缩 — Token 阈值 + 超限容错恢复

- **日期**：2026-06-13
- **状态**：📋 方案设计，待 Review
- **目标版本**：v1.8.1

---

## 1. 问题分析

### 1.1 当前机制

```
消息数 > 20 条 → 触发 LLM 摘要压缩
  ├─ 保留最近 10 条不动
  ├─ 更早的消息 → DeepSeek 摘要 → 1 条 system 消息
  └─ 失败 → 回退截断保留 30 条
```

### 1.2 两个缺陷

| 缺陷       | 根因                                      | 表现                                       |
| ---------- | ----------------------------------------- | ------------------------------------------ |
| 阈值不准确 | 按消息数判断，长代码块可能 10 条就超 128K | 压缩来不及触发，请求直接报错               |
| 无容错恢复 | 超限错误发生后没有补救逻辑                | 用户看到"对话过长"后无法继续，只能重开对话 |

### 1.3 目标

```
触发条件：token 数接近模型上限 → 主动压缩（防患于未然）
容错恢复：收到 context length exceeded → 强制压缩 → 自动重试（亡羊补牢）
```

---

## 2. 方案设计

### 2.1 措施 ①：Token 数估算 + 阈值触发

**不引入 tokenizer 依赖**（太重），使用字符数估算法：

```typescript
// electron/proxy/compact.ts

/** 估算消息列表的 token 数（字符数/2 粗略估算，中文每个字约 2 token）。 */
function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
    chars += content.length;
  }
  // 粗略估算：英文 ~4 chars/token，中文 ~1.5 chars/token，折中取 2
  return Math.ceil(chars / 2);
}

/** 当 token 数超过模型上下文窗口的 70% 时触发压缩。 */
function shouldCompactByTokens(
  messages: ChatMessage[],
  modelContextLimit: number = 128_000,
): boolean {
  return estimateTokens(messages) > modelContextLimit * 0.7;
}
```

**模型上下文窗口**：

| 模型                      | 限制 | 70% 触发线  |
| ------------------------- | ---- | ----------- |
| `deepseek-v4-flash`       | 128K | ~89K tokens |
| `deepseek-v4-pro`         | 128K | ~89K tokens |
| `deepseek-reasoner`（R1） | 64K  | ~45K tokens |

**改动点**：`compactHistory` 入口先用 `shouldCompact`（消息数）做快速判断，再用 `shouldCompactByTokens`（token 数）做精确判断，任一触发即执行压缩。

---

### 2.2 措施 ②：超限错误自动恢复

**核心思路**：当 DeepSeek 返回 `context length exceeded` 错误时，不直接报错给用户，而是：

```
收到请求
  │
  ├─ streamDeepSeek / callDeepSeekSync
  │   └─ DeepSeek 返回: "context length exceeded"
  │       │
  │       ├─ 不是第一次重试？
  │       │   └─ 是 → 正常报错（避免死循环）
  │       │
  │       └─ 第一次超限？
  │           ├─ 1. 强制压缩当前对话（截断最近 20 条，其余全部丢弃）
  │           ├─ 2. 用压缩后的消息重建请求
  │           └─ 3. 重新调用 DeepSeek
  │
  └─ 成功 → 正常返回
```

**实现位置**：

- **`electron/proxy/stream.ts`** — `streamDeepSeek` 和 `callDeepSeekSync` 的 catch 分支
- **`electron/proxy/errors.ts`** — 新增 `isContextExceededError()` 判断函数
- **`electron/proxy/compact.ts`** — 新增 `emergencyCompact()` 激进压缩函数

**错误识别**：

```typescript
// errors.ts
export function isContextExceededError(e: Error): boolean {
  const msg = e.message ?? '';
  return (
    /context.*(length|too long|exceed|limit)/i.test(msg) ||
    /400.*context/i.test(msg) ||
    /maximum.*context/i.test(msg)
  );
}
```

**紧急压缩**（超限恢复专用，比常规压缩更激进）：

```typescript
// compact.ts

/**
 * 紧急压缩：丢弃旧消息，仅保留最近 20 条 + 一条摘要 system 消息。
 * 用于 context length exceeded 后的自动恢复重试。
 * 与常规压缩不同：不做 LLM 摘要（减少一次 API 调用），直接截断。
 */
export async function emergencyCompact(messages: ChatMessage[]): Promise<ChatMessage[]> {
  if (messages.length <= 20) {
    // 消息数 ≤20 但 token 超限 → 每条消息都很长，保留最近 10 条
    return messages.slice(-10);
  }
  // 保留最近 20 条 + 开头加一条提示
  const recent = messages.slice(-20);
  const notice: ChatMessage = {
    role: 'system',
    content: '[对话历史已超出模型长度限制，早期内容已自动截断。如需恢复完整上下文，请开启新对话。]',
  };
  return [notice, ...recent];
}
```

**重试集成**（在 `http-handler.ts` 和 `ws-handler.ts` 中）：

```typescript
// 在 streamDeepSeek / callDeepSeekSync 的 .catch() 中：

.catch(async (e) => {
  // 措施②：超限自动恢复 — 压缩后重试一次
  if (isContextExceededError(e) && !retried) {
    const compacted = await emergencyCompact(fullMessages);
    // 保存压缩后的消息到 conversationStore（替换原历史）
    deps.conversationStore.set(respId, compacted);
    // 用压缩后消息重建请求，重试
    const retryReq = { ...chatReq, messages: compacted };
    return streamDeepSeek(retryReq, respId, sse, ...);
  }
  // 不是超限错误，或已经重试过 → 正常报错
  const friendly = translateStreamError(e);
  deps.recordError(...);
});
```

---

### 2.3 措施 ③：保留消息数阈值作为快速路径

Token 估算有开销（遍历所有消息计算字符数），但量级很小（微秒级）。消息数阈值保留作为**快速短路**：

```typescript
// 快速判断：消息少肯定不超，跳过 token 估算
if (!shouldCompact(messages, MSG_COUNT_THRESHOLD)) {
  // 消息少，但仍可能 token 多（单条消息包含巨大代码块）
  if (shouldCompactByTokens(messages)) {
    // 触发压缩
  } else {
    return cloneOnly(messages); // 无需压缩
  }
}
// 消息多 → 必定触发压缩
```

---

## 3. 变更文件

| 文件                             | 改动                                                           | 预估行数 |
| -------------------------------- | -------------------------------------------------------------- | -------- |
| `electron/proxy/compact.ts`      | +`estimateTokens`、`shouldCompactByTokens`、`emergencyCompact` | ~40      |
| `electron/proxy/errors.ts`       | +`isContextExceededError`                                      | ~8       |
| `electron/proxy/stream.ts`       | 超限错误检测 → 触发紧急压缩 → 重试（需传 compact callback）    | ~15      |
| `electron/proxy/http-handler.ts` | `.catch` 分支新增超限恢复逻辑                                  | ~15      |
| `electron/proxy/ws-handler.ts`   | `.catch` 分支新增超限恢复逻辑                                  | ~15      |
| `tests/unit/compact.test.ts`     | +token 估算测试 + 紧急压缩测试                                 | ~20      |

---

## 4. 边界情况

| 场景                  | 处理                                                 |
| --------------------- | ---------------------------------------------------- |
| 压缩后仍然超限        | 不重试第二次（`retried` 标记），直接报错             |
| 压缩过程中出错        | 回退到原始错误（不加重试），直接报错                 |
| 单条消息本身就超 128K | `emergencyCompact` 保留最近 10 条，仍可能超限 → 报错 |
| WebSocket 超限        | 与 HTTP 相同逻辑，压缩后重试 SSE 流                  |
| HTTP sync 超限        | 与 streaming 相同逻辑，压缩后重试 `callDeepSeekSync` |

---

## 5. 不做的事项

| 事项                         | 原因                                                                  |
| ---------------------------- | --------------------------------------------------------------------- |
| 引入 tiktoken / tokenizer 库 | 增加 ~3MB 依赖，字符数估算够用（误差 30% 内）                         |
| LLM 摘要作为紧急压缩         | 超限时大概率 LLM 也无法处理完整历史（超出输入限制），截断是最可靠方案 |
| 用户提示"是否压缩"           | 压缩应对用户透明，压缩后 system 消息已说明                            |
