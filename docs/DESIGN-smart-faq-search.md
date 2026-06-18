# Design: 智能搜索 — Codex Switch 的 Spotlight

- **日期**：2026-06-18
- **状态**：方案设计，待 Review
- **版本**：v1.13.0

---

## 1. 定位：Codex Switch 的 Spotlight

Apple 不会在"设置"里放一个搜索框——设置里的搜索是系统级的。每个 Apple App（Mail、Notes、Safari）都有自己的搜索入口，但它们有一个共同点：**搜索是一个动作，不是一页内容**。

Codex Switch 的智能搜索也不应该是帮助页面里的一个框。它应该是**一个随时可用的入口**——无论用户在哪一页（主面板、设置、插件、日志），遇到困惑时都能立刻搜索。

对标：

- **Apple Mail**：右上角 🔍 图标，点开是一个搜索框 popover，不离开当前页面
- **Spotlight**：⌘Space 全局呼出，浮在所有窗口之上
- **VS Code**：⇧⌘P 命令面板，浮在编辑器上方

Codex Switch 的目标用户不需要快捷键——他们需要一个**看得到的入口**和一个**不打断当前操作的搜索体验**。

## 2. 设计方案：HeaderBar 搜索按钮 + 浮层

### 2.1 入口位置

HeaderBar 右侧，帮助按钮旁边。

```
┌─ HeaderBar ───────────────────────────────────────────────┐
│  主面板                                    🔍  ?   [💛]  │
│                                          搜索  帮助  更新 │
└──────────────────────────────────────────────────────────┘
```

- 🔍 搜索图标，和帮助按钮 `?` 同级，大小一致
- 所有页面都可见（setup/dashboard/settings/logs/plugins/help）
- 不占主内容区，不抢注意力

### 2.2 点击后：浮层搜索

不跳转页面，不打开新窗口。在当前页面上方浮出一个干净的搜索框：

```
┌─ 浮层 ────────────────────────────────────┐
│                                           │
│  🔍 搜索 Codex Switch                      │
│  ┌───────────────────────────────────────┐ │
│  │ 为什么 token 消耗这么快？        [↵]  │ │
│  └───────────────────────────────────────┘ │
│                                           │
│  试试问：                                  │
│    Codex 连不上怎么办                      │
│    如何安装插件                            │
│    Claude Desktop 怎么配置                 │
│                                           │
└───────────────────────────────────────────┘
```

输入问题 → 回车或点搜索 → 浮层扩大显示答案：

```
┌─ 浮层（展开状态）──────────────────────────┐
│                                           │
│  🔍 为什么 token 消耗这么快？         [✕] │
│                                           │
│  ┌─ AI 回答 ──────────────────────────┐   │
│  │                                    │   │
│  │ Codex 的 Agent 模式下每次工具调用    │   │
│  │ 都会把完整对话历史重新发送…          │   │
│  │ （Markdown 渲染）                   │   │
│  └────────────────────────────────────┘   │
│                                           │
│                                           │
│  👍 有帮助  👎 没帮助                        │
│                                           │
│  💡 使用你的 DeepSeek 流量，由 AI 基于      │
│     帮助文档和安装指南生成答案                │
└───────────────────────────────────────────┘
```

### 2.3 关闭方式

- 点浮层外的任意区域
- 点 ✕ 按钮
- 按 Esc 键

关闭后回到之前的页面，不改变任何状态。

---

## 3. 搜索原理

### 3.1 给 DeepSeek 什么

把以下内容作为知识库，直接写入 prompt：

| 来源         | 内容                                   | 方式                                 |
| ------------ | -------------------------------------- | ------------------------------------ |
| FAQ          | 25 条常见问题                          | 本地文件，直接拼入                   |
| 上手指南     | onboarding 步骤                        | 本地文件，直接拼入                   |
| Codex 配置   | config.toml 模板 + 说明                | 本地文件，直接拼入                   |
| Claude 配置  | Claude Desktop/CLI 配置说明            | 本地文件，直接拼入                   |
| Token 节省   | 分析报告摘要                           | 本地文件，直接拼入                   |
| **安装指南** | `https://www.codex-switch.cloud/guide` | **给 URL，让 DeepSeek 决定是否去读** |

> 不需要我们自己去抓取安装指南页面——把 URL 给 DeepSeek，它根据用户的问题判断是否需要读取该页面内容来回答。和本地知识库不重复的问题（如"Windows 上怎么装 Node.js"），DeepSeek 会自己去读指南生成答案。

### 3.2 费用说明

使用用户自己的 DeepSeek API Key，每次消耗少量 token。搜索框下方有明确提示。

### 3.3 用户须知

搜索框底部始终展示一行小字：

```
💡 搜索使用你的 DeepSeek API Key，每次消耗少量 token
   由 DeepSeek 基于帮助文档和安装指南生成答案
```

---

## 4. Prompt 模板

```
你是 Codex Switch 的智能助手。Codex Switch 是一款桌面应用，
帮助国内用户在无需翻墙的情况下使用 Codex Desktop、Codex CLI、
Claude Desktop 和 Claude Code CLI，接入 DeepSeek 模型。

请根据以下知识库回答用户问题：
- 回答简洁，3-5 句话即可，需要步骤时用编号列表
- 如涉及具体操作，明确指出在 Codex Switch 的哪个页面/按钮
- 如果知识库没有覆盖，诚实说明并提供排查方向
- 如果问题涉及详细安装步骤（如安装 Node.js、Python、Git、
  下载 Codex/Claude 等），请先访问以下安装指南获取最新内容：
  https://www.codex-switch.cloud/guide

---知识库（FAQ + 指南 + 配置文档）---
{context}

---用户问题---
{query}
```

---

## 5. 技术设计

### 5.1 新增/修改文件

```
codex-switch/
├── electron/
│   ├── ipc/
│   │   └── channels.ts          # +1: search:ask
│   └── main.ts                   # +50 行：搜索 handler（拼接 prompt → 调 DeepSeek）
├── src/
│   ├── components/
│   │   ├── HeaderBar.tsx         # 修改：新增 🔍 搜索按钮
│   │   └── SearchPopover.tsx     # 新增：搜索浮层组件
│   └── types/
│       └── global.d.ts           # 修改：新增 search:ask API
```

### 5.2 IPC 通道

```
search:ask
  → 入参：{ query: string }
  → 主进程：
      1. 读取本地知识库文件（FAQ + onboarding）
      2. 拼接 prompt（含安装指南 URL，不抓取）
      3. 调 DeepSeek API（用户 Key，stream=false，15s 超时）
      4. 记录请求日志
      5. 返回答案
  → 出参：{ answer: string }
```

不需要缓存、不需要抓取远程页面——只管拼 prompt 和调 API。其余交给 DeepSeek。

### 5.3 搜索请求日志

智能搜索调 DeepSeek 的过程需要在现有日志系统中体现，和代理转发日志放在同一个页面，用户和开发者都能看到。

**日志格式**（复用现有 `ProxyLogEntry` 结构）：

```typescript
{
  ts: Date.now(),
  level: 'info',
  source: 'search',           // 新 source 类型
  reqId: `search_${Date.now().toString(36)}_${random(4)}`,
  phase: 'start',             // start → success / error
  message: `→ 智能搜索 query="${truncate(query, 80)}"`,
  model: 'deepseek-v4-flash',
  meta: {
    queryLength: query.length,
    inputTokens: usage?.prompt_tokens,
    outputTokens: usage?.completion_tokens,
  },
}
```

**三阶段日志**：

```
[search] → 智能搜索 query="为什么 token 消耗这么快？" model=deepseek-v4-flash
[search] ✓ 智能搜索完成 耗时=1240ms ↑8234↓156
[search] ✗ 智能搜索失败 错误=请求超时
```

**日志页面展示**：

在「📜 日志」页面的来源筛选器中新增「🔍 搜索」标签，筛选器变为「全部 / 代理 / 搜索」。现有的「Claude Desktop」标签需要移除——因为 v1.6.0 起 Claude Desktop 直连 DeepSeek，不再经过代理，不会产生代理日志。用户可以在日志页看到每次搜索的输入 token 和输出 token。

**持久化**：搜索日志和其他日志一起写入 `persistentLog`（ndjson 文件），重启不丢失。

### 5.4 搜索浮层组件（SearchPopover.tsx）

| Props                 | 说明     |
| --------------------- | -------- |
| `open: boolean`       | 是否显示 |
| `onClose: () => void` | 关闭回调 |

内部状态：`query`、`answer`、`loading`、`error`。单文件，约 120 行。

### 5.5 边界情况

| 场景              | 行为                                    |
| ----------------- | --------------------------------------- |
| API Key 未配置    | 提示"请先在设置中填写 DeepSeek API Key" |
| 搜索超时（15s）   | 提示"搜索超时，请重试或浏览帮助页面"    |
| DeepSeek 请求失败 | 提示具体错误，建议重试                  |
| 网络断开          | 提示"网络不可用，请检查连接"            |
| 空查询            | 不发送请求，搜索按钮 disabled           |
| 安装指南获取失败  | 仅用本地知识库搜索，不影响结果          |

---

## 6. 运营数据上报

### 6.1 客户端遥测事件

复用现有 TelemetryClient，新增两个事件：

**搜索事件**（搜索完成后上报）：

```typescript
{
  event: 'smart_search',
  search_id: string,           // UUID，客户端生成，用于关联反馈事件
  query_length: number,        // 用户输入的问题长度（字符数）
  duration_ms: number,         // 搜索耗时
  success: boolean,            // 是否成功返回答案
  source: 'local' | 'hybrid',  // local=仅本地知识库，hybrid=也给了安装指南 URL
}
```

**反馈事件**（用户点击 👍 或 👎 后上报）：

```typescript
{
  event: 'smart_search_feedback',
  search_id: string,           // 关联的搜索事件 UUID
  helpful: boolean,            // true=👍, false=👎
}
```

> `source` 由 prompt 结构决定（是否包含安装指南 URL），不解析 DeepSeek 响应。客户端无法可靠判断 DeepSeek 是否真的访问了 URL。
>
> `search_id` 让服务端可以精确关联搜索和反馈——知道哪些搜索满意率高、哪些类型的问题用户不满意。

上报时机：搜索完成后、用户点击反馈按钮时。不上报搜索内容和答案原文。

### 6.2 Server 端 Admin 看板

`smart_search` 是客户端遥测事件，和 `model_call`/`app_start`/`tool_install` 同类，在 **Client 运营** Tab 展示（不新建 Tab，不放在增长 Tab）。

在 Client 运营 Tab 的「操作系统洞察」下方新增一个区块：

```
┌─ 智能搜索 (30天) ──────────────────────┐
│                                        │
│  搜索次数    成功率     满意率    平均耗时  │
│   1,234     98.5%      87.3%    1.2s   │
│                                        │
│  涉及安装指南    42%                     │
└────────────────────────────────────────┘
```

**位置**：Client 运营 Tab，操作系统洞察下方、事件趋势上方。

### 6.3 Server 端改动

| 文件                                 | 改动   | 说明                                                             |
| ------------------------------------ | ------ | ---------------------------------------------------------------- |
| `src/schemas/telemetry.py`           | +2 行  | `VALID_EVENT_TYPES` 新增 `smart_search`、`smart_search_feedback` |
| `src/admin/templates/dashboard.html` | +30 行 | Client 运营 Tab 新增搜索统计区块                                 |
| `src/admin/router.py`                | +15 行 | 查询搜索统计传给模板                                             |

Admin 看板统计逻辑：

| 指标             | SQL                                                                        |
| ---------------- | -------------------------------------------------------------------------- |
| 搜索次数         | `COUNT WHERE event_type='smart_search' AND success=true`                   |
| 成功率           | `COUNT(props->>'success' = 'true') / COUNT(*)`                             |
| 满意率           | `JOIN feedback ON search_id WHERE feedback.helpful=true / COUNT(feedback)` |
| 反馈率           | `COUNT(feedback) / COUNT(search)`                                          |
| 涉及 hybrid 比例 | `COUNT WHERE props->>'source' = 'hybrid' / COUNT(*)`                       |
| 平均耗时         | `AVG(props->>'duration_ms')`                                               |

### 6.4 不上报的内容

| 数据类型           | 是否上报 | 原因               |
| ------------------ | :------: | ------------------ |
| 用户搜索的问题原文 |    ❌    | 隐私               |
| 答案内容           |    ❌    | 隐私               |
| 用户 IP / 位置     |    ❌    | 隐私               |
| 问题长度（字符数） |    ✅    | 了解用户问得多详细 |
| 是否命中安装指南   |    ✅    | 了解知识库覆盖率   |
| 搜索耗时           |    ✅    | 性能监控           |
| 成功/失败          |    ✅    | 可靠性监控         |

---

## 7. 为什么不放在 Codex 里

Codex 是更好的多轮对话工具，但有一个死循环：

> Codex 连不上 DeepSeek → 用户想在 Codex 里问怎么修 → Codex 连不上当然也问不了

智能搜索必须在 Codex Switch 里——它是用户一定能打开的应用。如果用户想深入追问，浮层底部有"在 Codex 中继续问"按钮。

---

> 🤖 Generated with [Claude Code](https://claude.com/claude-code)
