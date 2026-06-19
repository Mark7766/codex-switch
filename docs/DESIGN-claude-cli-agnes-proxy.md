# DESIGN: Claude 全家桶接入 Agnes（走 Codex Switch 代理）

> 状态：提案  
> 日期：2026-06-19  
> 版本：v1.0

---

## 1. 背景

三种工具的接入模式：

| 工具              | DeepSeek                          | Agnes                      |
| ----------------- | --------------------------------- | -------------------------- |
| Codex CLI/Desktop | 代理 `127.0.0.1:11435`            | 代理 `127.0.0.1:11435`     |
| Claude Desktop    | 直连 `api.deepseek.com/anthropic` | **代理 `127.0.0.1:11435`** |
| Claude Code CLI   | 直连 `api.deepseek.com/anthropic` | **代理 `127.0.0.1:11435`** |

Agnes 时 Claude 全家桶统一走代理。原因：代理统一管理 Anthropic Messages → Chat Completions 翻译和模型名映射，Claude 端不需要感知 Agnes 的实际模型名。

---

## 2. 数据流

```
Claude Desktop / Claude Code CLI
   │  Anthropic Messages API
   │  Base URL = http://127.0.0.1:11435
   │  model = claude-sonnet-4-6
   ▼
Codex Switch 代理 (127.0.0.1:11435)
   │  翻译: Anthropic Messages → OpenAI Chat Completions
   │  查模型映射表: claude-sonnet-4-6 → <用户在弹窗中配置的值>
   │  如用户配的是 agnes-2.0-flash → 发给 Agnes 的 model = agnes-2.0-flash
   ▼
Agnes API (apihub.agnes-ai.com/v1/chat/completions)
```

---

## 3. 模型映射

模型映射左右两侧：

| Claude 模型（name，发给 API） | →   | 映射值（labelOverride，UI 显示） |
| ----------------------------- | --- | -------------------------------- |
| `claude-opus-4-7`             | →   | `agnes-2.0-flash`                |
| `claude-sonnet-4-6`           | →   | `agnes-2.0-flash`                |
| `claude-haiku-4-5`            | →   | `agnes-2.0-flash`                |

- **name**：Claude 原生模型名（和 DeepSeek 时完全一样），发给代理
- **labelOverride**：Claude Desktop UI 显示的模型名，Agnes 时显示实际映射的 Agnes 模型

代理翻译时不看 Claude 发来的模型名——直接使用当前供应商的 `defaultModel`。三个 Claude 模型统一映射到同一个 Agnes 模型。

---

## 4. 代理翻译层

需要新增或恢复 Anthropic Messages → Chat Completions 翻译。要点：

- 代理新增 `/anthropic/v1/messages` 路由
- 请求体：`{ model, messages, max_tokens, stream, ... }`（Anthropic 格式）
- 翻译成：`{ model, messages, max_tokens, stream }`（Chat Completions 格式），model 从映射表查
- 响应从 Chat Completions SSE 翻译回 Anthropic SSE 格式
- 错误处理：Agnes 返回的错误翻译为 Anthropic 格式

### 和 Codex 代理共存

Codex 代理已经有 `/v1/responses` 和 WebSocket。新增 `/anthropic/v1/messages` 路由（HTTP POST），互不冲突。

### 和 v1.6.0 的区别

v1.6.0 删除了 `anthropic-relay.ts` 因为 Claude Desktop 改为直连 DeepSeek。这次加回来**只用于 Agnes**——当上游是 Agnes 且请求走 Anthropic Messages 格式时才启用翻译。DeepSeek 直连路径不受影响。

### 日志标识

`/anthropic/v1/messages` 路由的请求，日志 `source` 字段设为 `'claude'`，和 Codex 请求的 `'http'` / `'ws'` 区分开。

```
LogSource 类型扩展:
  'http'  → Codex HTTP 请求
  'ws'    → Codex WebSocket 请求
  'claude' → Claude Desktop / CLI 请求（新增）
  'proxy' → 代理自身事件
  'search' → 智能搜索
```

日志页来源筛选器同步新增「Claude」选项，用户可以按来源过滤查看。

---

## 5. Claude Desktop / CLI 配置写入

### Claude Desktop（Agnes 时走代理）

3P gateway profile 写：

```
inferenceGatewayBaseUrl = http://127.0.0.1:11435
inferenceGatewayApiKey = <任意非空值>
inferenceGatewayAuthScheme = bearer
inferenceModels = [
  { name: 'claude-opus-4-7',  labelOverride: 'agnes-2.0-flash' },
  { name: 'claude-sonnet-4-6', labelOverride: 'agnes-2.0-flash' },
  { name: 'claude-haiku-4-5',  labelOverride: 'agnes-2.0-flash' },
]
```

### Claude Code CLI（Agnes 时走代理）

`~/.claude/settings.json` 写：

```
ANTHROPIC_BASE_URL = http://127.0.0.1:11435
ANTHROPIC_AUTH_TOKEN = <任意非空值>（代理不校验，由代理持有真实 Key）
ANTHROPIC_MODEL = claude-sonnet-4-6
ANTHROPIC_DEFAULT_SONNET_MODEL = claude-sonnet-4-6
ANTHROPIC_DEFAULT_OPUS_MODEL = claude-opus-4-7
ANTHROPIC_DEFAULT_HAIKU_MODEL = claude-haiku-4-5
```

和 DeepSeek 直连的区别：`ANTHROPIC_BASE_URL` / `inferenceGatewayBaseUrl` 从供应商域名改为 `127.0.0.1:11435`。模型名始终保持 Claude 原生名，由代理负责翻译。

---

## 6. Settings UI

Claude Code CLI 接入卡片的模型映射弹窗保持不变——左侧 Claude 模型名（和 DeepSeek 时一致），右侧根据供应商显示可选模型列表。选 Agnes 时右侧只有 `agnes-2.0-flash` 和 `agnes-1.5-flash`。

---

## 7. 模块变更

| 模块                | 改动                                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| `desktop-writer.ts` | Agnes 时 3P profile 指向 `127.0.0.1:11435`，`name` 写 Claude 原生模型名 |
| `env-writer.ts`     | Agnes 时 `ANTHROPIC_BASE_URL` 写 `127.0.0.1:11435`                      |
| proxy               | 新增 `/anthropic/v1/messages` 路由 + Anthropic→Chat 翻译                |
| proxy               | 翻译层从模型映射表查实际模型名                                          |
| `types.ts`          | `LogSource` 新增 `'claude'`                                             |
| `stats.ts`          | Claude 请求日志 `source = 'claude'`                                     |
| `Logs.tsx`          | 来源筛选新增「Claude」选项                                              |

---

## 8. 一句话

> Agnes 时 Claude 全家桶统一走代理 `127.0.0.1:11435`。代理做 Anthropic→Chat 翻译，模型名查映射表获取（用户在弹窗里配的），不硬编码。Claude 端模型名列表和 DeepSeek 时完全一致，用户无感知。
