# codex-switch-server 适配 electron-updater 需求文档

- **日期**：2026-06-11
- **面向**：Server 端开发者
- **目的**：让 codex-switch-server 同时兼容 electron-updater 的 generic provider 协议，使客户端可通过服务器做版本检查和增量更新。

---

## 1. 背景

codex-switch 客户端使用 `electron-updater` v6.8.3，provider 为 `generic`。当前客户端直接拉取 GitHub Releases 的 `latest-mac.yml` / `latest.yml`。

接入 codex-switch-server 后，客户端将 feed URL 指向服务器，服务器需要像 GitHub Releases 一样，提供 electron-updater 所需的静态文件。

## 2. electron-updater generic provider 协议

### 2.1 工作原理

```
客户端                                Server
  │                                     │
  │  GET <feedUrl>/latest-mac.yml       │
  │ ──────────────────────────────────► │  返回 yml 元数据（版本号、文件列表、sha512）
  │                                     │
  │  解析 yml → 版本比对                 │
  │  有新版本 → 按 yml 中 files 列表下载  │
  │                                     │
  │  GET <feedUrl>/Codex-Switch-1.5.0-mac-arm64.zip       │
  │ ──────────────────────────────────► │  返回二进制文件
  │                                     │
  │  GET <feedUrl>/Codex-Switch-1.5.0-mac-arm64.zip.blockmap  │  (可选，差分更新)
  │ ──────────────────────────────────► │
  │                                     │
  │  验证 sha512 → 安装                  │
```

### 2.2 需要的文件

electron-builder 在构建时自动生成以下文件，全部在 GitHub Release 资产中：

**macOS 文件：**

```
latest-mac.yml                              ← 核心：元数据
Codex-Switch-<ver>-mac-arm64.zip           ← zip（Squirrel.Mac 原子升级必需）
Codex-Switch-<ver>-mac-arm64.zip.blockmap  ← 差分块映射
Codex-Switch-<ver>-mac-arm64.dmg           ← dmg（首次安装/手动）
Codex-Switch-<ver>-mac-arm64.dmg.blockmap
Codex-Switch-<ver>-mac-x64.zip
Codex-Switch-<ver>-mac-x64.zip.blockmap
Codex-Switch-<ver>-mac-x64.dmg
Codex-Switch-<ver>-mac-x64.dmg.blockmap
builder-debug.yml                          ← 可选，调试用
```

**Windows 文件：**

```
latest.yml                                 ← 核心：元数据
Codex-Switch-Setup-<ver>-win-x64.exe      ← x64 安装包
Codex-Switch-Setup-<ver>-win-x64.exe.blockmap
Codex-Switch-Setup-<ver>-win-arm64.exe    ← arm64 安装包
Codex-Switch-Setup-<ver>-win-arm64.exe.blockmap
builder-debug.yml
```

### 2.3 latest-mac.yml 格式

```yaml
version: 1.5.0
files:
  - url: Codex-Switch-1.5.0-mac-arm64.zip
    sha512: CROYGYovt1Y58+V/eWcRD662Tov1OX6bhnOPxO7o04cHVC3OUAe0d+pWYiP/FBUkjCpGTEXQuDTQde8lwbByGg==
    size: 92721818
  - url: Codex-Switch-1.5.0-mac-x64.zip
    sha512: J1Ce/i1QoXwsWG5MCX1fGCm8aif5GdRv5iKBrzXrECUH1yTU345dddZK2mhgBO50538sNvyxPzOw4mNom8o06Q==
    size: 98302233
  - url: Codex-Switch-1.5.0-mac-arm64.dmg
    sha512: 7dN6ksy8mc9cQiUy8W616R/jF5KFxARUtaY/4WNq67it+Yq0lCXVoHyP9VlRgTzEeZqkd58osl6Q7/nMZnSZmw==
    size: 96120413
  - url: Codex-Switch-1.5.0-mac-x64.dmg
    sha512: F+iapopwEXSjCPtm1LCKAzUpuODFysWpb7yKxtzRawdvrJvxBClOyhzC1utWC7gxzl8LgLinFUw0DEwhTzeRHQ==
    size: 101668842
path: Codex-Switch-1.5.0-mac-arm64.zip       ← 主安装文件（Squirrel.Mac 优先取 zip）
sha512: CROYGYovt1Y58+V/eWcRD662Tov1OX6bhnOPxO7o04cHVC3OUAe0d+pWYiP/FBUkjCpGTEXQuDTQde8lwbByGg==
releaseDate: '2026-06-11T01:24:49.702Z'
```

**字段说明：**

| 字段             | 说明                                                           |
| ---------------- | -------------------------------------------------------------- |
| `version`        | 版本号字符串，与 `package.json` 一致                           |
| `files[].url`    | **相对路径**，文件名即可。electron-updater 会拼到 feedUrl 后面 |
| `files[].sha512` | Base64 编码的 SHA-512 哈希                                     |
| `files[].size`   | 文件字节数                                                     |
| `path`           | 主安装文件路径（macOS 填 arm64 zip）                           |
| `sha512`         | 主安装文件的 sha512                                            |
| `releaseDate`    | ISO 8601 格式的发布日期                                        |

### 2.4 latest.yml 格式（Windows）

格式同 `latest-mac.yml`，但 `files` 列表中为 `.exe` 文件，`path` 指向主 `.exe`：

```yaml
version: 1.5.0
files:
  - url: Codex-Switch-Setup-1.5.0-win-x64.exe
    sha512: ...
    size: ...
  - url: Codex-Switch-Setup-1.5.0-win-arm64.exe
    sha512: ...
    size: ...
path: Codex-Switch-Setup-1.5.0-win-x64.exe
sha512: ...
releaseDate: '...'
```

---

## 3. Server 端需要的改动

### 3.1 总体方案

Server 新增一个路由前缀（例如 `/api/v1/updates`），作为 electron-updater 的 `generic` feed URL。

Server 从 GitHub Releases 同步版本元数据和二进制文件，然后以 electron-updater 兼容的格式重新提供。

### 3.2 具体端点

> 以下所有路径相对于 feed 根 URL，客户端会配置 `feedUrl = https://www.codexswtich.cloud/api/v1/updates`

#### 3.2.1 `GET /api/v1/updates/latest-mac.yml`

返回当前最新 macOS 版本的 `latest-mac.yml` 内容。

**实现方式：**

- Server 维护一个 `latest-mac.yml` 模板（内容与 electron-builder 生成的完全一致）
- 版本号、sha512、size、releaseDate 等动态字段从数据库或 GitHub API 获取后填入
- 返回 `Content-Type: text/yaml; charset=utf-8`

#### 3.2.2 `GET /api/v1/updates/latest.yml`

同上，返回 Windows 的 `latest.yml`。

#### 3.2.3 `GET /api/v1/updates/{filename}`

下载实际的二进制文件。例如：

- `GET /api/v1/updates/Codex-Switch-1.5.0-mac-arm64.zip`
- `GET /api/v1/updates/Codex-Switch-1.5.0-mac-arm64.dmg`
- `GET /api/v1/updates/Codex-Switch-1.5.0-mac-arm64.zip.blockmap`
- `GET /api/v1/updates/Codex-Switch-Setup-1.5.0-win-x64.exe`

**实现方式：**

- 复用现有的 COS → 本地缓存 → GitHub 回退三级下载逻辑
- 即把 `/api/v1/updates/{filename}` 内部重定向到 `/api/v1/update/download/{version}/{platform}-{arch}` 的逻辑
- 或者直接复用 `/api/v1/files/{filename}` 的文件服务能力

**关键约束：**

- 必须支持 HTTP 206 Partial Content（Range 请求），electron-updater 的差分更新依赖 Range 请求
- 必须返回正确的 `Content-Length` 和 `Content-Type`
- `.blockmap` 的 Content-Type 可以是 `application/octet-stream`

### 3.3 数据同步

Server 需要从 GitHub Releases 获取以下数据并存入数据库/缓存：

| 数据                  | 来源                                               | 存储                         |
| --------------------- | -------------------------------------------------- | ---------------------------- |
| 最新版本号            | GitHub Releases API（已有 `release_sync.py`）      | `releases` 表                |
| `latest-mac.yml` 内容 | 从 GitHub Release 资产中下载 `latest-mac.yml` 文件 | 缓存或从 releases 表动态生成 |
| `latest.yml` 内容     | 从 GitHub Release 资产中下载 `latest.yml` 文件     | 同上                         |
| 二进制文件            | 从 GitHub Release 资产下载 → 上传 COS → 本地缓存   | COS + 本地 data/             |
| `.blockmap` 文件      | 同上                                               | 同上                         |

**同步策略：**

- 方式 A（推荐）：定时任务（如每 5 分钟）调 GitHub API，检测是否有新 release。有则下载 `latest-mac.yml`、`latest.yml`，解析其中的文件列表，逐个下载二进制到 COS，更新数据库。
- 方式 B：按需懒加载——首次请求时从 GitHub 拉取并缓存。优点是简单，缺点是首次请求延迟较高。

### 3.4 yml 内容生成

有两种方式生成 yml 内容：

**方式 A：直接提供 GitHub Release 中的原文件。**

- 优点：最可靠，与 electron-builder 输出 100% 一致，sha512 不用自己算
- 做法：同步任务下载 `latest-mac.yml` / `latest.yml` 存到本地，直接返回
- 缺点：需要存储/缓存 yml 文件

**方式 B：从数据库动态生成 yml。**

- 优点：不需要额外存储 yml 文件
- 做法：从 `releases` 表的 `files` JSON 字段读取文件信息，按 yml 模板拼接
- 缺点：sha512 需要自己存；yml 格式细节容易出错

**推荐方式 A**，最简单可靠。

### 3.5 与现有 update 端点的关系

现有的 `POST /api/v1/update/check` 端点**保留不变**（用于 Web 下载页的版本查询）。

新的 `/api/v1/updates/*` 路径是**独立的路由组**，专门服务于 electron-updater 客户端。

```
现有：
  POST /api/v1/update/check          ← Web 下载页 + 未来可能的手动检查
  GET  /api/v1/update/latest         ← Web 下载页
  GET  /api/v1/update/download/...   ← 下载页 + 客户端下载

新增：
  GET  /api/v1/updates/latest-mac.yml          ← electron-updater macOS
  GET  /api/v1/updates/latest.yml              ← electron-updater Windows
  GET  /api/v1/updates/{filename}              ← yml 中引用的所有文件
```

---

## 4. 客户端需要的改动（仅配置层面）

Server 适配完成后，客户端只需将 `feedUrl` 从 GitHub Releases 改为 Server：

**当前（`mirrors.ts`）：**

```typescript
feedUrl = `https://github.com/Mark7766/codex-switch/releases/latest/download`;
```

**改为（新增 'server' mirror 模式）：**

```typescript
feedUrl = `https://www.codexswtich.cloud/api/v1/updates`;
```

客户端改动极小：在 `mirrors.ts` 的 `MirrorMode` 中增加一个 `'server'` 选项，Settings UI 的镜像下拉菜单增加"官方服务器（推荐）"选项即可。

---

## 5. 需要确认的问题

1. **GitHub Release 中的 `latest-mac.yml` 是否已经在资产列表中？**
   - 是的，electron-builder 配置了 `writeUpdateInfo: true`，每次构建自动上传到 Release。

2. **macOS 的 Squirrel.Mac 自动更新是否恢复？**
   - 非签名 macOS 下，Squirrel.Mac 校验签名的硬性限制仍然存在（ADR-013）。
   - 建议：Windows 客户端通过 server 走完整的 electron-updater 自动更新；macOS 客户端走 server 获取更新通知，但仍跳浏览器手动下载。
   - 这个逻辑在客户端侧实现，server 不需要区分。

3. **现有的 download_records 统计是否需要区分来源？**
   - 客户端下载请求来源于 `/api/v1/updates/{filename}`，server 端可以在记录 download 时标记 `source = 'electron-updater'`。

---

## 6. 实现优先级

| 优先级 | 事项                                           | 依赖                                  |
| ------ | ---------------------------------------------- | ------------------------------------- |
| P0     | 新增 `GET /api/v1/updates/latest-mac.yml` 端点 | 从 GitHub Release 同步 latest-mac.yml |
| P0     | 新增 `GET /api/v1/updates/latest.yml` 端点     | 从 GitHub Release 同步 latest.yml     |
| P0     | `GET /api/v1/updates/{filename}` 文件下载端点  | 复用 COS/本地/GitHub 三级下载         |
| P1     | 定时同步任务（GitHub Release → COS + 缓存）    | 已有的 release_sync.py                |
| P1     | download_records 增加 source 字段              | —                                     |
| P2     | yml 内容缓存（避免每次请求都读文件/调 API）    | —                                     |
