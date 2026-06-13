# DESIGN: codex-switch 接入 codex-switch-server 客户端方案（v1.7.0）

- **日期**：2026-06-12
- **状态**：📋 待审查
- **目标版本**：v1.7.0
- **前置版本**：v1.6.0（Claude Desktop 直连 DeepSeek — 已发布）
- **生产地址**：`https://www.codexswtich.cloud`
- **Server 工程**：`/Users/mark/work/gitspace/opensource/codex-switch-server`（v0.1.0，已上线）

---

## 1. 背景与目标

### 1.1 当前状态

```
codex-switch (v1.6.0 — 已发布)
├── 更新检查：electron-updater → GitHub Releases（latest-mac.yml）
│   └── Mirror: auto / github / ghproxy / custom
├── Claude Desktop：直连 api.deepseek.com/anthropic（不走本地代理）
├── 遥测：无
├── 运营数据：无
└── 服务器通信：零
```

### 1.2 目标状态

```
codex-switch (v1.7.0)
├── 更新检查：electron-updater → codex-switch-server（/api/v1/updates/*）
│   └── Mirror: server（默认推荐）/ github / ghproxy / custom
├── 遥测：TelemetryClient → POST /api/v1/telemetry/events
│   └── 事件：app_start, proxy_start, proxy_stop, proxy_error, model_call, ...
├── 运营数据：Server 管理后台可查看下载趋势、版本分布、事件统计
└── 新增模块：electron/server-client/（API 客户端 + 遥测）
```

### 1.3 Server 已实现的 API（✅ 已上线）

| 端点                             | 方法 | 用途                | 实现状态                                          |
| -------------------------------- | ---- | ------------------- | ------------------------------------------------- |
| `/api/v1/updates/latest-mac.yml` | GET  | macOS 更新元数据    | ✅ 5min 内存缓存，直读 GitHub Release             |
| `/api/v1/updates/latest.yml`     | GET  | Windows 更新元数据  | ✅ 同上                                           |
| `/api/v1/updates/{filename}`     | GET  | 下载二进制/blockmap | ✅ COS → nginx X-Accel-Redirect → GitHub 三级回退 |
| `/api/v1/telemetry/events`       | POST | 批量遥测事件        | ✅ 12 种事件白名单 + 去重 + 限流（60/min/client） |
| `/api/v1/packages`               | GET  | 可用工具包列表      | ✅ 已实现（registry.json）                        |
| `/api/v1/analytics/pageview`     | POST | 页面访问追踪        | ✅ 已实现（Portal 埋点，sendBeacon）              |

### 1.4 Server 端实现与需求文档的差异

Server 端基本上按 [SERVER-REQUIREMENTS-for-electron-updater.md](./SERVER-REQUIREMENTS-for-electron-updater.md) 完成开发，但有几处实际实现与需求文档不同：

| 差异点         | 需求文档                   | 实际实现                                                                      | 影响                                        |
| -------------- | -------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------- |
| 更新同步策略   | 推荐定时任务（每 5 分钟）  | 按需懒加载 + 5min 内存缓存                                                    | 首次请求延迟略高，但架构更简单              |
| Range 请求支持 | 明确要求 HTTP 206          | 未显式实现（nginx 对本地静态文件天然支持 Range；COS 302 重定向路径不支持）    | 对 blockmap 差分更新的影响待验证            |
| 数据清理       | 90 天 retention 配置项存在 | 清理逻辑未实现（config 中有 `telemetry_retention_days=90` 但无 cleanup 任务） | 长期运行后 DB 可能膨胀                      |
| 后台同步任务   | 推荐实现                   | 未实现（纯按需模式）                                                          | 不影响功能，但 release 同步依赖首次请求触发 |

> **结论**：Server 端 API 已全部可用，客户端可以开始接入。上述差异不影响客户端开发，但 Range 请求和 retention cleanup 应在 v1.7.0 上线前验证/修复。

### 1.5 开发连调策略（本地 → 生产）

整个 v1.7.0 客户端开发分为三个阶段，确保每个环境都验证通过后再进入下一阶段：

```
┌──────────────┐      ┌───────────────────┐      ┌────────────────────┐
│ 阶段 1       │      │ 阶段 2            │      │ 阶段 3             │
│ 客户端编码    │ ───▶ │ 本地 Server 连调   │ ───▶ │ 生产 Server 连调    │
│              │      │                   │      │                    │
│ 写完代码      │      │ pnpm dev          │      │ Server 发版后       │
│ 编译通过      │      │ ↓                 │      │ ↓                  │
│ 单测全绿      │      │ localhost:8000    │      │ codexswtich.cloud  │
│              │      │ ↓                 │      │ ↓                  │
│              │      │ 全功能验证通过      │      │ 最终确认            │
└──────────────┘      └───────────────────┘      └────────────────────┘
```

#### 阶段 1：客户端编码（本机不依赖 Server）

- 写完 `electron/server-client/` 全部模块
- 写完 `electron/updater/mirrors.ts` 的 `'server'` 模式
- 写完 `electron/config/store.ts` 新增字段 + 迁移
- 写完 `electron/main.ts` IPC 埋点（telemetry.track 调用）
- `pnpm typecheck` + `pnpm test` 全部通过
- 此阶段不要求 Server 在运行（遥测 buffer 静默累积，更新检查回退到 github mirror）

#### 阶段 2：本地 Server 连调

**前提**：本地启动 codex-switch-server：

```bash
# 在 codex-switch-server 目录
source .venv/bin/activate
uvicorn src.main:app --port 8000 --reload
```

**客户端配置**（任选一种）：

| 方式             | 操作                                                                             | 适用场景               |
| ---------------- | -------------------------------------------------------------------------------- | ---------------------- |
| 环境变量（推荐） | `export CODEX_SWITCH_SERVER_URL=http://localhost:8000/api/v1` 然后 `pnpm dev`    | 开发调试，切换方便     |
| Settings UI      | 打开设置 → 数据与隐私 → 服务器地址填 `http://localhost:8000/api/v1`              | 验证 Settings 功能本身 |
| 自动检测         | 不设任何值，开发模式下 `!app.isPackaged` 自动使用 `http://localhost:8000/api/v1` | 开箱即用               |

**验证清单**：

- [ ] 版本检查：手动点击"检查更新"→ 本地 Server 正确返回 `latest-mac.yml`（如果 GitHub 上有新版本则显示可用）
- [ ] 遥测上报：启动代理 → 发几条对话 → 等 30s → 本地 Server 的 telemetry_events 表有新记录
- [ ] 遥测开关：Settings → 关闭遥测 → track() 零开销返回 → 打开后恢复上报
- [ ] 错误降级：停掉本地 Server → 检查更新应自动回退到 github mirror
- [ ] 连接状态：Settings UI 显示 🟢/🔴 连接状态
- [ ] 客户端 ID：首次启动自动生成 clientId，重启后保持不变

**本地 Server 验证 SQL**：

```sql
-- 检查遥测事件是否入库
SELECT event_type, COUNT(*) FROM telemetry_events GROUP BY event_type;

-- 检查下载记录（update feed 拉取）
SELECT * FROM download_records WHERE source = 'electron-updater' ORDER BY downloaded_at DESC LIMIT 5;
```

#### 阶段 3：生产 Server 连调

**前提**：阶段 2 全部通过 → Server 端发版到 `https://www.codexswtich.cloud`

**客户端配置**：

```bash
# 方式 1：切换环境变量指向生产
export CODEX_SWITCH_SERVER_URL=https://www.codexswtich.cloud/api/v1
pnpm dev

# 方式 2：Settings UI 中改回生产地址
```

**验证清单**（与阶段 2 相同，但针对生产环境）：

- [ ] 版本检查正常（latest-mac.yml / latest.yml 返回正确）
- [ ] 遥测上报正常（POST /api/v1/telemetry/events）
- [ ] COS 下载可用（更新文件从广州 COS 302 重定向）
- [ ] 错误降级正常
- [ ] 对存量 v1.6.x 用户：升级后自动迁移到 server mirror + 遥测默认开启

#### Server URL 解析优先级

客户端按以下优先级决定实际使用的 Server URL：

```
优先级 1 (最高): 环境变量 CODEX_SWITCH_SERVER_URL
                export CODEX_SWITCH_SERVER_URL=http://localhost:8000/api/v1
                用途：开发阶段快速切换目标服务器，覆盖一切其他设置

优先级 2:       用户偏好 serverUrl（electron-store 持久化）
                用户在 electron-store 中持久化的自定义地址
                用途：自部署用户配置自己的服务器地址

优先级 3 (最低): 应用默认值
                - 开发模式 (!app.isPackaged) → http://localhost:8000/api/v1
                - 生产模式 (app.isPackaged)   → https://www.codexswtich.cloud/api/v1
                用途：开箱即用，零配置
```

**设计要点**：

- 环境变量 **只在开发调试时使用**，打包后的生产版本不应设此变量
- 用户在 Settings UI 中修改 serverUrl 后，立即重建 `ServerClient` 实例（清空旧的遥测 buffer）
- `electron/server-client/config.ts` 中的 `resolveServerUrl()` 函数封装上述三级优先级逻辑

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
│               v0.1.0 — 已上线                                │
│                                                              │
│  /api/v1/updates/*        ← electron-updater feed           │
│  /api/v1/telemetry/events ← 遥测上报                         │
│  /api/v1/packages         ← 工具包列表（已实现）               │
│  /api/v1/files/*          ← 静态文件下载（已实现）             │
│  /api/v1/analytics/*      ← Portal 分析（已实现）             │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. 模块设计

### 3.1 `electron/server-client/config.ts` — 服务器配置（新建）

**职责**：管理服务器基础 URL，实现三级优先级解析，提供 clientId 管理。

```typescript
// 伪代码接口

/** 生产环境默认服务器地址 */
export const PROD_SERVER_URL = 'https://www.codexswtich.cloud/api/v1';

/** 本地开发默认服务器地址 */
export const DEV_SERVER_URL = 'http://localhost:8000/api/v1';

/**
 * 解析实际使用的 Server URL，按优先级：
 *   1. 环境变量 CODEX_SWITCH_SERVER_URL（显式覆盖）
 *   2. 用户偏好 prefs.serverUrl（Settings 中配置，持久化）
 *   3. 应用默认值（!app.isPackaged → DEV_SERVER_URL, 否则 → PROD_SERVER_URL）
 *
 * 所有返回值尾部的 '/' 已去除。
 */
export function resolveServerUrl(prefs?: { serverUrl?: string }): string;

export interface ServerConfig {
  baseUrl: string;
  telemetryEnabled: boolean;
  clientId: string;
}

/** 从 UserPreferences 构建 ServerConfig（合并三级优先级） */
export function getServerConfig(prefs: UserPreferences): ServerConfig;

/** 拼接 baseUrl + path 为完整 URL */
export function buildUrl(baseUrl: string, path: string): string;

/** 生成新的 clientId（16 位 hex），仅在首次启动时调用 */
export function generateClientId(): string;
```

**关键决策**：

| 决策                  | 说明                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `clientId` 生成       | `randomBytes(8).toString('hex')`，首次写入 `electron-store`，后续不变                    |
| `baseUrl` 默认值      | 开发模式 `http://localhost:8000/api/v1`，生产模式 `https://www.codexswtich.cloud/api/v1` |
| 环境变量最高优先级    | `CODEX_SWITCH_SERVER_URL` 覆盖一切，仅在开发调试时使用                                   |
| 用户修改 ServerUrl 时 | 重建 `ServerClient` 实例 + 清空旧的遥测 buffer（旧事件不发给新 server）                  |
| 去除尾部斜杠          | `resolveServerUrl()` 始终返回无尾部 `/` 的 URL，`buildUrl()` 负责拼接                    |

**环境变量使用示例**：

```bash
# 开发阶段：连本地 Server
export CODEX_SWITCH_SERVER_URL=http://localhost:8000/api/v1
pnpm dev

# 连调阶段：连生产 Server（本地还在开发模式）
export CODEX_SWITCH_SERVER_URL=https://www.codexswtich.cloud/api/v1
pnpm dev

# 打包后的生产版本不设此变量，自动使用 PROD_SERVER_URL
```

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

> ⚠️ **设计原则**：遥测是**次要功能**。代理核心功能（协议转发、Codex 配置、Claude 工具）的优先级远高于遥测。遥测相关的任何故障（网络断开、Server 不可达、超时）都静默处理，**绝不**阻塞或影响代理的正常运行。

#### 3.3.1 事件类型（与 Server `VALID_EVENT_TYPES` 完全对齐）

Server 端白名单定义在 `src/schemas/telemetry.py`：

```python
VALID_EVENT_TYPES = frozenset({
    "app_start",
    "app_close",
    "proxy_start",
    "proxy_stop",
    "proxy_error",
    "model_call",
    "config_write",
    "tool_install",
    "tool_install_fail",
    "update_check",
    "update_download",
    "error",
})
```

各事件含义：

```
app_start          ← 应用启动完成（app.whenReady）
app_close          ← 应用退出（before-quit）
proxy_start        ← 代理启动成功
proxy_stop         ← 代理停止
proxy_error        ← 代理运行期错误（含 error_kind: port-conflict | runtime | auto-recover-failed）
model_call         ← 每次 /v1/responses 调用完成（不含消息内容）
config_write       ← 用户保存 Settings
tool_install       ← 工具安装成功
tool_install_fail  ← 工具安装失败
update_check       ← 自动/手动版本检查
update_download    ← 用户触发下载更新
error              ← 全局未捕获异常
```

#### 3.3.2 数据结构（与 Server `TelemetryPayload` 对齐）

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

> ⚠️ Server 端 `TelemetryPayload.events` 有 `max_length=100` 限制，客户端单次 flush 最多发 20 条，不会触及此限制。

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
  private online: boolean;
  private consecutiveFailures: number;
  private backoffUntil: number;

  constructor(client: ServerClient, config: ServerConfig);

  /** 记录一个事件（立即入 buffer，不阻塞） */
  track(eventType: string, properties?: Record<string, unknown>): void;

  /** 启动定时上报（每 30s 或 buffer 满 20 条立即 flush） */
  start(): void;

  /** 停止定时器 + 立即 flush 剩余事件（app.on('before-quit') 调用） */
  async stop(): Promise<void>;

  /** 启用/禁用遥测（用户在 Settings 切换时调用） */
  setEnabled(v: boolean): void;

  /** 当前是否在线（可按需查询供 Settings UI 显示） */
  isOnline(): boolean;

  private async flush(): Promise<void>;

  /** 探测网络连通性：向 Server 发 HEAD 请求，3s 超时 */
  private async checkConnectivity(): Promise<boolean>;
}
```

**关键行为**：

- `track()` 是同步的，不阻塞调用方。事件入内存 buffer 即返回
- **两重门禁**：`track()` 内部先检查 `enabled`，再检查 `online`。任一个为 false 都直接 return，不产生任何副作用
- `flush()` 是异步的：
  - **前置网络检查**：调用 `checkConnectivity()` 向 Server 发 HEAD 请求（3s 超时）
    - 不通 → 标记 `online = false`，跳过本次 flush，保留所有事件在 buffer
    - 通了 → 标记 `online = true`，继续
  - 从 buffer 取出最多 20 条事件（保留剩余的）
  - 构造 `TelemetryPayload`，POST 到 `/api/v1/telemetry/events`
  - 成功 → 从 buffer 移除已发送事件，重置 `consecutiveFailures = 0`
  - 失败 → 保留在 buffer，`consecutiveFailures += 1`
  - 网络错误静默处理（不弹 toast，不阻塞代理主流程）
- **离线退避**：连续失败达 3 次后，进入退避模式（backoff），下次 flush 延迟到 5 分钟后；之后每次失败翻倍（5min → 10min → 20min，上限 1 小时）。一次成功后恢复 30s 正常间隔
- buffer 最大 200 条，超出丢弃最旧事件
- `stop()` 在 `app.on('before-quit')` 中调用，**仅当 online 时才尝试 flush**，3s 超时兜底

**Server 端行为须知**（来自实际实现）：

- 事件类型不在白名单中 → `rejected`（客户端需确保不发送非法类型）
- 同一 `(client_id, event_type, timestamp)` 重复 POST → `rejected`（服务端去重）
- 单 client 超过 60 条/min → `rejected`（服务端限流）
- 返回 `{ accepted: N, rejected: M }` — 客户端不需要解析此响应，仅用于服务端统计

#### 3.3.5 网络离线处理（核心设计）

**设计原则**：遥测是**次要功能**——代理核心功能（协议转发、配置写入）的优先级远高于数据上报。断网时，代理必须正常工作；遥测静默等待，不产生任何用户可见的错误。

```
                    ┌──────────────┐
                    │  flush() 触发 │
                    │ (定时器/buffer满)│
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ telemetry    │─── disabled ──→ 直接返回，什么都不做
                    │ enabled?     │
                    └──────┬───────┘
                           │ enabled
                    ┌──────▼───────┐
                    │ HEAD ping    │─── 3s 超时/不通 ──→ online=false
                    │ Server       │                    保留 buffer
                    │ 可达?        │                    进入退避倒计时
                    └──────┬───────┘
                           │ 可达
                    ┌──────▼───────┐
                    │ POST events  │─── 网络错误 ──→ online=false
                    │               │                 consecutiveFailures++
                    │               │                 退避延迟
                    └──────┬───────┘
                           │ 成功
                    ┌──────▼───────┐
                    │ 移除已发送事件 │
                    │ online=true  │
                    │ failures=0   │
                    │ 恢复 30s 间隔 │
                    └──────────────┘
```

**离线检测方式**：

| 方式                  | 说明                                                   | 采用      |
| --------------------- | ------------------------------------------------------ | --------- |
| 主动探测（HEAD 请求） | 每次 flush 前向 Server 发 HEAD 请求，3s 超时           | ✅ 采用   |
| `navigator.onLine`    | 浏览器 API，仅判断网卡是否启用，不判断互联网是否真的通 | ❌ 不可靠 |
| Node `dns.lookup`     | DNS 解析成功 ≠ 服务器可达                              | ❌ 不够   |
| 被动检测（POST 失败） | flush POST 失败时标记 offline                          | ✅ 兜底   |

**退避策略**：

```
正常: 每 30s flush 一次
↓ 连续 3 次失败
退避 1: 每 5min 一次
↓ 再失败
退避 2: 每 10min 一次
↓ 再失败
退避 3: 每 20min 一次（上限 60min）
↓ 任意一次成功
恢复正常: 每 30s 一次
```

**边界情况**：

| 场景                        | 行为                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 应用启动时网络已断开        | `start()` 正常启动定时器，首次 flush 时检测到离线，静默进入退避。不影响代理启动                                  |
| 运行中突然断网（WiFi 断开） | `track()` 照常入 buffer（同步，零开销）。下次 flush 时 HEAD 不通 → 标记 offline → 退避。代理核心功能不受任何影响 |
| 断网期间 buffer 满 200 条   | 最旧事件被丢弃。遥测数据允许丢失，proxy 功能零影响                                                               |
| 网络恢复                    | 下一次退避间隔到期时 HEAD 通了 → `online = true` → flush 成功 → 恢复 30s 正常间隔                                |
| `before-quit` 时处于离线    | `stop()` 检查 `online` 状态 → 离线则直接跳过 flush（不卡退出），buffer 中事件随进程终止丢失                      |
| 用户关闭"体验优化计划"开关  | `setEnabled(false)` → 清空 buffer → 清除定时器 → 后续 `track()` 零开销直接返回                                   |
| 用户重新打开开关            | `setEnabled(true)` → 重新 `start()` 定时器                                                                       |

#### 3.3.6 埋点位置

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
  // config.serverUrl 是 https://www.codexswtich.cloud/api/v1
  // feed URL = serverUrl + '/updates'
  return `${serverUrl}/updates`;
```

`pickAuto()` 调整：首选 `server` 模式（如果 ping 通），回退 `github`：

```typescript
// 旧: probe github → probe ghproxy → fallback github
// 新: probe server → probe github → probe ghproxy → fallback github
```

> **实现细节**：Server 端 `GET /api/v1/updates/latest-mac.yml` 通过 5 分钟内存缓存直读 GitHub Release 资产，不经过数据库。首次请求可能延迟 ~1–2s（调 GitHub API），后续请求 < 1ms。

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

  /** v1.7.0: 服务器基础 URL */
  serverUrl: string; // 默认 'https://www.codexswtich.cloud/api/v1'
  /** v1.7.0: 遥测开关 */
  telemetryEnabled: boolean; // 默认 true
  /** v1.7.0: 客户端唯一标识（首次启动自动生成） */
  clientId: string; // 默认 ''
  /** 更新镜像模式 */
  updateMirror: 'server' | 'auto' | 'github' | 'ghproxy' | 'custom'; // 默认改为 'server'
}
```

**迁移逻辑**（`migrateIfNeeded`）：

- v1.6.x → v1.7.0：`clientId` 留空 → 首次加载时自动生成；`updateMirror` 从 `'auto'` 改为 `'server'`；`telemetryEnabled` 设 `true`（默认开启，用户在 Settings 底部可关闭）；`serverUrl` 设默认值

### 3.6 Settings UI 变更（修改）

#### 3.6.1 更新区块

| 变更                 | 说明                                 |
| -------------------- | ------------------------------------ |
| 下载镜像下拉新增选项 | "官方服务器（推荐）" — 排在第一位    |
| 自定义 URL 输入框    | 仅 `custom` 模式显示（现有逻辑不变） |
| "自动"模式的探测顺序 | 内部改为 server 优先                 |

#### 3.6.2 新增「体验优化计划」勾选框

在 Settings 页面底部（"关于"区块的上方或下方），新增一个不起眼的勾选框：

```
┌─────────────────────────────────────────────┐
│  ☑ 参与体验优化计划                          │
│    匿名上报使用数据，帮助我们改进产品。        │
│    不会发送对话内容、API Key 或个人信息。      │
│    仅在有网络连接时上传。                     │
└─────────────────────────────────────────────┘
```

- 默认勾选（`telemetryEnabled = true`）
- 取消勾选 → 零网络请求，`track()` 直接返回
- 不在此区块显示服务器地址、客户端标识、网络状态等额外信息

---

## 4. 首次启动体验

### 4.1 Setup 向导变更

无变更。`telemetryEnabled` 默认 `true`，不在 Setup 向导中展示——用户无需在首次启动时做任何选择。如需关闭，可在 Settings 底部取消勾选"参与体验优化计划"。

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
TelemetryClient.track()
  ├─ enabled == false?     → 直接返回（零开销）
  ├─ online == false?      → 直接返回（离线，不入 buffer 避免内存浪费）
  └─ buffer.push(event)
     ├─ buffer.length >= 20 → 立即 flush()
     └─ 否则 → 等待定时器

定时器触发 flush()（正常 30s / 退避 5min-1h）
  ├─ enabled == false?     → 直接返回
  ├─ HEAD ping Server      → 3s 超时 / 不通
  │   └─ online = false, 进入退避, 保留 buffer
  ├─ POST /telemetry/events
  │   ├─ 网络错误 → online = false, consecutiveFailures++, 进入退避
  │   ├─ HTTP 4xx → 丢弃这批事件（不重试无效数据）
  │   └─ HTTP 5xx → 保留事件，consecutiveFailures++
  └─ 成功
     ├─ 从 buffer 移除已发送事件
     ├─ online = true, consecutiveFailures = 0
     └─ 恢复 30s 正常间隔
```

**核心约束**：遥测上报的每一步都不能阻塞代理主流程。`track()` 同步返回（< 1μs），`flush()` 在后台异步执行，网络错误静默不 toast。

### 5.4 更新检查流程（Server 模式）

```
客户端                                               Server
  │                                                    │
  │  (每 4h 或用户手动触发)                              │
  │  GET /api/v1/updates/latest-mac.yml                │
  │ ─────────────────────────────────────────────────► │
  │                                                    │ → GitHub Releases API（5min 缓存）
  │  ◄──  latest-mac.yml (version, files, sha512)      │
  │                                                    │
  │  解析 yml → 版本比对                                 │
  │  如果有新版本：                                       │
  │    macOS → shell.openExternal(release page)         │
  │    Windows → electron-updater 自动下载安装           │
  │                                                    │
  │  GET /api/v1/updates/Codex-Switch-1.7.0-win-x64.exe│
  │ ─────────────────────────────────────────────────► │
  │                                                    │ → COS (302) → nginx → GitHub
  │  ◄──  binary file                                  │
  │                                                    │
  │  验证 sha512 → 安装                                  │
```

---

## 6. 错误处理与降级

### 6.1 核心原则

> **遥测是次要功能。** 代理核心功能（HTTP/WS 协议转发、Codex 配置写入、Claude 工具管理）的优先级远高于数据上报。遥测相关的任何故障（网络断开、Server 不可达、超时）都不能阻塞或影响代理的正常运行。

### 6.2 降级矩阵

| 场景                               | 行为                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 用户未勾选"体验优化计划"           | `track()` 零开销直接返回；不启动定时器；不发任何网络请求。代理功能完全不受影响                                   |
| 网络断开（离线）                   | `checkConnectivity()` HEAD 请求 3s 超时 → 标记 `online = false` → 跳过 upload → 退避倒计时。代理功能完全不受影响 |
| 网络断开期间 buffer 满             | 最旧事件被静默丢弃。不影响代理                                                                                   |
| 网络恢复                           | 下一次退避间隔到期后 HEAD 通了 → `online = true` → flush 成功 → 恢复正常间隔                                     |
| Server 不可达（DNS/网络）          | telemetry 标记离线 + 退避；updater 回退到 github mirror                                                          |
| Server 返回 5xx                    | telemetry 保留事件 + consecutiveFailures++ + 退避；updater 回退                                                  |
| Server 返回 4xx                    | telemetry 丢弃这批事件（不重试，避免重复上报无效数据）                                                           |
| 应用启动时已离线                   | `track('app_start')` 照常触发但 `online=false` 时不入 buffer；定时器正常启动，等网络恢复后上报                   |
| flush 过程中 app 退出              | `before-quit` 中 `stop()` 检查 `online` → 离线则直接跳过；在线则尝试 flush（3s 超时兜底）                        |
| telemetryEnabled = false           | `track()` 直接返回，不分配任何资源                                                                               |
| 用户切换 serverUrl                 | 重建 ServerClient + 清空遥测 buffer（旧 server 事件不发给新 server）                                             |
| Server telemetry 返回 rejected > 0 | 静默处理，客户端不重试（Server 已做去重/限流，rejected 是正常行为）                                              |
| 退避期间手动检查更新               | 不影响——updater 和 telemetry 是独立模块，各自独立决策                                                            |

---

## 7. 涉及变更的文件

### 7.1 新建

| 文件                                  | 职责                                   | 预估行数 |
| ------------------------------------- | -------------------------------------- | -------- |
| `electron/server-client/config.ts`    | Server URL 配置、clientId 管理         | ~50      |
| `electron/server-client/client.ts`    | HTTP 客户端封装（POST/GET/ping）       | ~80      |
| `electron/server-client/telemetry.ts` | TelemetryClient：buffer、flush、定时器 | ~150     |
| `tests/unit/server-client.test.ts`    | ServerClient 单元测试                  | ~60      |
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
| `package.json`                | 1.6.0 → 1.7.0                                                                                                                              |
| `CHANGELOG.md`                | v1.7.0 条目                                                                                                                                |

---

## 8. 安全性

| 原则           | 措施                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------ |
| 不泄露用户内容 | `model_call` 只上报 model、tokens、success，**不上报 message content**                           |
| 不泄露凭据     | 所有遥测事件明确排除 API Key、auth.json 内容                                                     |
| 不泄露路径     | `error` 事件只上报 `error_type`（类名），不上报 `error.message`（可能含路径）                    |
| 不泄露 IP      | Server 端只存 `ip_hash`（SHA-256），客户端无需额外处理                                           |
| 用户可控       | Settings 中可随时关闭遥测；关闭后 track() 零开销返回                                             |
| 服务端验证     | Server 对 event_type 做白名单校验 + (client_id, event_type, timestamp) 去重 + 60/min/client 限流 |

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

`tests/unit/server-client.test.ts`：

| 用例                               | 覆盖       |
| ---------------------------------- | ---------- |
| `buildUrl appends path to baseUrl` | URL 拼接   |
| `get() sends GET request`          | GET 请求   |
| `post() sends POST with JSON body` | POST 请求  |
| `ping() returns true on 2xx`       | 连通性检查 |
| `ping() returns false on error`    | 连通性失败 |

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
# 7. 更新镜像选择"官方服务器"→ 手动检查更新 → 应正常返回版本信息
```

### 9.3 Server 端验证（上线前）

- [ ] `GET /api/v1/updates/latest-mac.yml` 返回正确 yml（包含最新版本的所有文件条目）
- [ ] `GET /api/v1/updates/latest.yml` 返回正确 yml
- [ ] `GET /api/v1/updates/{filename}` 能下载 zip/dmg/exe/blockmap（验证 Range 请求支持）
- [ ] `POST /api/v1/telemetry/events` 正常接收并返回 `{accepted, rejected}`
- [ ] Server telemetry retention cleanup 是否已实现（当前缺失，需决定是否 v1.7.0 上线前补）

---

## 10. 版本规划

```
v1.6.0（已发布 — 2026-06-11）
  └─ Claude Desktop 直连 DeepSeek（取消代理转发）

v1.7.0（本方案）
  ├─ 更新检查接入 Server（新增 'server' mirror 模式，默认首选）
  ├─ 遥测客户端（TelemetryClient）
  ├─ Settings 新增「数据与隐私」区块
  ├─ Setup 向导新增遥测 opt-out
  └─ 新增 electron/server-client/ 模块

v1.8.0（未来）
  ├─ Dashboard 展示 tool packages（GET /api/v1/packages）
  ├─ 帮助页接入远程 FAQ / onboarding
  └─ Server 连接状态可视化（Dashboard 小绿点）

v1.9.0（未来）
  └─ macOS 签名后恢复 Squirrel.Mac 原子自动更新（移除 shell.openExternal 回退）
```

---

## 11. 前提条件

### 11.1 Server 端（✅ 已完成）

Server 端已按 [SERVER-REQUIREMENTS-for-electron-updater.md](./SERVER-REQUIREMENTS-for-electron-updater.md) 完成开发并上线：

- ✅ `GET /api/v1/updates/latest-mac.yml` — 5min 内存缓存，直读 GitHub Release
- ✅ `GET /api/v1/updates/latest.yml` — 同上
- ✅ `GET /api/v1/updates/{filename}` — COS → nginx X-Accel-Redirect → GitHub 三级回退
- ✅ `POST /api/v1/telemetry/events` — 12 种事件白名单 + 去重 + 60/min/client 限流
- ✅ `GET /api/v1/packages` — 工具包列表（registry.json）

### 11.2 上线前需确认的 Server 端事项

| 事项                        | 优先级 | 说明                                                                                                       |
| --------------------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| Range 请求验证              | P0     | 确认 nginx 对 `/_cache/` 路径的静态文件支持 HTTP 206 Range 请求（blockmap 差分更新依赖）                   |
| telemetry retention cleanup | P1     | config 中 `telemetry_retention_days=90` 已定义但清理逻辑未实现，决定是否 v1.7.0 前补齐                     |
| COS 同步最新 release 文件   | P1     | 确保 v1.7.0 发布后 `scripts/upload-codex-switch-to-cos.sh` 已执行，COS 中有最新版本的 zip/dmg/exe/blockmap |

---

## 12. Review 检查项

- [ ] 遥测事件类型是否与 Server `VALID_EVENT_TYPES` 完全对齐（12 种）
- [ ] properties 中是否排除了用户内容、凭据、路径
- [ ] `pickAuto` 的新优先级（server → github → ghproxy → github fallback）是否合理
- [ ] macOS Squirrel.Mac 签名限制（ADR-013）是否需要单独处理（结论：不变，仍走浏览器手动下载）
- [ ] 隐私说明文案是否清晰，"体验优化计划"措辞是否用户友好
- [ ] "体验优化计划"默认勾选，用户取消后是否真正零网络请求
- [ ] 网络离线检测（HEAD ping + 退避策略）是否合理
- [ ] 离线状态下 track() 是否真正零开销
- [ ] 网络恢复后是否能自动恢复正常上报
- [ ] 退避策略参数（3 次失败触发 / 5min-1h / 上限 1h）是否合适
- [ ] `before-quit` 离线状态是否直接跳过 flush（不卡退出）
- [ ] `before-quit` 中的 3s 遥测 flush 超时是否合适
- [ ] Settings UI 区块布局是否与现有风格一致，"体验优化计划"勾选框是否放在不起眼的位置
- [ ] Server 端 `latest-mac.yml` / `latest.yml` 内容是否与 electron-builder 输出完全一致（sha512 未改动）
- [ ] Server 端 Range 请求是否正常工作（blockmap 差分更新关键依赖）
- [ ] v1.6.x → v1.7.0 迁移逻辑是否覆盖 `clientId` 生成、`updateMirror` 切换、`telemetryEnabled` 初始化
- [ ] 新增文件是否遵守单文件 ≤ 400 行约束
