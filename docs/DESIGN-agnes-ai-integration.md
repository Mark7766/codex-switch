# DESIGN: Agnes AI 接入方案

> 状态：提案  
> 日期：2026-06-19  
> 版本：v1.0  
> 原则：简单第一。一个开关，搞定。

---

## 1. Agnes AI 是什么

一个免费的 AI API 网关，提供自研模型 `agnes-2.0-flash`（256K 上下文、支持工具调用）。API 兼容 OpenAI Chat Completions 格式。

| 项目     | 值                                                    |
| -------- | ----------------------------------------------------- |
| Base URL | `https://apihub.agnes-ai.com/v1`                      |
| 认证     | `Authorization: Bearer <key>`                         |
| 文本模型 | `agnes-2.0-flash`（主力）、`agnes-1.5-flash`（轻量）  |
| 协议     | OpenAI Chat Completions（和我们现用的 DeepSeek 一样） |
| 费用     | 目前免费                                              |

---

## 2. 设计方案

### 核心思路：一个开关

DeepSeek 和 Agnes 使用**相同的协议**（Chat Completions）。我们的代理只做一件事——把 Codex 的 Responses API 翻译成 Chat Completions，然后发给上游。上游是谁不重要，只要它讲 Chat Completions。

所以加 Agnes 就是：**设置里多一个选项，选谁就发给谁。**

```
Codex Desktop/CLI
     │  Responses API
     ▼
Codex Switch 代理
     │  翻译 Responses → Chat Completions
     ▼
  ┌─────────────┐     ┌─────────────┐
  │  DeepSeek   │ OR  │   Agnes     │
  │  api.ds.com │     │  apihub...  │
  └─────────────┘     └─────────────┘
```

### 不需要的东西（主动砍掉）

- **多供应商同时路由**。不同对话走不同供应商？太复杂。一个开关，全局生效
- **供应商级模型映射表**。Agnes 的 `agnes-2.0-flash` 直接在模型映射表里配置就行，不需要单独的管理界面
- **供应商配置向导**。不用。API Key 框 + Base URL 框 + 模型名框，3 个字段够了
- **自动供应商探测**。不用。用户自己填

---

## 3. 用户故事

> 作为 Codex Switch 用户，我想在设置里下拉选择使用 DeepSeek 还是 Agnes，保存后代理自动切到对应的 AI 服务，就像 iPhone 里切换 Wi-Fi 一样简单。

---

## 4. 改动范围

### 4.1 Settings UI — 加一个下拉框

```
设置页面现有:
  DeepSeek API Key: [________________]
  模型映射表:       gpt-5-codex → [deepseek-v4-flash ▼]
  端口:              [11435          ]

新增:
  AI 供应商:         [DeepSeek ▼] [Agnes]

  选 DeepSeek → 显示现有的 DeepSeek API Key 框
  选 Agnes → API Key 框变为 Agnes Key，Base URL 变为 agnes-ai.com

  [保存并应用]
```

**就这么一个变化。** 没有新页面、没有新向导、没有弹出框。

### 4.2 配置存储 — 加一个字段

```typescript
// electron/config/store.ts
interface UserPreferences {
  // ...existing fields...
  provider: 'deepseek' | 'agnes'; // 默认 deepseek
  agnesApiKey?: string; // keytar 存储，不落盘明文
  agnesBaseUrl?: string; // 默认 https://apihub.agnes-ai.com/v1
}
```

### 4.3 代理 — 根据供应商切换上游

```
proxy.start() 时:
  if provider === 'deepseek':
    upstream = 'https://api.deepseek.com/v1'
    apiKey = deepseekKey
  else:
    upstream = agnesBaseUrl
    apiKey = agnesKey
```

`stream.ts`、`translate.ts` 不需要任何改动。协议是同一个。

### 4.4 Codex config.toml — 不变

`~/.codex/config.toml` 始终指向 `http://127.0.0.1:11435`。Codex 不感知上游是谁。这是代理层的职责。

### 4.5 模块变更清单

```
       删除                修改                新增
  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │ （无）       │   │ store.ts     │   │ （无）       │
  │              │   │ +provider    │   │              │
  │              │   │ +agnesApiKey │   │              │
  │              │   │              │   │              │
  │              │   │ secrets.ts   │   │              │
  │              │   │ +agnesKey 存储│   │              │
  │              │   │              │   │              │
  │              │   │ server.ts    │   │              │
  │              │   │ 启动时读     │   │              │
  │              │   │ provider决定 │   │              │
  │              │   │ 上游地址     │   │              │
  │              │   │              │   │              │
  │              │   │ Settings.tsx │   │              │
  │              │   │ +供应商选择器 │   │              │
  └──────────────┘   └──────────────┘   └──────────────┘
```

---

## 5. 数据流

```
用户点击「保存并应用」
  → store 存 provider + apiKey
  → 如代理运行中，restart
  → proxy.start() 读 provider，设 upstream URL
  → 后续请求自动走对应供应商
```

**重启 Codex Switch 后**，provider 字段持久化在 electron-store 中，自动恢复。

---

## 6. 参数建议

| 参数                | 建议值                           | 说明                      |
| ------------------- | -------------------------------- | ------------------------- |
| 默认供应商          | `deepseek`                       | 存量用户无感知            |
| Agnes 默认模型      | `agnes-2.0-flash`                | 256K 上下文，支持工具调用 |
| Agnes 默认 Base URL | `https://apihub.agnes-ai.com/v1` | 官方端点                  |
| Agnes API Key       | 用户在平台获取后填入             | keytar 存储               |

---

## 7. 边界情况

| 情况                                | 处理                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| 用户没有 Agnes Key，选了 Agnes      | 启动代理时报错，提示"请填写 Agnes API Key"                                         |
| Agnes 服务不可用                    | 代理正常报错，日志显示原因（和 DeepSeek 超时一样处理）                             |
| 用户从 DeepSeek 切到 Agnes 再切回来 | 每次切换自动重启代理，Codex Desktop 可能有短暂重连（但对话不丢——Codex 自己有状态） |
| Agnes Key 写错                      | 代理启动成功但 Codex 对话报错（auth 失败），和 DeepSeek Key 错误的体验一样         |

---

## 8. 实施步骤

| 阶段 | 内容                                    | 工作量 |
| ---- | --------------------------------------- | ------ |
| 1    | `store.ts` 加 provider + agnesKey 字段  | ~10 行 |
| 2    | `secrets.ts` 加 agnesKey 的 keytar 存取 | ~15 行 |
| 3    | `server.ts` 根据 provider 切换 upstream | ~15 行 |
| 4    | Settings UI 加供应商下拉框              | ~30 行 |
| 5    | 测试                                    | ~20 行 |

总计 ~90 行代码。

---

## 9. 一句话

> 一个下拉框，选 DeepSeek 还是 Agnes。选完保存，代理自动切。就像 iPhone 换 Wi-Fi，点一下就行。
