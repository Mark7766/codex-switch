# DESIGN: 对话历史改为纯内存缓存，Codex JSONL 作为权威数据源

> 状态：提案  
> 日期：2026-06-19  
> 版本：v5.0  
> 关联：[DESIGN-conversation-preservation.md](DESIGN-conversation-preservation.md)

---

## 目录

1. [问题发现](#1-问题发现)
2. [定位调整](#2-定位调整)
3. [对标分析与决策](#3-对标分析与决策)
4. [Codex 原生存储调研](#4-codex-原生存储调研)
5. [新架构设计](#5-新架构设计)
6. [上下文超限处理](#6-上下文超限处理)
7. [模块变更清单](#7-模块变更清单)
8. [数据流对比](#8-数据流对比)
9. [兼容性与边界情况](#9-兼容性与边界情况)
10. [实施步骤](#10-实施步骤)
11. [收益总结](#11-收益总结)

---

## 1. 问题发现

### 1.1 当前定位的错误

我们的 ndjson 被当作"对话存储"——读历史从这里读，写新消息往这里写。代码里叫 `conversationStore`。

**但对话的权威记录在 Codex 手里：**

```
~/.codex/sessions/YYYY/MM/DD/rollout-{timestamp}-{uuid}.jsonl
```

Codex 把每一条消息实时追加上去。我们的 ndjson 只是格式翻译后的一份副本。

### 1.2 缓存上限导致的上下文丢失

```
用户 3 周前有一个长对话 A，100+ 轮，response id = resp_abc
之后又密集用了对话 B、C、D...
对话 A 被挤出 1000 条缓存

今天用户回来，Codex 切回对话 A，发一条新消息：
Codex → 代理: { previous_response_id: "resp_abc", messages: [{role:"user", content:"帮我继续改那个函数"}] }

代理处理:
  缓存里没有 resp_abc          ← 被淘汰了
  → 发给 DeepSeek 的请求里只有当前这条消息，没有任何历史
  → DeepSeek 看到"全新对话"，完全不知道之前聊了什么
  → 回答答非所问
```

**信息没有丢**——Codex 的 JSONL 里对话 A 的完整记录还在。

### 1.3 根本原因

我们有上限（1000 条），Codex 没有上限。超出就淘汰。**当用户翻旧对话时，gap 出现了。**

### 1.4 ndjson 持久化在做什么

把翻译后的消息写盘，启动时再读回来。**本质是拿磁盘当第二级缓存——但第一级（内存）已经丢了的东西，第二级（ndjson）迟早也会丢（同一条 LRU 淘汰线）。** 持久化没解决上限问题，只是让缓存活过了重启。

---

## 2. 定位调整

### 核心转变

|             | 旧定位                        | 新定位                        |
| ----------- | ----------------------------- | ----------------------------- |
| 我们的缓存  | **对话存储**（ndjson 持久化） | **纯内存缓存**（LRU，不写盘） |
| Codex JSONL | 不知道它存在                  | **权威数据源**                |
| 缓存未命中  | 不该发生                      | 正常——从 Codex JSONL 读       |

### 一句话

> 不自己存盘。内存里放翻译后的结果加速。没命中就从 Codex JSONL 读。Codex 负责持久化，我们负责翻译。

### 为什么可以不持久化

和 cc-switch 一样的逻辑：缓存是加速层，重启后清空，按需重新加载。数据源头（Codex JSONL）永远在磁盘上，信息不丢。区别是 cc-switch 512 条内存满了就真丢了——我们没命中时会从 Codex JSONL 读回来。

---

## 3. 对标分析与决策

### 3.1 cc-switch 和 Codex++ 的做法

两个都没有自己的 compact，也没有自己的持久化缓存。做的事情完全一样：

**写入 Codex config.toml**：

```toml
model_context_window = 1000000
model_auto_compact_token_limit = 900000

[features]
enable_request_compression = false
remote_compaction_v2 = false
```

**缓存策略**：cc-switch 512 条纯内存（`RwLock<HashMap>`），超了丢；Codex++ 不存代理数据。

**上下文超限时**：DeepSeek 返回 400/413，错误透传。

### 3.2 Codex Switch 的决策

和它们保持一致的策略，但补上它们各自缺的东西：

| 维度           | cc-switch        | Codex++        | Codex Switch                    |
| -------------- | ---------------- | -------------- | ------------------------------- |
| 缓存           | 512 内存，超了丢 | 无             | 500 内存 + Codex JSONL fallback |
| 超容量回退     | ❌ 丢了就丢了    | N/A            | ✅ Codex JSONL 回退读取         |
| compact        | 写 config 回避   | 写 config 回避 | 写 config 回避，删 compact 代码 |
| 上下文超限提示 | 原文透传         | 原文透传       | ✅ 中文翻译                     |
| 持久化         | ❌               | ❌             | ❌（Codex 负责）                |

**不做持久化的理由**：

1. 和 cc-switch 对齐——缓存是加速层，重启清空、按需加载
2. 少一个要维护的读写格式（ndjson 追加写入、原子写入、文件轮转）
3. 删除 `conversation-store.ts` 全部读写逻辑 ~300 行
4. Codex JSONL fallback 保证了信息不丢——cc-switch 有上限会丢，我们没有

---

## 4. Codex 原生存储调研

### 4.1 文件布局

```
~/.codex/
├── config.toml
├── auth.json
├── state_5.sqlite               # 会话元数据（SQLite）
├── sessions/                    # 会话正文
│   └── YYYY/
│       └── MM/
│           └── DD/
│               ├── rollout-2026-06-18T22-54-51-{uuid}.jsonl
│               └── ...
```

### 4.2 state_5.sqlite — threads 表

| 字段                    | 类型    | 说明                |
| ----------------------- | ------- | ------------------- |
| id                      | TEXT    | 会话 UUID           |
| title                   | TEXT    | 对话标题            |
| model_provider          | TEXT    | 供应商标识          |
| model                   | TEXT    | 模型名称            |
| tokens_used             | INTEGER | token 消耗          |
| rollout_path            | TEXT    | 对应 JSONL 文件路径 |
| created_at / updated_at | TEXT    | 时间戳              |

### 4.3 JSONL 行格式

```json
{"type":"session_meta","payload":{"id":"uuid-xxx","model_provider":"custom","created_at":"..."}}
{"type":"message","payload":{"role":"user","content":[{"type":"input_text","text":"hello"}]}}
{"type":"function_call","payload":{"call_id":"call_1","name":"read","arguments":"..."}}
{"type":"function_call_result","payload":{"call_id":"call_1","output":"..."}}
```

### 4.4 读写特性

- JSONL 实时追加写入，每收到 SSE chunk 就 append 一行
- Codex 单实例写入，不存在多进程竞争
- 不存在竞态——Codex 发下一请求前一定已写完上一条 response

---

## 5. 新架构设计

### 5.1 核心流程

```
Codex CLI 发来请求
  │
  ├─ 1. 查内存缓存（LRU, 500 条）
  │     命中 ──→ 直接返回（已是 Chat 格式）
  │     未命中 ──→ 进入 fallback
  │
  ├─ 2. fallback: 从 Codex JSONL 读
  │     ├─ state_5.sqlite → 查 rollout_path
  │     ├─ 读 JSONL 文件
  │     ├─ 过滤 type: "message" 行
  │     ├─ Responses → Chat 格式翻译
  │     └─ 更新内存缓存
  │
  ├─ 3. 协议翻译 → 调 DeepSeek
  │     │
  │     ├─ 成功 → 本轮新消息写入内存缓存 → 返回
  │     │
  │     └─ DeepSeek 返回上下文超限错误
  │         → 翻译成中文 → 返回给用户
  │         → "对话历史过长，超出 DeepSeek 上下文上限（128K tokens）。
  │            建议使用 /new 开启新对话继续。"
  │
  └─ （不写盘。Codex 自己负责持久化）
```

### 5.2 Codex config.toml 写入策略

用户点击"保存并应用"按钮时，跟着其他 Codex 配置一起写入 `~/.codex/config.toml`：

```toml
model_context_window = 1000000
model_auto_compact_token_limit = 900000

[features]
enable_request_compression = false
remote_compaction_v2 = false
```

- `model_context_window = 1000000` — Codex 以为有 1M 窗口，放心堆上下文
- `model_auto_compact_token_limit = 900000` — 900K 才触发，基本不触发
- `enable_request_compression = false` — 不发 `/v1/responses/compact` 避免 404
- `remote_compaction_v2 = false` — 同上

写入时机：已有"保存并应用"路径追加四个字段，不单独搞启动逻辑。

### 5.3 处理 /compact 请求（兜底）

即使用户配置禁用了，Codex 偶尔仍可能发 compact 请求：

```
POST /v1/responses/compact
  → 返回 200 { compaction: null }
```

告诉 Codex"不需要压缩"。Codex 继续正常，不中断。

### 5.4 内存缓存规格

| 项目   | 规格                                        |
| ------ | ------------------------------------------- |
| 结构   | LRU（HashMap + 双向链表）                   |
| 上限   | 500 条（与 cc-switch 512 接近）             |
| Key    | responseId（或 sessionId）                  |
| Value  | `{ messages: Message[], cachedAt: number }` |
| 淘汰   | 最久未访问的先淘汰                          |
| 持久化 | ❌ 纯内存，重启清空                         |
| 未命中 | Codex JSONL → 翻译 → 加入缓存               |

**为什么是 500 而不是 1000**：权威数据在 Codex JSONL，不需要存那么多。缓存没命中从 JSONL 补，条数少一点不影响。

### 5.5 为什么不做持久化

```
之前: 内存 LRU ──淘汰→ ndjson 磁盘 ──重启→ 内存 LRU
            磁盘是内存的救命稻草，但同一条淘汰线决定了磁盘也会淘汰

现在: 内存 LRU ──淘汰→ Codex JSONL ──按需→ 内存 LRU
           Codex 自己负责持久化，永远不会淘汰
```

ndjson 持久化在"旧对话隔久回来"场景下没有帮上忙——缓存淘汰线是同一个阈值，内存里淘汰的条目 ndjson 里大概率也已经淘汰了。真正的救命稻草是 Codex JSONL（无上限），而不是 ndjson（有上限的重复数据）。

---

## 6. 上下文超限处理

### 6.1 什么时候发生

极长对话超过 DeepSeek 128K token 窗口。

### 6.2 怎么检测

DeepSeek 返回的错误包含特征字符串：

- `"maximum context length is 131072"`
- `"context length exceeds"`
- HTTP 400/413 + body 含 `context` + `length` / `exceed`

### 6.3 怎么翻译

代理匹配到上下文超限错误后，不把英文原文透传，替换为：

```
对话历史过长，超出了 DeepSeek 模型的上下文窗口上限（128K tokens）。

建议：
  1. 使用 /new 开启新对话继续
  2. 如必须在本对话继续，可删除部分不再需要的文件引用和工具调用结果后重试
```

> 注：不推荐 `/compact`。因为 `/compact` 会触发 Codex 调 `POST /v1/responses/compact` 到代理，代理只返回 `{ compaction: null }`——不做任何压缩。建议了等于误导。

### 6.4 不在代理层做 compact 的原因

1. LLM 摘要是不可逆的信息损失——摘丢关键细节导致回答出错，用户不知道原因
2. cc-switch 和 Codex++ 都不做，实际使用下来没有问题
3. `/compact` 经过代理无法工作，自己做摘要又有风险
4. 减代码、减维护

---

## 7. 模块变更清单

```
       删除                修改                新增              不变
  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │ conversation │   │ codex/       │   │ codex-session│   │ proxy/       │
  │ -store.ts    │   │ config-toml  │   │ -reader.ts   │   │ translate.ts │
  │              │   │ .ts          │   │              │   │              │
  │ compact.ts   │   │ 加上下文     │   │              │   │ proxy/        │
  │              │   │ 窗口配置写入 │   │              │   │ stream.ts    │
  │ ndjson 文件  │   │              │   │              │   │              │
  │ 不再创建     │   │ server.ts    │   │              │   │ codex/       │
  │              │   │ 缓存改为     │   │              │   │ auth.ts      │
  │ 不再从 ndjson│   │ 纯内存 LRU   │   │              │   │              │
  │ 读写         │   │ + fallback   │   │              │   │ config/      │
  │              │   │ + 错误翻译   │   │              │   │              │
  └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
```

### 7.1 删除：`conversation-store.ts`

删除全部 ndjson 读写逻辑（~300 行）：

- ndjson 追加写入
- ndjson 按行读取
- 原子写入
- 文件轮转
- 相关测试文件
- 相关 IPC 通道（`conversation:getAll`、`conversation:clear`、`conversation:setMaxItems`）

用户机器上已有的 ndjson 文件不自动删除，可手动清理。

### 7.2 删除：`compact.ts`

删除全部 LLM compact 代码及相关测试（~200 行）。

### 7.3 新增：`codex-session-reader.ts`

纯只读模块：

```
readSessionHistory(responseId: string) → Message[]
  // state_5.sqlite → 查 rollout_path
  // 读 JSONL 文件
  // 过滤 type: "message"
  // 按时间排序返回
```

不写任何东西。不关心缓存。

错误处理：JSONL 不存在 / SQLite 不可用 → 返回空数组 + log warning。未知 type → skip。

### 7.4 新增：内存 LRU 缓存

在 `server.ts` 或独立模块中，一个简单 LRU：

```
cache.get(responseId) → Message[] | null
cache.set(responseId, messages)
cache.maxSize = 500
```

淘汰策略：最久未访问先淘汰。重启清空。

### 7.5 修改：`server.ts`

请求处理改为：

```
cache.get(respId)
  → 命中 → 直接用
  → 未命中 → codexSessionReader.readSessionHistory(respId)
           → Responses → Chat 翻译
           → cache.set(respId, messages)
           → 用

translate → fetch DeepSeek
  → 成功 → cache.set(respId, updatedMessages) → 返回
  → 超限 → 中文错误提示 → 返回

（不写盘）
```

### 7.6 修改：`codex/config-toml.ts`

在现有"保存并应用"写入流程追加四个字段：

```toml
model_context_window = 1000000
model_auto_compact_token_limit = 900000
[features]
enable_request_compression = false
remote_compaction_v2 = false
```

Settings UI 提供开关"自动配置 Codex 上下文窗口"（默认开启），关闭后跳过写入。

### 7.7 新增：上下文超限错误翻译

DeepSeek 返回上下文超限错误时，匹配特征字符串 → 翻译为中文提示 → 返回给 Codex。

### 7.8 不变的部分

- `proxy/translate.ts` — 协议翻译
- `proxy/stream.ts` — SSE 转发
- `codex/auth.ts` — 认证管理
- `config/` — 用户配置

---

## 8. 数据流对比

### 8.1 当前

```
请求 → ndjson 读历史 → compact → 翻译 → DeepSeek → ndjson 写新消息
         ↑                                    ↑
    磁盘 I/O                            磁盘 I/O
    （每次请求读写盘）                    （每次请求写盘）
```

### 8.2 新方案

```
请求 → 内存 LRU
         │
         ├─ 命中 → 直接用（零 I/O）
         │
         └─ 未命中 → Codex JSONL（一次读盘）
                       → 翻译 → 内存
                       → 用
         │
         ▼
  翻译 → DeepSeek
         │
         ├─ 成功 → 内存缓存更新 → 返回
         └─ 超限 → 中文提示 → 返回

重启: 内存清空 → 下一请求从 Codex JSONL 按需加载
```

**变化**：不再写盘。缓存从 ndjson + 内存双层 → 纯内存单层。Codex JSONL 是唯一磁盘数据。

---

## 9. 兼容性与边界情况

### 9.1 正常：缓存命中

**99%+ 的请求。** 内存 LRU 里有。零 I/O，直接返回。

### 9.2 缓存未命中，Codex JSONL 存在

旧对话被 LRU 淘汰 + 用户回来继续 → 从 Codex JSONL 读 → 翻译 → 更新内存 → 继续。

用户感知：第一次请求多几十毫秒（读 JSONL + 翻译），后续走内存。

### 9.3 缓存未命中，Codex JSONL 也不存在

Codex 没装 / sessions 被删 / 换机器 → 返回空历史。相当于新对话。

### 9.4 Codex JSONL 格式变化

宽松解析：未知 `type` skip。`_sqlx_migrations` 做版本探测。失败时 fallback 空历史。

### 9.5 已有 ndjson 文件

不自动迁移、不自动删除。用户可手动清理 `~/.codex-switch/`。

### 9.6 重启后

内存清空。下一请求从 Codex JSONL 按需加载。启动速度更快（不需要加载 ndjson）。

---

## 10. 实施步骤

每一步独立可合入。

| 阶段        | 内容                                                                                 | 影响           | 风险             |
| ----------- | ------------------------------------------------------------------------------------ | -------------- | ---------------- |
| **Phase 1** | 新增 `codex-session-reader.ts`，验证正确读取 Codex JSONL + SQLite                    | 零影响，纯新增 | 低               |
| **Phase 2** | `server.ts` 加内存 LRU 缓存 + Codex JSONL fallback。先和现有 ndjson 并行（双读验证） | server.ts      | 低               |
| **Phase 3** | 停止写 ndjson。缓存改为纯内存。                                                      | server.ts      | 中（停止写盘）   |
| **Phase 4** | `codex/config-toml.ts` 加上下文窗口配置写入                                          | config-toml    | 低               |
| **Phase 5** | `server.ts` 加 DeepSeek 上下文超限 → 中文翻译                                        | server.ts      | 低               |
| **Phase 6** | 删除 `conversation-store.ts` + `compact.ts` + 测试 + IPC 通道                        | 删除 ~500 行   | 低（前面已验证） |
| **Phase 7** | 可选：Settings UI 调整                                                               | Settings       | 低               |

---

## 11. 收益总结

### 11.1 四个变化

| 变化       | 之前              | 之后                 |
| ---------- | ----------------- | -------------------- |
| 缓存持久化 | ndjson 磁盘       | ❌ 纯内存            |
| 缓存未命中 | 返回空            | Codex JSONL fallback |
| compact    | LLM 摘要 ~200 行  | ❌ 删除              |
| 上下文超限 | 无处理 / 可能 404 | 中文提示             |

### 11.2 代码量

| 操作                                | 行数           |
| ----------------------------------- | -------------- |
| 删除 `conversation-store.ts` + 测试 | ~300 行        |
| 删除 `compact.ts` + 测试            | ~200 行        |
| 删除 IPC 通道                       | ~20 行         |
| 新增 `codex-session-reader.ts`      | ~80 行         |
| 新增内存 LRU                        | ~50 行         |
| 修改 `server.ts`                    | ~20 行         |
| **净变化**                          | **约 -370 行** |

### 11.3 一句话

> 不做持久化。内存 LRU 缓存加速，Codex JSONL 是唯一磁盘数据源。compact 交给 config 规避。超限错误翻译成中文。和 cc-switch 对齐，少 370 行代码。
