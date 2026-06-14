# Design: Codex 离线插件一键安装 — 客户端方案

- **日期**：2026-06-14
- **状态**：方案设计，待 Review
- **版本**：v1.10.0
- **关联**：[Server 端接口设计](https://github.com/Mark7766/codex-switch-server/blob/main/docs/superpowers/specs/2026-06-14-codex-offline-plugins.md)

---

## 1. 背景与目标

### 1.1 用户痛点

Codex Desktop 的插件市场强依赖 GitHub / npm 等境外资源，国内用户安装插件时：

- 下载速度极慢或直接失败
- 不懂命令行，不知道如何手动安装
- 不知道有哪些插件、哪些好用

> 这是 Codex Switch 目标用户（不懂命令行的小白）的 **Top 1 痛点**——装完 Codex 后，插件装不上，AI 能力大打折扣。

### 1.2 解决方案概述

codex-switch-server 提供精选的 **173 个离线插件打包**（`codex-offline-pack.tar.gz`，36MB），托管于国内 COS 广州节点，下载速度 ~2 MB/s，15–20 秒完成。

Codex Switch 客户端新增"插件安装"功能：

1. 调用 Server API 获取插件包信息
2. 国内高速下载离线包到本地
3. **不直接操作 Codex 内部状态**——改为引导用户在 Codex 中输入一段自然语言指令，让 Codex 自己完成安装

### 1.3 为什么让 Codex 自己装？

| 方案                                                  | 优点                                                                     | 缺点                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| A. Codex Switch 直接解压到 `~/.codex/plugins/`        | 全自动、零用户操作                                                       | Codex 插件格式/目录结构无公开文档，容易因版本升级导致安装失败或损坏用户配置；绕过 Codex 的插件加载机制 |
| **B. 引导用户在 Codex 中输入指令，让 Codex 自己安装** | Codex 理解自己的插件格式；不会因版本变化而失效；用户只需复制粘贴一条指令 | 多一步操作（复制粘贴）；用户必须已启动 Codex                                                           |
| C. 通过 Codex CLI `codex plugin install` 子命令       | 命令行自动化                                                             | CLI 子命令在 Codex v0.139 中不稳定/不存在；且 CLI 本身不是面向小白用户的                               |

> **决策**：选择方案 B。Codex 自己最懂自己的插件机制，我们提供"下载 + 引导"，Codex 负责"安装"。这是最安全、最可靠的分工。

### 1.4 与 Server 端接口的关系

```
Codex Switch (客户端)                     codex-switch-server
┌──────────────────────┐                  ┌─────────────────────────┐
│ 插件页面              │  GET /plugins/   │ /api/v1/plugins/pack    │
│ ├─ 展示插件包信息     │ ──pack─────────▶ │ └─ 版本/大小/描述       │
│ ├─ 下载进度          │                  │                         │
│ └─ 引导指令          │  GET /plugins/   │ /api/v1/plugins/pack/   │
│                      │ ──pack/download─▶ │   download              │
│ 保存到本地磁盘        │                  │   └─ 302 → COS 广州     │
└──────────────────────┘                  └─────────────────────────┘
```

---

## 2. 用户场景与交互流程

### 2.1 核心用户故事

> **小王**刚用 Codex Switch 装好了 Codex Desktop，打开 Codex 发现插件市场刷不出来。他回到 Codex Switch，看到侧边栏多了"🔌 插件"入口。点进去，看到 173 个精选插件打包，点"下载"，一根烟的功夫下好了。他点了"复制指令"，切到 Codex，粘贴，回车。Codex 自动解包、加载了全部 173 个插件。小王打开 Codex 的插件面板，一排绿勾。

### 2.2 页面交互流程

```
┌─ 侧边栏新增 "🔌 插件" 入口
│
├─ Step 1 — 插件包信息
│   ┌──────────────────────────────────────────┐
│   │  🔌 安装 Codex 插件                       │
│   │                                          │
│   │  📦 codex-offline-pack v1.0.0            │
│   │  ├─ 插件数量：173 个                      │
│   │  ├─ 大小：36 MB                          │
│   │  ├─ 更新日期：2026-06-14                  │
│   │  └─ 包含：Claude Code 集成、代码格式化、     │
│   │     Git 辅助、中文优化等精选插件            │
│   │                                          │
│   │  [ 下载插件包 (36 MB) ]                   │
│   └──────────────────────────────────────────┘
│
├─ Step 2 — 下载中（按钮变为进度条）
│   ┌──────────────────────────────────────────┐
│   │  ⬇ 正在下载… 45%                         │
│   │  ████████████▌░░░░░░░░░░░░  16.2 / 36 MB │
│   │  速度：2.1 MB/s · 剩余约 9 秒              │
│   │  [ 取消 ]                                │
│   └──────────────────────────────────────────┘
│
├─ Step 3 — 下载完成，显示引导指令
│   ┌──────────────────────────────────────────┐
│   │  ✅ 下载完成！                            │
│   │  已保存至：                               │
│   │  /Users/xxx/Downloads/codex-offline-      │
│   │  pack.tar.gz                             │
│   │                                          │
│   │  ┌─ 📋 安装步骤 ─────────────────────┐    │
│   │  │                                    │    │
│   │  │  1. 打开 Codex（Desktop 或 CLI）    │    │
│   │  │                                    │    │
│   │  │  2. 在 Codex 对话框中输入以下指令：  │    │
│   │  │                                    │    │
│   │  │  ┌──────────────────────────┐      │    │
│   │  │  │ 你帮安装一下离线插件安装   │      │    │
│   │  │  │ 包 /Users/xxx/Downloads/ │      │    │
│   │  │  │ codex-offline-pack.tar.g │      │    │
│   │  │  │ z ，我要把这些插件都加载   │      │    │
│   │  │  │ 到codex里                │      │    │
│   │  │  └──────────────────────────┘      │    │
│   │  │  [ 📋 复制指令 ]                    │    │
│   │  │                                    │    │
│   │  │  3. Codex 会自动解包并安装全部      │    │
│   │  │     173 个插件，等待完成即可 ✅      │    │
│   │  └────────────────────────────────────┘    │
│   │                                          │
│   │  [ 重新下载 ]  [ 打开下载文件夹 ]          │
│   └──────────────────────────────────────────┘
```

### 2.3 轻量版：Dashboard 快捷入口

除了独立的插件页面，Dashboard 在"工具状态"区域增加一个快捷卡片：

```
┌─────────────────────────┐
│ 🔌 Codex 插件           │
│ 173 个精选插件可安装     │
│ [ 下载并安装 → ]        │
└─────────────────────────┘
```

点击后跳转到插件页面。

---

## 3. 技术设计

### 3.1 新增/修改文件清单

```
codex-switch/
├── electron/
│   ├── plugins/                       # 新建目录
│   │   ├── index.ts                   # 插件下载核心逻辑
│   │   └── types.ts                   # 类型定义
│   ├── ipc/
│   │   └── channels.ts                # 修改：新增 5 个插件通道
│   ├── preload.ts                     # 修改：暴露插件 API
│   └── main.ts                        # 修改：注册 IPC handler + 初始化
├── src/
│   ├── pages/
│   │   └── Plugins.tsx                # 新建：插件页面
│   ├── components/
│   │   └── PluginDownloadCard.tsx     # 新建：下载卡片组件
│   ├── App.tsx                        # 修改：侧边栏 + 路由
│   ├── lib/
│   │   └── store.ts                   # 修改：Page 类型 + 插件状态
│   └── types/
│       └── global.d.ts                # 修改：插件 API 类型
└── tests/
    └── unit/
        └── plugins.test.ts            # 新建：单元测试
```

### 3.2 核心模块：`electron/plugins/index.ts`

```typescript
// 伪代码——仅表达设计意图，不要求严格语法

interface PluginPackInfo {
  version: string;
  filename: string;
  size: number; // bytes
  size_mb: number;
  plugin_count: number;
  description: string;
  updated_at: string;
  download_url: string;
}

interface DownloadProgress {
  bytesDownloaded: number;
  totalBytes: number;
  percent: number; // 0–100
  speedBytesPerSec: number;
  remainingSeconds: number;
}

interface DownloadResult {
  success: boolean;
  filePath?: string; // 保存的绝对路径
  error?: string;
}

class PluginManager {
  private serverClient: ServerClient;
  private downloadAbortController: AbortController | null;

  /** 获取插件包信息 */
  async getPackInfo(): Promise<PluginPackInfo>;

  /** 流式下载插件包到本地磁盘，通过 IPC 事件推送进度 */
  async downloadPack(
    saveDir: string, // 默认 ~/Downloads
    onProgress: (p: DownloadProgress) => void,
  ): Promise<DownloadResult>;

  /** 取消当前下载 */
  cancelDownload(): void;
}
```

### 3.3 下载实现要点

#### 3.3.1 下载链路

```
ServerClient.get('/plugins/pack/download')
  → 302 重定向到 COS 广州
  → 手动 follow redirect（http/https 模块自动不 follow）
  → 流式 pipe 到 fs.WriteStream
  → 每 500ms 读取 fs.statSync 汇报进度
```

**关键决策**：不用 `ServerClient.get()`（它会把响应全读进内存），而是直接使用 `https.get()` + 手动处理 302 + stream pipe。

#### 3.3.2 重定向处理

Node.js `https.get()` 不会自动跟随 302。需要：

1. 发 GET 到 Server 的 `/api/v1/plugins/pack/download`
2. 收到 302 → 从 `Location` header 提取 COS URL
3. 发 GET 到 COS URL
4. 将响应流 pipe 到文件

```typescript
// 伪代码
const serverUrl = resolveServerUrl(prefs);
https.get(`${serverUrl}/plugins/pack/download`, (res) => {
  if (res.statusCode === 302 && res.headers.location) {
    const cosUrl = res.headers.location;
    https.get(cosUrl, (cosRes) => {
      const fileStream = fs.createWriteStream(savePath);
      cosRes.pipe(fileStream);
      // 定时汇报进度
      const interval = setInterval(() => {
        const stat = fs.statSync(savePath);
        onProgress({ bytesDownloaded: stat.size, ... });
      }, 500);
      fileStream.on('finish', () => { clearInterval(interval); resolve(...); });
      fileStream.on('error', (e) => reject(e));
    });
  }
});
```

#### 3.3.3 保存路径

| 平台    | 默认路径                                            | 说明                 |
| ------- | --------------------------------------------------- | -------------------- |
| macOS   | `~/Downloads/codex-offline-pack.tar.gz`             | 用户最熟悉的下载位置 |
| Windows | `%USERPROFILE%\Downloads\codex-offline-pack.tar.gz` | 系统默认下载目录     |

路径通过 Electron 的 `app.getPath('downloads')` 获取，跨平台自动适配。

**去重策略**：如果文件已存在，弹窗询问"覆盖 / 保留已有 / 取消"。如果已存在的文件大小与服务器一致（完整），直接跳到 Step 3（引导安装），不重新下载。

#### 3.3.4 下载超时与重试

- 总超时：5 分钟（36MB 文件在国内 15–20 秒，5 分钟足够覆盖极端网络）
- 静止超时：30 秒无数据 → 自动取消，提示"下载中断：网络不稳定，请重试"
- 不支持断点续传（36MB 不值得增加 Resume 复杂度）
- 用户可手动"重新下载"

#### 3.3.5 取消下载

- 用户点击"取消" → 调用 `req.destroy()` 中断 HTTP 连接
- 删除未完成的临时文件
- 按钮恢复为"下载插件包"

### 3.4 IPC 通道设计

```typescript
// electron/ipc/channels.ts 新增

'plugins:get-pack-info'; // → 获取插件包信息
'plugins:download'; // → 开始下载（触发后通过事件推送进度）
'plugins:cancel-download'; // → 取消下载
'plugins:open-download-dir'; // → 在文件管理器中打开下载目录
'plugins:copy-command'; // → 生成并复制安装指令到剪贴板
```

**主进程 → 渲染进程事件推送**：

```typescript
'plugins:download-progress'; // { percent, downloaded, total, speed, remaining }
'plugins:download-complete'; // { filePath }
'plugins:download-error'; // { error }
```

### 3.5 安装指令生成

```typescript
function formatInstallCommand(filePath: string): string {
  // macOS 示例：/Users/mark/Downloads/codex-offline-pack.tar.gz
  // Windows 示例：C:\Users\mark\Downloads\codex-offline-pack.tar.gz
  return `你帮安装一下离线插件安装包 ${filePath} ，我要把这些插件都加载到codex里`;
}
```

指令复制到剪贴板后，用户在 Codex 对话框中粘贴（`Cmd+V` / `Ctrl+V`），回车发送。

### 3.6 下载状态管理（渲染进程）

```typescript
type PluginPageState =
  | { phase: 'info' } // 初始：展示插件包信息
  | { phase: 'downloading'; progress: DownloadProgress } // 下载中
  | { phase: 'complete'; filePath: string } // 下载完成：引导安装
  | { phase: 'error'; error: string } // 下载失败
  | { phase: 'loading' }; // 加载插件包信息中
```

---

## 4. UI/UX 设计细则

### 4.1 颜色与图标

- **主色调**：沿用 Codex Switch 现有绿色系，表示"可用/成功"
- **图标**：🔌（插件）、⬇（下载）、✅（完成）、❌（失败）
- **进度条**：绿色圆角条，带百分比数字
- **指令框**：灰底等宽字体，模拟终端/输入框样式

### 4.2 文案原则

- **禁止技术术语**："API"、"请求"、"响应"、"重定向" 一律不出现在 UI
- **说人话**：
  - ❌ "HTTP GET /api/v1/plugins/pack 失败" → ✅ "无法获取插件信息，请检查网络连接"
  - ❌ "302 重定向失败" → ✅ "下载通道异常，请稍后重试"
  - ❌ "ECONNREFUSED" → ✅ "服务器暂时不可达，请检查网络后重试"
- **错误提示附操作建议**：每个错误下方告诉用户"下一步该做什么"

### 4.3 空状态 & 边界展示

| 状态                 | UI 表现                                                        |
| -------------------- | -------------------------------------------------------------- |
| 加载插件信息中       | 卡片骨架屏 / spinner                                           |
| Server 不可达        | ❌ 红色错误卡片 + "无法连接服务器，请检查网络" + [重试] 按钮   |
| 已下载过（文件完整） | 直接跳到 Step 3 引导安装，顶部注"上次已下载" + [重新下载] 链接 |
| 下载中               | 进度条 + 速度 + 剩余时间 + [取消] 按钮                         |
| 下载中断             | ❌ 提示错误原因 + [重新下载] 按钮                              |
| 下载完成             | ✅ 引导安装卡片（指令框 + 复制按钮）                           |
| 用户取消了下载       | 回到 Step 1 状态，临时文件已清理                               |

### 4.4 与现有页面的关系

- **侧边栏**：新增 "🔌 插件" 入口（在 "📋 日志" 和 "❓ 帮助" 之间）
- **Dashboard**：新增快捷卡片 "🔌 Codex 插件"（在工具状态区），点击跳转到插件页
- **Settings**：不重复放置（插件是低频但重要的独立功能，适合独立页面）
- **Help**：在 FAQ 中新增一条："如何安装 Codex 插件？"

---

## 5. 下载统计与遥测

### 5.1 遥测事件

复用现有 TelemetryClient，新增事件：

```typescript
{
  event: 'plugin_pack_info_fetch',     // 获取插件信息
  success: boolean,
}

{
  event: 'plugin_pack_download',       // 下载插件包
  success: boolean,
  duration_ms: number,                 // 下载耗时
  size_bytes: number,                  // 文件大小
  cancelled: boolean,                  // 是否用户取消
}

{
  event: 'plugin_install_command_copy', // 用户复制了安装指令
}
```

### 5.2 Server 端统计

Server 端已在 `GET /api/v1/plugins/pack` 和 `GET /api/v1/plugins/pack/download` 记录 `download_records`（source=`plugin-install`），Admin 运营后台自动出现统计。

---

## 6. 拉动增长的联动设计

### 6.1 升级引导（已由 Server 端实现）

`POST /api/v1/update/check` 返回的 `update_highlights` 字段已包含插件功能引导：

```json
"update_highlights": [
  "一键安装 Codex 插件（173 个精选离线包）",
  "COS 国内高速下载，15 秒完成"
]
```

客户端在 UpdateBadge / 版本更新提示中展示这些 highlights。

### 6.2 旧版本用户引导

当旧版本用户（无插件功能）检查更新时：

1. 看到 `update_highlights` 中的插件功能
2. 点击更新 → 升级到 v1.10.0
3. 升级完成后，Dashboard 首次展示"🔌 插件"快捷卡片（带 NEW badge）
4. NEW badge 在用户点击过一次后消失

### 6.3 首次使用引导

v1.10.0 首次启动时：

1. Dashboard "🔌 插件" 卡片带橙色 NEW 角标
2. 进入插件页面后，NEW 角标消失
3. 如果用户从未下载过插件包，插件页面显示首次使用提示："首次使用？这里有一份精选的 173 个插件合集，国内高速下载，一键安装。"

---

## 7. 安全与可靠性

| 维度       | 措施                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------- |
| 下载完整性 | 可选：Server 返回 `Content-MD5` / `sha256` header，客户端下载后校验（v1.10.0 先不做，留 v1.10.1） |
| 恶意文件   | 仅从 codex-switch-server 官方域名下载；COS 链接通过 HTTPS                                         |
| 磁盘空间   | 下载前检查可用空间 > 100 MB（36MB 文件 + 解压空间），不足时提示用户清理                           |
| 权限       | 保存到 `app.getPath('downloads')`，不需要特殊权限                                                 |
| 并发       | 同一时刻只允许一个下载任务（页面按钮在下载中时 disabled）                                         |

---

## 8. 测试清单

### 8.1 单元测试

- `PluginManager.getPackInfo()` 成功/超时/Server 返回错误
- `PluginManager.downloadPack()` 成功/302 重定向/超时/中断
- `formatInstallCommand()` macOS / Windows 路径
- IPC handler 注册与调用

### 8.2 E2E 测试

- 完整下载流程：进入插件页 → 下载 → 完成 → 复制指令
- 取消下载
- 重复下载（文件已存在）
- Server 不可达的错误提示
- Windows 路径显示

### 8.3 手动验收

- [ ] macOS Intel 下载 → 复制指令 → Codex 中粘贴安装
- [ ] macOS Apple Silicon 下载 → 复制指令 → Codex 中粘贴安装
- [ ] Windows x64 下载 → 复制指令 → Codex 中粘贴安装
- [ ] 国内网络环境真实下载速度 ≥ 1 MB/s
- [ ] 下载 36MB 过程中界面不卡顿

---

## 9. 版本规划

| 版本    | 内容                                          | 估时 |
| ------- | --------------------------------------------- | ---- |
| v1.10.0 | 插件页面 + 下载 + 引导安装                    | 主体 |
| v1.10.1 | sha256 校验 + 下载历史记录 + 断点续传（如需） | 增强 |
| 后续    | 增量更新（只下载新增插件）+ 多插件包支持      | 扩展 |

---

## 10. 成功指标

| 指标                              | 测量方式                                              |
| --------------------------------- | ----------------------------------------------------- |
| 插件包下载次数                    | Server `download_records` 表，source=`plugin-install` |
| 下载成功率                        | 客户端遥测 `plugin_pack_download.success`             |
| 安装指令复制次数                  | 客户端遥测 `plugin_install_command_copy`              |
| 插件页面访问量                    | 客户端遥测（可选）                                    |
| 用户反馈"插件装不上"的 Issue 数量 | GitHub Issues 标签 `plugin-install`                   |

---

## 11. 关键决策记录

| #   | 决策                                              | 理由                                                |
| --- | ------------------------------------------------- | --------------------------------------------------- |
| 1   | 让 Codex 自己装插件，Switch 只负责下载            | Codex 插件机制无公开文档，避免硬编码目录结构        |
| 2   | 独立插件页面而非 Settings 子区块                  | 插件是独立功能，有自己的多步流程，需要独立空间      |
| 3   | 保存到 `~/Downloads` 而非 app data                | 用户可见、可手动管理；路径复制到指令中用户能理解    |
| 4   | 不支持断点续传（v1.10.0）                         | 36MB 文件 15–20 秒完成，断点续传复杂度不值得        |
| 5   | 下载用原生 http/https 模块而非 ServerClient.get() | 需要流式写入磁盘 + 进度汇报 + 手动 follow 302       |
| 6   | 下载进度每 500ms 汇报一次                         | 平衡 UI 流畅度与 CPU 开销（fs.statSync 是同步操作） |

---

## 12. 实施顺序

```
Phase 1 — 后端通道（30 min）
  ├─ electron/plugins/index.ts (PluginManager)
  ├─ electron/plugins/types.ts
  ├─ electron/ipc/channels.ts (+5 通道)
  └─ electron/preload.ts (+5 API)

Phase 2 — 前端页面（45 min）
  ├─ src/pages/Plugins.tsx
  ├─ src/components/PluginDownloadCard.tsx
  ├─ src/App.tsx (侧边栏 + 路由)
  └─ src/lib/store.ts (Page 类型)

Phase 3 — 接入与联动（15 min）
  ├─ electron/main.ts (注册 handler + PluginManager 初始化)
  ├─ src/pages/Dashboard.tsx (快捷卡片)
  └─ src/pages/Help.tsx (FAQ 条目)

Phase 4 — 测试（30 min）
  ├─ tests/unit/plugins.test.ts
  └─ E2E 手动验收
```

---

> 🤖 Generated with [Claude Code](https://claude.com/claude-code)
