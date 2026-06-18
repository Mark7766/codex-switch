# 分析报告：Codex Switch 代理 Token 消耗过高问题

- **日期**：2026-06-17
- **数据来源**：本地代理日志（`~/Library/Logs/codex-switch/main.log`，2,189 条请求记录）

---

## 1. 数据总览

| 指标                 | 数值                      |
| -------------------- | ------------------------- |
| 分析请求数           | 2,189                     |
| 总输入 Token         | **81,557,000（81.6M）**   |
| 总输出 Token         | 1,073,000（1.1M）         |
| 输入/输出比          | **76:1**                  |
| 平均每次输入         | 37,257 token              |
| 单次最大输入         | **982,152 token（982K）** |
| >100K 输入的大请求   | 133 次（6%）              |
| >200K 输入的巨型请求 | 11 次                     |
| tool_calls 请求占比  | **1,972 / 2,189 = 90%**   |

## 2. 根因分析

### 2.1 Agent 工具调用循环（最大根因，占 90% 消耗）

Codex 的 Agent 模式会在每次收到 `tool_calls` 后自动发起新一轮请求。数据表明：

- 平均每个对话产生 **11.1 次连续的 tool_calls 请求**
- 每个这样的链条消耗 **~396,000 token**
- 有 177 个超过 2 次的连续 tool_calls 链条

**为什么输入 Token 会暴涨？** 因为每一轮请求都把**整个对话历史**重新发送给 DeepSeek。一个典型的链条：

```
Step 1:  8,350  token ← 用户初始提问
Step 2:  9,343  token ← + 工具调用结果
Step 3: 10,562  token ← + 第二次工具结果
Step 4: 12,866  token ← + 第三次工具结果
Step 5: 12,879  token ← 最终回答
```

但更极端的情况：

```
Step 1:   9,610 token
Step 2:  10,598 token
Step 3:  14,680 token
Step 4:  18,794 token
Step 5: 230,925 token ← 暴涨 23 倍！
```

> **核心机制**：`previous_response_id` 保证对话连贯性，但代价是每轮请求都携带完整历史。这就像每次打字都把整篇文章重新抄一遍。

### 2.2 工具定义开销

Codex 每次请求都携带 44+ 个工具定义（Agent、Bash、Edit、mcp\_\* 等）。虽然代理会 strip 掉它们再发给 DeepSeek，但对话历史中的工具调用结果（function_call + function_call_output）逐轮累积，永不清除。

### 2.3 全部走 HTTP

4,604 次 HTTP 请求 vs 仅 4 次 WebSocket 事件。WebSocket 连接几乎没有被使用——Codex Desktop 似乎也退回到了 HTTP 模式。

### 2.4 模型分布

| 模型                       | 请求数 | 说明                             |
| -------------------------- | :----: | -------------------------------- |
| deepseek-v4-pro            | 1,854  | 主力推理模型，token 最贵         |
| deepseek-v4-flash          | 1,281  | 轻量模型，被 tool_calls 大量使用 |
| gpt-5.4（映射到 v4-flash） | 1,272  | Codex 的默认模型                 |

> v4-pro 的请求中大量是 tool_calls，说明即使用贵模型也在被循环消耗。

## 3. 核心问题：Agent 循环的本质

用一句话概括：**用户说一句话，Codex 执行 11 个工具，代理把每次工具调用结果都追加到对话历史，第 11 次请求携带了前 10 次的所有上下文，输入 token 量增长 20-50 倍。**

这不是代理的 bug——这是 `previous_response_id` 机制的必然结果。问题在于：

1. 触发 threshold 太高（20 条消息才触发 compact）
2. 工具调用结果不需要原样保留——摘要足够了
3. 没有 token 层面的监控和限制

## 4. 比较研究：原生 OpenAI、cc-switch 和直连方案

### 4.1 cc-switch 的方案

cc-switch（`/Users/mark/work/gitspace/opensource/cc-switch`）**同样使用本地代理**。它的 `proxy/` 目录有 55 个 Rust 源文件，基于 Axum/Hyper 实现了一套完整的 HTTP 代理服务器（端口 `15721`），包含：

- `server.rs` — Axum HTTP 服务器
- `transform_responses.rs` — Responses API ↔ Chat API 协议翻译
- `transform_codex_chat.rs` — Codex Chat 格式转换
- `streaming_responses.rs` — SSE 流式处理
- `provider_router.rs` — 多供应商路由
- `codex_chat_history.rs` — 对话历史管理
- `model_mapper.rs` — 模型映射

cc-switch 和 Codex Switch 本质上在做同一件事：**在本地起一个 HTTP 代理，做 Responses ↔ Chat 协议翻译**。区别只有语言（Rust vs TypeScript）和端口（15721 vs 11435）。

### 4.2 Codex Desktop 能否直连 DeepSeek？—— 技术可行性研究

**结论：2026 年不可行。**

根据网上搜索到的材料（[Codex Discussion #7782](https://github.com/openai/codex/discussions/7782)、阿里云/腾讯云开发者社区的多篇实战指南），核心原因有两个：

**原因一：`wire_api = "chat"` 已被官方移除**

Codex 的 `config.toml` 中有一个 `wire_api` 字段，决定 Codex 使用哪种协议和后端通信：

| `wire_api` 值 | 使用的端点             | 状态                                                |
| ------------- | ---------------------- | --------------------------------------------------- |
| `"chat"`      | `/v1/chat/completions` | **2026 年 2 月被彻底移除**，Codex 直接报 hard error |
| `"responses"` | `/v1/responses`        | ✅ v0.81.0+ 唯一支持的协议                          |

DeepSeek 只提供 Chat Completions API（`/v1/chat/completions`），没有 Responses API（`/v1/responses`）。所以 Codex 发出的请求格式 DeepSeek 根本不认识——直接返回 404。

**原因二：即使 Chat 模式还在，也无法直连**

Codex 不是普通的 Chat 客户端，它是一个 **Agent Loop**：

```
用户任务 → 多轮上下义 → 工具调用 → 文件编辑 → Shell 命令
→ 流式事件 → reasoning → previous_response_id → 会话状态
```

每个环节都需要 Responses API 特定的 SSE 事件格式（如 `response.function_call_arguments.done`）。DeepSeek 的 Chat API 缺少这些语义，直接对接会导致工具调用中断、流式解析失败。

**此外还有一个致命问题——`reasoning_content`**。DeepSeek 思考模式要求每一轮请求**必须携带上一轮的完整 `reasoning_content`**，否则报错。Codex 完全不知道这个字段的存在，不会自动携带。所有桥接方案都需要在本地缓存 reasoning 历史并在后续轮次回注。

> 来源：阿里云开发者社区《通过 CC Switch 本地路由让 Codex CLI 接入 DeepSeek》、CSDN《Codex 接入自定义 API 踩坑》、SegmentFault 同主题讨论、多个开源代理项目的 README。

**综上：Codex Desktop 直连 DeepSeek 在技术上不可行。** 所有可用方案——包括 DeepSeek 官方 [Agent 集成列表](https://github.com/deepseek-ai/awesome-deepseek-agent) 中推荐的 [Moon Bridge](https://github.com/ZhiYi-R/moon-bridge)（Go 写，端口 38440）、CC Switch、Codex Switch、codex-bridge、mimo2codex——全部都是本地代理做 Responses ↔ Chat 协议翻译。连 DeepSeek 官方认可的最佳方案都用代理，说明这事在协议层面就没有直连的可能。

### 4.3 原生 OpenAI 怎么处理

Codex 连接 OpenAI 官方后端时，同样的 Agent 循环也会发生。但 OpenAI 有三件事是我们做不到的：

| OpenAI 的优势             | 说明                                                           |       我们能否做到        |
| ------------------------- | -------------------------------------------------------------- | :-----------------------: |
| **服务端 Prompt Caching** | 连续请求中相同的对话前缀被缓存，第二轮起只计增量 token         | ❌ 依赖 DeepSeek API 支持 |
| **KV Cache 复用**         | 模型推理层面的缓存，不需要重复计算历史 token                   |       ❌ 模型层能力       |
| **Flat-rate 定价**        | ChatGPT Pro $200/月随便用，用户不感知单次 token 消耗           |     ❌ 我们是按量付费     |
| **协议层优化**            | Codex 和 OpenAI 后端是同一家公司，可以在协议层做增量传输等优化 |  ❌ 我们只能适配公开 API  |

### 4.4 代理不是负担，是武器

代理不仅不是 token 消耗的元凶，反而是**唯一能减少 token 消耗的手段**——因为它是请求到达 DeepSeek 之前的唯一拦截点。

## 5. cc-switch vs Codex Switch（仅限 Codex Desktop → DeepSeek）

仅比较 **Codex Desktop 通过代理转发到 DeepSeek** 这一个场景。cc-switch 的其他能力（Copilot 优化、Claude thinking 整流）不在讨论范围内。

### 5.1 cc-switch 对 Codex Desktop 场景做了什么

看了源码——**就是 Responses ↔ Chat 协议翻译，仅此而已**。和 Codex Switch 的代理层功能完全相同。没有任何针对 Codex Desktop 的 Token 节省逻辑。

### 5.2 Codex Switch 多做了什么

**① compact 端点**（v1.5.0）：对话 >20 条消息时，调 DeepSeek 对旧消息做 LLM 摘要，将几十条消息压成一条 system 消息。直接针对 Agent 循环的 token 累积。

**② blockBackgroundSuggestions**：拦截 Codex Desktop 的后台建议请求。

**③ Token 日志可视化**：每条请求显示 `↑输入 ↓输出`。

### 5.3 结论

|                       | cc-switch | Codex Switch |
| --------------------- | :-------: | :----------: |
| Responses ↔ Chat 翻译 |    ✅     |      ✅      |
| 对话压缩              |    ❌     |      ✅      |
| 拦截后台建议          |    ❌     |      ✅      |
| Token 可见            |    ❌     |      ✅      |

**Codex Desktop → DeepSeek 场景下，Codex Switch 更省 Token。** 差距就在 compact——这是唯一能实质削减 Agent 循环 token 积累的机制，cc-switch 没有。

> **关键结论**：直连 DeepSeek 在 2026 年技术上不可行（`wire_api = "chat"` 已被 Codex 移除）。即使理论上可行，也不会减少 token 消耗——Agent 循环的 token 累积问题与是否走代理无关。代理反而是目前唯一能主动减少 token 消耗的手段（compact/摘要）。

## 6. 改进建议

### P0 — 降低 compact 触发阈值

**现状**：>20 条消息才触发 LLM 摘要压缩。
**建议**：改为 >10 条消息、或 token 估算 >50K 时触发。

```typescript
// compact.ts shouldCompact()
const TOKEN_THRESHOLD = 50_000; // 新增 token 维度
const MESSAGE_THRESHOLD = 10; // 从 20 降到 10
```

**预期效果**：Agent 循环在第 5-6 轮就触发压缩，避免从 8K 涨到 231K。

### P1 — 工具结果摘要化

**现状**：工具调用结果（Bash 输出、文件内容、mcp 返回）原样保存在对话历史中。
**建议**：在 compact 时，对历史中的 `< 10 条消息` 的工具结果用一句话摘要替代原文。

```
旧：tool_result: "file.ts content: ... (5,000 lines of code)"
新：tool_result: "[已读取 file.ts，共 5,000 行 TypeScript 代码]"
```

**预期效果**：单条消息从 30K token 降到 ~50 token。

### P2 — Token 用量可见

**现状**：用户完全感知不到每次对话消耗了多少 token。
**建议**：在 Dashboard 或 Logs 页增加"本次对话 token 消耗"实时显示，让用户有成本意识。

### P3 — 引导用户关闭不必要的工具

**现状**：44 个工具全开。
**建议**：在安装指南或 Settings 中提示"如果不需要 Bash/Agent 能力，可以精简工具列表以减少 token 消耗"。

### P4 — DeepSeek 自动上下文缓存（已支持，无需改动）

**DeepSeek 已原生支持自动磁盘上下文缓存（KV Cache）。** 根据 [DeepSeek 官方文档](https://api-docs.deepseek.com/guides/kv_cache)：

- **全自动，零改动**：不需要 SDK 变更、不需要 `cache_control` 标记、默认对所有用户开启
- **前缀匹配**：请求开头 token 与之前请求完全相同时，命中缓存
- **90-98% 折扣**：缓存命中输入仅 $0.0028/M token（cache miss 的 $0.14/M 对比）
- **小时到天级别持久化**：远超 Anthropic 的 5 分钟 TTL
- **响应中可见**：`usage.prompt_cache_hit_tokens` 和 `usage.prompt_cache_miss_tokens`

**这对 Codex Agent 循环的意义**：

每轮 Agent 请求的前缀（system prompt + 早期对话 + 工具定义）是稳定的，只有末尾几轮的工具结果在变。因此：

```
Turn 1: [System][User]                          → 全部 miss（首次）
Turn 2: [System][User][Tool1][Result1]          → 前缀命中 [System][User]         → 部分 cache hit
Turn 3: [System][User][Tool1][Result1][Tool2][Result2] → 前缀命中更长            → 更多 cache hit
...
```

缓存命中率随轮次**递增**——因为稳定前缀越来越长。

**实际验证**：从 DeepSeek 开放平台用量数据（2026 年 6 月）确认：

| 模型     | 缓存命中    | 缓存未命中  |  命中率  | 说明                                       |
| -------- | ----------- | ----------- | :------: | ------------------------------------------ |
| v4-pro   | ~107M token | ~106M token | **~50%** | Agent 循环场景，前缀稳定但每轮追加工具结果 |
| v4-flash | ~434K token | ~90K token  | **~83%** | 更轻量的使用模式，对话前缀更稳定           |

**结论：DeepSeek 的自动缓存已经生效，且命中率可观。** 我们的代理没有破坏前缀一致性——消息转换后的请求前缀依然是稳定的。v4-pro 的 50% 命中率符合预期（Agent 循环每轮追加新工具结果，前缀不变部分仍能命中）。v4-flash 的 83% 命中率说明简单对话场景下几乎全部命中。

**不需要做任何代码改动。** 缓存是全自动的。我们只需在 Dashboard 或日志中展示缓存命中数据，让用户感知到"其实没有想象的那么贵"。

## 7. 总结

| 问题                            | 严重度  | 根因                          |         可改善度         |
| ------------------------------- | :-----: | ----------------------------- | :----------------------: |
| Agent 循环导致 token 按轮次叠加 | 🔴 极高 | previous_response_id 全量重发 | 🟢 高（降 compact 阈值） |
| 工具结果原样保留                |  🟡 高  | 无摘要机制                    |   🟢 高（结果摘要化）    |
| 单次请求 982K token             |  🟡 高  | 阈值太高                      |   🟢 中（token 限额）    |
| 用户无感知                      |  🟠 中  | 缺少 token 统计展示           | 🟢 高（Dashboard 增加）  |
| 全 HTTP 无 WS                   |  🟠 低  | Codex Desktop 行为            |   🔴 低（非我方控制）    |

> **一句话结论**：Codex Desktop 无法直连 DeepSeek——`wire_api = "chat"` 已被 Codex 官方移除，所有可用方案（cc-switch、Codex Switch 等）都必须通过本地代理做 Responses ↔ Chat 协议翻译。Token 消耗高不是代理的问题，而是 Agent 模式天然行为。代理反而是唯一能主动减少消耗的手段（compact/摘要），cc-switch 也做不到这一点。

---

> 🤖 分析基于本地日志数据，未涉及远程服务器信息。
