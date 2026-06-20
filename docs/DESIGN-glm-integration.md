# DESIGN: 智谱 GLM 供应商接入（v1.14.0）

> 状态：提案
> 日期：2026-06-20
> 方案版本：v1.1
> 目标软件版本：v1.14.0
> 原则：能直连就直连，不能直连走代理

---

## 1. 调研结论

智谱 GLM 提供两个主力编程模型，均 MIT 开源，同时提供两种 API 协议：

| 模型        | 上下文      | 最大输出 | 发布时间   | 备注               |
| ----------- | ----------- | -------- | ---------- | ------------------ |
| **GLM-5.2** | 1M tokens   | 128K     | 2026-06-17 | 最新旗舰           |
| **GLM-5.1** | 200K tokens | 128K     | 2026-03-27 | —                  |
| **GLM-4.7** | 200K tokens | 128K     | 2025-12-22 | MoE ~400B/32B 激活 |

均基于 MoE 架构（~750B 总参，~40B 激活），支持 Thinking 模式、工具调用、流式输出。

| 协议                    | 端点                                                    | 用途             |
| ----------------------- | ------------------------------------------------------- | ---------------- |
| OpenAI Chat Completions | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | Codex 代理转发用 |
| Anthropic Messages      | `https://open.bigmodel.cn/api/anthropic`                | Claude 直连用    |

**关键发现**：GLM 的 Anthropic 端点完整兼容 Anthropic Messages API，Claude Desktop 和 Claude Code CLI 可以直接连接，不需要代理翻译。

---

## 2. 接入模式（同 DeepSeek）

```
Codex Desktop / CLI
   │  Responses API
   ▼
Codex Switch 代理 (127.0.0.1:11435)
   │  翻译 Responses → Chat Completions
   ▼
GLM Chat Completions API
   https://open.bigmodel.cn/api/paas/v4/chat/completions

Claude Desktop
   │  Anthropic Messages API（直连）
   ▼
GLM Anthropic 端点
   https://open.bigmodel.cn/api/anthropic

Claude Code CLI
   │  Anthropic Messages API（直连）
   ▼
GLM Anthropic 端点
   https://open.bigmodel.cn/api/anthropic
```

**GLM 和 DeepSeek 的接入模式完全一样**——Codex 走代理，Claude 全家桶直连。

---

## 3. 三工具接入详述

### 3.1 Codex（走代理）

代理新增 GLM 供应商支持，翻译层不变（Responses → Chat Completions）。

| 配置项        | 值                                      |
| ------------- | --------------------------------------- |
| 上游 hostname | `open.bigmodel.cn`                      |
| API 路径      | `/api/paas/v4/chat/completions`         |
| 认证          | `Authorization: Bearer <GLM Key>`       |
| 可选模型      | `glm-5.2`（默认）、`glm-5.1`、`glm-4.7` |

模型解析逻辑：和 DeepSeek 一致——通过 `defaultModel` 和模型映射表正常解析，不强制覆盖。

### 3.2 Claude Desktop（直连）

3P gateway profile 写 GLM 的 Anthropic 端点。

| 配置项                            | 值                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `inferenceGatewayBaseUrl`         | `https://open.bigmodel.cn/api/anthropic`                                                     |
| `inferenceGatewayApiKey`          | `<GLM Key>`                                                                                  |
| `inferenceGatewayAuthScheme`      | `bearer`                                                                                     |
| `inferenceModels[].name`          | `claude-opus-4-7` / `claude-sonnet-4-6` / `claude-haiku-4-5`                                 |
| `inferenceModels[].labelOverride` | `glm-5.2` / `glm-5.2` / `glm-5.2`（默认，用户可在模型映射弹窗中改为 `glm-5.1` 或 `glm-4.7`） |

**GLM 原生理解 Claude 模型名**——GLM 的 Anthropic 端点内部会做模型名映射，所以 `name` 写 Claude 原生名即可，和 DeepSeek 完全一致。用户在设置页面的模型映射弹窗中可独立切换每个 Claude 模型对应 `glm-5.2` 还是 `glm-5.1`。

### 3.3 Claude Code CLI（直连）

`~/.claude/settings.json` 写 GLM 的 Anthropic 端点。

| 配置项                           | 值                                                 |
| -------------------------------- | -------------------------------------------------- |
| `ANTHROPIC_BASE_URL`             | `https://open.bigmodel.cn/api/anthropic`           |
| `ANTHROPIC_AUTH_TOKEN`           | `<GLM Key>`                                        |
| `ANTHROPIC_MODEL`                | `glm-5.2`（可在弹窗中改为 `glm-5.1` 或 `glm-4.7`） |
| `ANTHROPIC_DEFAULT_OPUS_MODEL`   | `glm-5.2`                                          |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `glm-5.2`                                          |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL`  | `glm-5.2`                                          |
| `API_TIMEOUT_MS`                 | `3000000`（GLM-5.2 的 1M 上下文场景需较大超时）    |

**注意**：

- Claude Code CLI 使用 `ANTHROPIC_AUTH_TOKEN`（非 `ANTHROPIC_API_KEY`），后者可能触发 Claude 官方 OAuth 校验导致 401
- GLM-5.2 启用 1M 上下文时模型名可写 `glm-5.2[1m]`

---

## 4. 供应商参数汇总

| 参数                                  | 值                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| 供应商 ID                             | `glm`                                                                        |
| 显示名称                              | `智谱 GLM`                                                                   |
| Chat Completions hostname             | `open.bigmodel.cn`                                                           |
| Anthropic 端点                        | `https://open.bigmodel.cn/api/anthropic`                                     |
| API Key 获取                          | https://open.bigmodel.cn（通用）或 https://z.ai（Coding Plan 包月）          |
| 计费模式                              | 按 token 计费（BigModel）或包月（Z.ai Coding Plan Lite $10/Pro $30/Max $80） |
| 可选模型                              | `glm-5.2`（默认）、`glm-5.1`、`glm-4.7`                                      |
| 默认 Codex 模型                       | `glm-5.2`                                                                    |
| 默认 Claude 模型（Opus/Sonnet/Haiku） | 均为 `glm-5.2`，用户可改为 `glm-5.1` 或 `glm-4.7`                            |

---

## 5. 和 DeepSeek / Agnes 的对比

| 维度                 | DeepSeek                     | Agnes        | GLM                              |
| -------------------- | ---------------------------- | ------------ | -------------------------------- |
| Codex 接入           | 代理                         | 代理         | 代理                             |
| Claude Desktop 接入  | 直连                         | 代理         | **直连**                         |
| Claude Code CLI 接入 | 直连                         | 代理         | **直连**                         |
| Anthropic 端点       | `api.deepseek.com/anthropic` | 无（需代理） | `open.bigmodel.cn/api/anthropic` |
| 模型名映射           | DeepSeek 内部映射            | 代理做映射   | GLM 内部映射                     |

GLM 和 DeepSeek 在同一条"简单路径"上——Claude 直连，Codex 代理。Agnes 在"复杂路径"上——Claude 也要走代理。

---

## 6. Settings UI

在现有的四张卡片中，每张卡片的供应商下拉框新增「智谱 GLM」选项：

```
🔑 供应商设置
  供应商 [DeepSeek ▼] [Agnes AI] [智谱 GLM]（新增）

📟 Codex 接入
  供应商 [DeepSeek ▼] [Agnes AI] [智谱 GLM]（新增）

🖥 Claude Desktop 接入
  供应商 [DeepSeek ▼] [Agnes AI] [智谱 GLM]（新增）

⌨️ Claude Code CLI 接入
  供应商 [DeepSeek ▼] [Agnes AI] [智谱 GLM]（新增）
```

模型映射弹窗的右侧下拉框新增 GLM 选项：`glm-5.2`、`glm-5.1`、`glm-4.7`。Codex 卡片默认模型下拉框同理。

---

## 7. 日志支持

GLM 请求的日志标识：

- **Codex 走 GLM**：source 仍为 `http` / `ws`，成功/错误日志通过 `upstreamLabel` 显示 `[GLM]` 供应商标签
- **Claude 走 GLM**：source 为 `claude`（已有），日志中同样显示 `[GLM]` 标签

`stats.ts` 的 `upstreamLabel` 函数新增 `bigmodel` 匹配：

```
host 含 'agnes'    → [Agnes]
host 含 'deepseek' → [DeepSeek]
host 含 'bigmodel' → [GLM]     ← 新增
其它                → [host]
```

日志页来源筛选已有「全部来源」/「Claude」切换，GLM 的 Claude 请求可通过 Claude 筛选查看。Codex 请求按原有方式查看。

---

## 8. 模块变更

| 模块                | 改动                                                            |
| ------------------- | --------------------------------------------------------------- |
| `store.ts`          | provider 类型新增 `'glm'`；默认映射新增 GLM 模型                |
| `secrets.ts`        | 新增 `getGlmKey` / `setGlmKey` / `clearGlmKey`                  |
| `server.ts`         | 和 DeepSeek 一致——不强制覆盖，走正常模型映射                    |
| `desktop-writer.ts` | provider='glm' 时 3P profile 写 GLM Anthropic 端点 + GLM 模型名 |
| `env-writer.ts`     | provider='glm' 时 ANTHROPIC_BASE_URL 写 GLM Anthropic 端点      |
| `Settings.tsx`      | 所有下拉框新增「智谱 GLM」选项；模型映射弹窗新增 GLM 选项       |
| `types.ts`          | provider 类型扩展                                               |
| `stats.ts`          | `upstreamLabel` 新增 `bigmodel` → `[GLM]`                       |

---

## 9. 一句话

> GLM 的 Anthropic 端点完整兼容，Claude 直接连。接入模式和 DeepSeek 完全一样——Codex 走代理，Claude 直连。支持 GLM-5.2（1M 上下文）、GLM-5.1（200K）、GLM-4.7（200K），用户可在设置中自由切换。v1.14.0。
