# DESIGN: codex-switch 接入 codex-switch-server 客户端方案（v1.6.0）

- **日期**：2026-06-11
- **状态**：📋 待审查
- **目标版本**：v1.6.0
- **依赖**：Server 端完成 `docs/SERVER-REQUIREMENTS-for-electron-updater.md` 适配
- **生产地址**：`https://www.codexswtich.cloud`
- **Server 工程**：`/Users/mark/work/gitspace/opensource/codex-switch-server`

---

## 1. 背景与目标

### 1.1 当前状态

```
codex-switch (v1.5.0)
├── 更新检查：electron-updater → GitHub Releases（latest-mac.yml）
│   └── Mirror: auto / github / ghproxy / custom
├── 遥测：无
├── 运营数据：无
└── 服务器通信：零
```

### 1.2 目标状态

```
codex-switch (v1.6.0)
├── 更新检查：electron-updater → codex-switch-server（/api/v1/updates/*）
│   └── Mirror: server（默认推荐）/ github / ghproxy / custom
├── 遥测：TelemetryClient → POST /api/v1/telemetry/events
│   └── 事件：app_start, proxy_start, proxy_stop, proxy_error, model_call, ...
├── 运营数据：Server 管理后台可查看下载趋势、版本分布、事件统计
└── 新增模块：electron/server-client/（API 客户端 + 遥测）
```

### 1.3 Server 已提供的 API

| 端点                             | 方法 | 用途                | 客户端使用场景            |
| -------------------------------- | ---- | ------------------- | ------------------------- |
| `/api/v1/updates/latest-mac.yml` | GET  | macOS 更新元数据    | electron-updater feed URL |
| `/api/v1/updates/latest.yml`     | GET  | Windows 更新元数据  | electron-updater feed URL |
| `/api/v1/updates/{filename}`     | GET  | 下载二进制/blockmap | electron-updater 自动拉取 |
| `/api/v1/telemetry/events`       | POST | 批量遥测事件        | 后台定时上报              |
| `/api/v1/packages`               | GET  | 可用工具包列表      | 未来：Dashboard 推荐安装  |
| `/api/v1/analytics/pageview`     | POST | 页面访问追踪        | 未来：Web 下载页埋点      |

---

## 2. 总体架构

```
┌──────────────────────────────────────────────────────────────┐
│                    codex-switch (Electron)                   │
│                                                              │
│  ┌─────────────────────┐   ┌──────────────────────────────┐ │
│  │ electron/updater/   │   │ electron/server-client/       │ │
│  │ ├─ mirrors.ts       │   │ ├─ config.ts   ← 服务器 URL   │ │
│  │ │  + 'server' mode  │   │ ├─ client.ts   ← HTTP 封装    │ │
│  │ └─ index.ts         │   │ └─ telemetry.ts ← 遥测客户端  │ │
│  │  (无改动)            │   │                              │ │
│  └────────┬────────────┘   └──────────────┬───────────────┘ │
│           │                               │                  │
│           │ electron-updater              │ POST /telemetry  │
│           │ GET latest-mac.yml            │ /events          │
│           │ GET *.zip/*.dmg               │                  │
│           ▼                               ▼                  │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              electron/config/store.ts                    │ │
│  │  + serverUrl: string      (默认 https://www.            │ │
│  │  + telemetryEnabled: bool  codexswtich.cloud/api/v1)     │ │
│  │  + clientId: string        (首次启动生成，持久化)         │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                   src/ (Renderer)                        │ │
│  │  Settings.tsx:                                           │ │
│  │   ├─ 更新镜像新增 "官方服务器（推荐）"                      │ │
│  │   ├─ 新增 §数据与隐私：遥测开关 + 服务器地址                │ │
│  │   └─ 版本号 + 服务器连接状态                               │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                                │
                                │ HTTPS
                                ▼
┌──────────────────────────────────────────────────────────────┐
│               codex-switch-server (FastAPI)                  │
│               https://www.codexswtich.cloud                  │
│                                                              │
│  /api/v1/updates/*        ← electron-updater feed           │
│  /api/v1/telemetry/events ← 遥测上报                         │
│  /api/v1/packages         ← 工具包列表（未来）                 │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. 模块设计

### 3.1 `electron/server-client/config.ts` — 服务器配置（新建）

**职责**：管理服务器基础 URL，提供默认值和持久化。

```typescript
// 伪代码接口
export const DEFAULT_SERVER_URL = 'https://www.codexswtich.cloud/api/v1';

export interface ServerConfig {
  /** 服务器基础 URL，例如 https://www.codexswtich.cloud/api/v1 */
  baseUrl: string;
  /** 是否启用遥测上报 */
  telemetryEnabled: boolean;
  /** 客户端唯一标识（首次启动时生成，持久化到 electron-store） */
  clientId: string;
}

export function getServerConfig(prefs: UserPreferences): ServerConfig;
export function buildUrl(config: ServerConfig, path: string): string;
```

**关键决策**：

- `clientId` 使用 `randomBytes(8).toString('hex')` 生成，首次写入 `electron-store`，后续不变
- `baseUrl` 默认硬编码为生产地址，用户可在 Settings 中覆盖（自部署场景）
- `telemetryEnabled` 默认 `true`（用户首次启动时在 Setup 向导中确认）

### 3.2 `electron/server-client/client.ts` — HTTP 客户端（新建）

**职责**：封装对 Server 的 HTTP 请求，提供重试、超时、错误处理。

```typescript
// 伪代码接口
export class ServerClient {
  private baseUrl: string;
  private agent: https.Agent;

  constructor(baseUrl: string);

  /** POST JSON 请求，带基本重试 */
  async post(path: string, body: unknown): Promise<{ status: number; data: unknown }>;

  /** GET 请求 */
  async get(path: string): Promise<{ status: number; data: unknown }>;

  /** 检查服务器连通性 */
  async ping(): Promise<boolean>;
}
```

**实现要点**：

- 复用 `electron/proxy/stream.ts` 中已有的 `https.Agent({ rejectUnauthorized: true })`
- POST 请求超时 10s，失败不重试（遥测数据丢失可接受）
- 不依赖任何第三方 HTTP 库（用 `node:https` 原生模块）
- `ping()` 用 HEAD 请求探活，供 Settings UI 显示"服务器连接状态"

### 3.3 `electron/server-client/telemetry.ts` — 遥测客户端（新建）

**职责**：收集客户端事件，批量上报到 Server。

#### 3.3.1 事件类型

对齐 Server 的 `telemetry_events` 表支持的 `event_type`：

```
app_start          ← 应用启动完成（app.whenReady）
app_close          ← 应用退出（before-quit）
proxy_start        ← 代理启动成功
proxy_stop         ← 代理停止
proxy_error        ← 代理运行期错误（含 error_kind: port-conflict | runtime | auto-recover-failed）
model_call         ← 每次 /v1/responses 或 /anthropic/v1/messages 调用完成（不含消息内容）
config_write       ← 用户保存 Settings
tool_install       ← Claude 工具安装成功
tool_install_fail  ← Claude 工具安装失败
update_check       ← 自动/手动版本检查
update_download    ← 用户触发下载更新
error              ← 全局未捕获异常
```

#### 3.3.2 数据结构

```typescript
interface TelemetryEvent {
  event_type: string;
  timestamp: string; // ISO 8601
  properties: Record<string, unknown>; // 事件特定字段（见 §3.3.3）
}

interface TelemetryPayload {
  client_id: string;
  app_version: string;
  platform: string;
  arch: string;
  os_version: string;
  events: TelemetryEvent[];
}
```

#### 3.3.3 每个事件类型的 properties

```typescript
// app_start
{ first_run: boolean, restore_history_count?: number }

// app_close
{ uptime_seconds: number, request_count: number }

// proxy_start
{ port: number, default_model: string }

// proxy_stop
{ uptime_seconds: number, request_count: number }

// proxy_error
{ error_kind: 'port-conflict' | 'runtime' | 'auto-recover-failed', port: number }

// model_call
{ model: string, stream: boolean, duration_ms: number, success: boolean,
  input_tokens?: number, output_tokens?: number, error_reason?: string }
// ⚠️ 不包含 message content / file paths / API keys

// config_write
{ fields_changed: string[] }  // e.g. ['proxyPort', 'defaultModel']

// tool_install
{ tool: 'codex-cli' | 'codex-desktop' | 'claude-cli' | 'claude-desktop' }

// tool_install_fail
{ tool: string, error_code: string }

// update_check
{ current_version: string, has_update: boolean, mirror_mode: string }

// update_download
{ from_version: string, to_version: string, platform: string, arch: string }

// error
{ error_type: string, source: string }
// ⚠️ 不包含 error.message（可能含路径），只含 error_type（类名或 code）
```

#### 3.3.4 TelemetryClient 设计

```typescript
export class TelemetryClient {
  private buffer: TelemetryEvent[] = [];
  private client: ServerClient;
  private config: ServerConfig;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private enabled: boolean;

  constructor(client: ServerClient, config: ServerConfig);

  /** 记录一个事件（立即入 buffer，不阻塞） */
  track(eventType: string, properties?: Record<string, unknown>): void;

  /** 启动定时上报（每 30s 或 buffer 满 20 条立即 flush） */
  start(): void;

  /** 停止定时器 + 立即 flush 剩余事件（app.on('before-quit') 调用） */
  async stop(): Promise<void>;

  /** 启用/禁用遥测（用户在 Settings 切换时调用） */
  setEnabled(v: boolean): void;

  private async flush(): Promise<void>;
}
```

**关键行为**：

- `track()` 是同步的，不阻塞调用方。事件入内存 buffer 即返回
- `flush()` 是异步的：
  - 从 buffer 取出最多 20 条事件（保留剩余的）
  - 构造 `TelemetryPayload`，POST 到 `/api/v1/telemetry/events`
  - 成功 → 从 buffer 移除已发送事件
  - 失败 → 保留在 buffer（下次 flush 重试）
  - 网络错误静默处理（不弹 toast）
- buffer 最大 200 条，超出丢弃最旧事件
- `stop()` 在 `app.on('before-quit')` 中调用，3s 超时兜底

#### 3.3.5 埋点位置

```
main.ts:
  app.whenReady()          → track('app_start', { first_run, restore_history_count })
  app.on('before-quit')    → track('app_close', { uptime_seconds, request_count })
                            → await telemetry.stop()

  proxy.on('status')       → running → track('proxy_start', { port, default_model })
                            → stopped → track('proxy_stop', { ... })
  proxy.on('proxy-error')  → track('proxy_error', { error_kind, port })

server.ts:
  handleResponses() / handleWs()
    success/error           → track('model_call', { model, stream, duration_ms,
                                                     success, input_tokens, output_tokens })

main.ts:
  prefs:apply handler       → track('config_write', { fields_changed })

  claude:apply-all handler  → track('tool_install', { tool })
                            → track('tool_install_fail', { tool, error_code })

  updater.on('update-available')  → track('update_check', { current_version, has_update })
  updater.on('update-downloaded') → track('update_download', { from_version, to_version })

  process.on('uncaughtException') → track('error', { error_type: 'uncaughtException' })
  process.on('unhandledRejection')→ track('error', { error_type: 'unhandledRejection' })
```

### 3.4 `electron/updater/` — 更新模块变更（修改）

#### 3.4.1 mirrors.ts

`MirrorMode` 新增 `'server'`：

```typescript
export type MirrorMode = 'server' | 'auto' | 'github' | 'ghproxy' | 'custom';
```

`buildFeedUrl()` 新增分支：

```typescript
case 'server':
  // config.baseUrl 是 https://www.codexswtich.cloud/api/v1
  // feed URL = baseUrl + '/updates'
  return `${serverBaseUrl}/updates`;
```

`pickAuto()` 调整：首选 `server` 模式（如果 ping 通），回退 `github`：

```typescript
// 旧: probe github → probe ghproxy → fallback github
// 新: probe server → probe github → probe ghproxy → fallback github
```

#### 3.4.2 index.ts

无需改动。`electron-updater` 的 `setFeedURL(url)` 接口不变，只是 URL 从 GitHub 变成了 Server。

#### 3.4.3 macOS 签名限制（ADR-013 保持不变）

Server 模式**不改变** macOS 的更新行为：

- macOS → 仍打开浏览器下载页（`shell.openExternal`）
- Windows → 走完整的 electron-updater 自动更新（download → install）

### 3.5 `electron/config/store.ts` — 配置扩展（修改）

新增字段：

```typescript
interface UserPreferences {
  // ... 现有字段 ...

  /** v1.6.0: 服务器基础 URL */
  serverUrl: string; // 默认 'https://www.codexswtich.cloud/api/v1'
  /** v1.6.0: 遥测开关 */
  telemetryEnabled: boolean; // 默认 true
  /** v1.6.0: 客户端唯一标识（首次启动自动生成） */
  clientId: string; // 默认 ''
  /** 更新镜像模式 */
  updateMirror: 'server' | 'auto' | 'github' | 'ghproxy' | 'custom'; // 默认改为 'server'
}
```

**迁移逻辑**（`migrateIfNeeded`）：

- v1.5.x → v1.6.0：`clientId` 留空 → 首次加载时自动生成；`updateMirror` 从 `'auto'` 改为 `'server'`；`telemetryEnabled` 设 `true`；`serverUrl` 设默认值

### 3.6 Settings UI 变更（修改）

#### 3.6.1 更新区块

| 变更                 | 说明                                                                      |
| -------------------- | ------------------------------------------------------------------------- |
| 下载镜像下拉新增选项 | "官方服务器（推荐）" — 排在第一位                                         |
| 自定义 URL 输入框    | 仅 `custom` 模式显示（现有逻辑不变）                                      |
| "自动"模式的探测顺序 | 内部改为 server 优先                                                      |
| 新增服务器连接状态   | 当 mirror 为 `server` 时，显示一个小绿点/红点 + "服务器连接正常/无法连接" |

#### 3.6.2 新增「数据与隐私」区块

```
┌─────────────────────────────────────────────┐
│  数据与隐私                                  │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │ 发送匿名使用统计               [开关] │   │
│  │ 帮助我们改进产品。不会发送对话内容、  │   │
│  │ API Key、文件路径或任何个人信息。     │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  服务器地址                                 │
│  ┌──────────────────────────────────────┐   │
│  │ https://www.codexswtich.cloud/api/v1 │   │
│  └──────────────────────────────────────┘   │
│  （自部署用户可修改）                        │
│                                             │
│  客户端标识                                 │
│  a1b2c3d4e5f6...（只读，用于问题排查）       │
└─────────────────────────────────────────────┘
```

---

## 4. 首次启动体验

### 4.1 Setup 向导变更

在现有 Setup 向导的最后一步（"完成并启动代理"），增加一个 checkbox：

```
┌─────────────────────────────────────────────────┐
│  ✅ 发送匿名使用统计                              │
│     帮助我们改进 Codex Switch。                   │
│     我们只收集使用数据（如启动次数、模型调用       │
│     频率），不会收集您的对话内容或 API Key。        │
│     [了解详情]（点击展开隐私说明）                  │
└─────────────────────────────────────────────────┘
```

- 默认勾选
- 用户取消勾选 → `telemetryEnabled = false`
- "了解详情"点击 → 弹出简单的隐私说明 Modal

### 4.2 隐私说明文案

> **我们收集什么**
>
> - 应用启动/关闭次数
> - 代理运行时长和请求次数
> - 模型调用次数和 token 消耗（不含消息内容）
> - 配置修改记录
> - 错误类型和频率（不含文件路径）
>
> **我们不会收集**
>
> - 对话内容、代码、文件路径
> - DeepSeek API Key 或其他凭据
> - 您的 IP 地址（服务器端只存哈希值）
> - 任何个人身份信息
>
> **数据用途**
>
> - 了解版本分布和功能使用情况
> - 发现高频错误并优先修复
> - 规划新功能开发优先级
>
> 您可以在「设置 → 数据与隐私」中随时关闭。

---

## 5. 数据流

### 5.1 启动流程

```
app.whenReady()
  ├─ 1. 读取 prefs（含 serverUrl, clientId, telemetryEnabled, updateMirror）
  ├─ 2. 如果 clientId 为空 → 生成 + 写入 prefs
  ├─ 3. 初始化 ServerClient(baseUrl)
  ├─ 4. 初始化 TelemetryClient(client, config)
  ├─ 5. 如果 telemetryEnabled → telemetry.start()（启动 30s 定时 flush）
  ├─ 6. track('app_start')
  ├─ 7. 如果 updateMirror === 'server' → updater.setFeedURL(serverUrl + '/updates')
  ├─ 8. 3s 后 → updater.check()（自动版本检查）
  └─ ...
```

### 5.2 关闭流程

```
app.on('before-quit')
  ├─ 1. track('app_close', { uptime_seconds, request_count })
  ├─ 2. await telemetry.stop()
  │     ├─ clearInterval(flushTimer)
  │     ├─ await flush() ← 发送 buffer 中剩余事件
  │     └─ Promise.race(flush, 3s_timeout) ← 防止卡退出
  └─ 3. proxy.stop()
```

### 5.3 遥测上报流程

```
代理处理请求
  │
  ├─ server.ts: handleResponses()
  │   ├─ ... 正常处理 ...
  │   └─ success/error 分支:
  │       track('model_call', { model, stream, duration_ms, success, tokens })
  │       ↓
  │       TelemetryClient.track()
  │       ├─ 如果 !enabled → 直接返回
  │       ├─ buffer.push(event)
  │       ├─ 如果 buffer.length >= 20 → 立即 flush()
  │       └─ 否则 → 等待下次 30s 定时器
  │
  ▼ (每 30s 或 buffer 满 20)
  TelemetryClient.flush()
    ├─ 从 buffer 取出最多 20 条
    ├─ POST /api/v1/telemetry/events
    │   body: { client_id, app_version, platform, arch, os_version, events: [...] }
    ├─ 成功 → 从 buffer 移除已发送事件
    └─ 失败 → 保留事件（下次重试），静默
```

---

## 6. 错误处理与降级

| 场景                      | 行为                                                                 |
| ------------------------- | -------------------------------------------------------------------- |
| Server 不可达（DNS/网络） | telemetry 静默缓冲事件等待下次 flush；updater 回退到 github mirror   |
| Server 返回 5xx           | telemetry 保留事件重试；updater 回退                                 |
| Server 返回 4xx           | telemetry 丢弃这批事件（不重试，避免重复上报无效数据）               |
| flush 过程中 app 退出     | `before-quit` 中 3s 超时兜底，超时直接 `app.exit(0)`                 |
| telemetryEnabled = false  | track() 直接返回，不分配任何资源                                     |
| 用户切换 serverUrl        | 重建 ServerClient + 清空遥测 buffer（旧 server 事件不发给新 server） |

---

## 7. 涉及变更的文件

### 7.1 新建

| 文件                                  | 职责                                   | 预估行数 |
| ------------------------------------- | -------------------------------------- | -------- |
| `electron/server-client/config.ts`    | Server URL 配置、clientId 管理         | ~50      |
| `electron/server-client/client.ts`    | HTTP 客户端封装（POST/GET/ping）       | ~80      |
| `electron/server-client/telemetry.ts` | TelemetryClient：buffer、flush、定时器 | ~150     |
| `tests/unit/telemetry.test.ts`        | 遥测单元测试                           | ~120     |

### 7.2 修改

| 文件                          | 变更内容                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `electron/updater/mirrors.ts` | `MirrorMode` 加 `'server'`，`buildFeedUrl` 加 server 分支，`pickAuto` 调整优先级                                                           |
| `electron/config/store.ts`    | 新增 `serverUrl`、`telemetryEnabled`、`clientId` 字段 + 默认值 + 迁移                                                                      |
| `electron/main.ts`            | 初始化 ServerClient + TelemetryClient；hook 遥测埋点（app_start/close、proxy 事件、update 事件、工具安装、全局异常）；before-quit 停止遥测 |
| `electron/proxy/server.ts`    | model_call 事件埋点（HTTP + WS 路径的 success/error 分支）                                                                                 |
| `electron/ipc/channels.ts`    | 新增 `serverPing`、`telemetrySetEnabled`、`serverSetUrl` IPC 通道                                                                          |
| `electron/preload.ts`         | 暴露新的 IPC 方法给渲染层                                                                                                                  |
| `src/pages/Settings.tsx`      | 更新镜像新增"官方服务器"选项；新增「数据与隐私」区块                                                                                       |
| `src/types/global.d.ts`       | 新 IPC API 类型声明                                                                                                                        |
| `src/lib/store.ts`            | Zustand store 新增 telemetryEnabled、serverUrl、serverStatus 状态                                                                          |
| `package.json`                | 1.5.0 → 1.6.0                                                                                                                              |
| `CHANGELOG.md`                | v1.6.0 条目                                                                                                                                |

---

## 8. 安全性

| 原则           | 措施                                                                          |
| -------------- | ----------------------------------------------------------------------------- |
| 不泄露用户内容 | `model_call` 只上报 model、tokens、success，**不上报 message content**        |
| 不泄露凭据     | 所有遥测事件明确排除 API Key、auth.json 内容                                  |
| 不泄露路径     | `error` 事件只上报 `error_type`（类名），不上报 `error.message`（可能含路径） |
| 不泄露 IP      | Server 端只存 `ip_hash`（SHA-256），客户端无需额外处理                        |
| 用户可控       | Settings 中可随时关闭遥测；关闭后 track() 零开销返回                          |

---

## 9. 测试策略

### 9.1 单元测试

`tests/unit/telemetry.test.ts`：

| 用例                                        | 覆盖                               |
| ------------------------------------------- | ---------------------------------- |
| `track() adds event to buffer`              | 基本入队                           |
| `flush() sends events and clears buffer`    | 正常发送（mock ServerClient）      |
| `flush() keeps events on server error`      | 发送失败 → 事件保留                |
| `flush() discards events on 4xx`            | 400 → 丢弃（避免重复上报无效数据） |
| `buffer max 200, oldest evicted`            | 容量限制                           |
| `setEnabled(false) makes track() no-op`     | 关闭遥测                           |
| `stop() flushes remaining and clears timer` | 优雅停止                           |
| `clientId generated on first access`        | 首次生成                           |
| `clientId persisted across restarts`        | 持久化                             |

### 9.2 集成验证

```bash
# 启动开发模式
pnpm dev

# 检查：
# 1. Settings 页 → 数据与隐私区块可见
# 2. 遥测开关默认开启
# 3. 服务器地址显示正确
# 4. 查看日志：telemetry flush 的请求（dev 环境下可用 console.log）
# 5. 关闭遥测开关 → 无后续上报
# 6. 重新打开 → 恢复上报
```

---

## 10. 版本规划

```
v1.5.0（当前）
  └─ compact 上下文压缩（LLM 摘要 + 持久化）

v1.6.0（本方案）
  ├─ 更新检查接入 Server（新增 'server' mirror 模式）
  ├─ 遥测客户端（TelemetryClient）
  ├─ Settings 新增「数据与隐私」区块
  └─ 新增 electron/server-client/ 模块

v1.7.0（未来）
  └─ Dashboard 展示 tool packages（GET /api/v1/packages）
  └─ 帮助页接入远程 FAQ / onboarding
```

---

## 11. 前提条件

Server 端需先完成 [SERVER-REQUIREMENTS-for-electron-updater.md](./SERVER-REQUIREMENTS-for-electron-updater.md) 中的适配：

- ✅ `GET /api/v1/updates/latest-mac.yml` 端点可用
- ✅ `GET /api/v1/updates/latest.yml` 端点可用
- ✅ `GET /api/v1/updates/{filename}` 文件下载可用（含 Range 请求支持）
- ✅ `POST /api/v1/telemetry/events` 端点可用

---

## 12. Review 检查项

- [ ] 遥测事件类型是否与 Server 的 `valid_event_types` 对齐
- [ ] properties 中是否排除了用户内容、凭据、路径
- [ ] `pickAuto` 的新优先级（server → github → ghproxy → github fallback）是否合理
- [ ] macOS Squirrel.Mac 签名限制（ADR-013）是否需要单独处理
- [ ] 隐私说明文案是否清晰
- [ ] `before-quit` 中的 3s 遥测 flush 超时是否合适
- [ ] Settings UI 区块布局是否与现有风格一致
