# 方案：Codex Switch v1.0.0 体验与健壮性改进

> 状态：待 Review
> 目标版本：v1.0.0
> 主题：让小白用户"看得懂、出问题能自救、心里有底"
> 不写代码，仅做方案设计

---

## 0. 背景与目标

v0.1.0 上线后用户反馈集中在以下 4 个痛点：

1. **模型映射失败被静默**：用户日志反复出现 `DeepSeek 400: ...you passed gpt-5.4-mini`，请求被丢弃但用户不知道为什么。
2. **Codex 配置备份越积越多**：`~/.codex/` 下 `config.toml.bak.<ts>` 文件堆成几十个，用户分不清哪个能还原。
3. **日志难以分辨成败**：当前日志只有 `INFO/ERROR + 文本消息`，看不出"这次请求是否成功"、"耗时多久"、"哪个模型"，出问题靠猜。
4. **没有版本记录视图**：用户升级到新版后，不知道改了什么、修了哪些 bug、能不能放心用。

v1.0.0 要解决这 4 个问题，整体定位是从"能跑"升级到"日常可用、可信赖"。

---

## 1. 主题 A — 模型映射健壮性

### 1.1 根因

`electron/proxy/translate.ts` 的 `mapModel`：

```typescript
return mapping[requested] || requested || fallback;
```

`requested = 'gpt-5.4-mini'` 是 truthy，逻辑短路直接透传给 DeepSeek，**fallback 永远不会触发**。配合默认映射表只覆盖 4 个固定名称，导致任何新模型名都会触发 400 错误。

### 1.2 改造方案

**A1. 修正 mapModel 逻辑 + 引入白名单**

新匹配链：精确映射 → DeepSeek 白名单 → 前缀兜底 → fallback。未知模型一律命中 fallback，绝不透传。

```typescript
const VALID_DEEPSEEK_MODELS = new Set(['deepseek-v4-flash', 'deepseek-v4-pro']);
const PREFIX_RULES: Array<{ prefix: string; target: string }> = [
  { prefix: 'gpt-', target: 'deepseek-v4-flash' },
  { prefix: 'o1', target: 'deepseek-v4-pro' },
  { prefix: 'o3', target: 'deepseek-v4-pro' },
  { prefix: 'text-davinci', target: 'deepseek-v4-flash' },
];
```

**A2. 扩充默认映射表**（`electron/config/store.ts`）

覆盖目前已知 OpenAI / Codex 常用模型名：`gpt-5-codex`、`gpt-5.4-mini`、`gpt-4o`、`gpt-4o-mini`、`gpt-4-turbo`、`gpt-4`、`gpt-3.5-turbo`、`o1`、`o1-mini`、`o3`、`o3-mini`。

**A3. 配置迁移：合并新默认值到已有用户配置**

electron-store `defaults` 只在 key 不存在时生效。已安装用户的 `modelMapping` key 已存在，新条目不会自动合并。引入版本号字段：

```typescript
const CURRENT_MAPPING_VERSION = 2;
// 启动时若 saved < CURRENT，合并新 default keys（不覆盖用户自定义）
```

**A4. resolveModel 触发 fallback 时打 WARN 日志**

```
WARN [proxy] 模型 "gpt-5.4-mini" 未在映射表中找到，已自动回退到 "deepseek-v4-flash"
```

### 1.3 测试用例

| 输入                                                   | 期望                              |
| ------------------------------------------------------ | --------------------------------- |
| `mapModel('gpt-5.4-mini', {}, 'deepseek-v4-flash')`    | `'deepseek-v4-flash'`（前缀）     |
| `mapModel('deepseek-v4-pro', {}, 'deepseek-v4-flash')` | `'deepseek-v4-pro'`（白名单透传） |
| `mapModel('gpt-99-future', {}, 'deepseek-v4-flash')`   | `'deepseek-v4-flash'`（前缀）     |
| `mapModel('o3', {}, 'deepseek-v4-flash')`              | `'deepseek-v4-pro'`               |
| `mapModel(undefined, {}, 'deepseek-v4-flash')`         | `'deepseek-v4-flash'`             |
| `mapModel('foo-bar-unknown', {}, 'deepseek-v4-flash')` | `'deepseek-v4-flash'`（fallback） |

---

## 2. 主题 B — Codex 配置备份治理

### 2.1 现状

`electron/codex/writer.ts` 每次写入 `config.toml` / `auth.json` 前都创建 `.bak.<timestamp>` 文件，**无上限、无清理、无 UI 管理**。重度用户两周内可累积几十个备份，且没法在软件内一目了然看到哪个是最近、哪个能还原。

### 2.2 改造方案

**B1. 备份保留策略（滚动保留最近 N 份）**

- 写入新备份后，扫描同一前缀的 `*.bak.*`，按时间倒序保留最近 **5 份**，其余删除。
- 阈值在 `electron/config/store.ts` 可配置（`maxBackupsPerFile`），默认 5。
- 删除操作落 INFO 日志：`备份清理：删除 3 个旧备份`。

**B2. 内容去重（避免每次启动都生成相同备份）**

写入前先比对：如果待写内容与现有文件**字节相同**，跳过整个备份+写入流程。这能彻底消除"启动一次产生一个备份"的现象。

**B3. 「设置」页增加"Codex 备份管理"区块**

UI 列表：

```
Codex 配置备份                              [一键清理所有]

config.toml.bak.1717050000  2026-05-30 10:00  [还原] [删除]
config.toml.bak.1716960000  2026-05-29 09:00  [还原] [删除]
auth.json.bak.1717050000    2026-05-30 10:00  [还原] [删除]
...
```

- 「还原」：复用现有 `restoreCodexConfig`，还原前再做一次当前文件的备份（防误操作）。
- 「删除」：单条删除。
- 「一键清理所有」：弹确认框，清空所有 `.bak.*`。

**B4. 备份时间显示用人话**

文件名 `config.toml.bak.1717050000` 难以辨认，UI 里转换为 `2026-05-30 10:00:00`，并标注"2 小时前 / 昨天 / 3 天前"。

### 2.3 受影响文件

- `electron/codex/writer.ts` — 加入保留策略 + 内容去重
- `electron/codex/restore.ts`（新文件可选，或扩展 writer.ts）— 删除单条、批量清理
- `electron/ipc/channels.ts` — 新增 `codex:listBackups`、`codex:deleteBackup`、`codex:cleanAllBackups`
- `electron/main.ts` — 注册 handler
- `src/pages/Settings.tsx` — 新增"备份管理"区块

---

## 3. 主题 C — 日志体验升级

### 3.1 现状

当前日志条目结构：

```typescript
{
  (ts, level, source, message);
}
```

UI 只显示一行文本。无法回答用户的核心疑问："**我刚才那次请求成功了吗？花了多久？用的哪个模型？为什么失败？**"

### 3.2 改造方案

**C1. 引入"请求生命周期"日志（关键变更）**

每次 `/v1/responses` HTTP/WebSocket 请求生成**唯一 reqId**（如 `req_a1b2c3`），在生命周期的开始、结束、出错三个节点打日志，全部携带 reqId 串起来：

```
INFO  [http] [req_a1b2c3] → 请求开始 model=gpt-5.4-mini→deepseek-v4-flash stream=true
INFO  [http] [req_a1b2c3] ✓ 请求成功 状态=200 耗时=1842ms tokens=156→512
ERROR [http] [req_a1b2c3] ✗ 请求失败 状态=400 耗时=312ms 原因="模型 gpt-5.4-mini 不被 DeepSeek 接受"
```

扩展 `ProxyLogEntry`：

```typescript
interface ProxyLogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error';
  source: 'http' | 'ws' | 'proxy';
  message: string;
  reqId?: string;
  phase?: 'start' | 'success' | 'error';
  durationMs?: number;
  model?: string; // 实际发给 DeepSeek 的模型
  requestedModel?: string; // 客户端原始模型
  statusCode?: number;
  errorReason?: string; // 友好化的失败原因
}
```

**C2. 失败原因友好化（错误消息翻译表）**

把 DeepSeek 原始错误翻译成用户能看懂的中文：

| DeepSeek 原文/code                         | 友好提示                                        |
| ------------------------------------------ | ----------------------------------------------- |
| `invalid_request_error` + `model` 关键字   | "模型名不被 DeepSeek 接受，请检查模型映射设置"  |
| `authentication_error` / `Invalid API key` | "DeepSeek API Key 无效或已过期，请在设置中更新" |
| `insufficient_quota`                       | "DeepSeek 账户额度不足，请前往 DeepSeek 充值"   |
| `rate_limit_exceeded`                      | "请求过于频繁，已被 DeepSeek 限流，稍后重试"    |
| `context_length_exceeded`                  | "对话过长，超过模型上下文限制"                  |
| 网络超时 / ECONNRESET                      | "无法连接到 DeepSeek，请检查网络或代理设置"     |
| 其他                                       | 透传原始消息 + 状态码                           |

**C3. 「日志」页面渲染升级**

- 按 reqId 折叠分组，一次请求一个卡片（开始 + 结束/错误）。
- 卡片头部显示状态图标：✓ 绿 / ✗ 红 / ⚠ 黄。
- 卡片显示：模型、耗时、状态码（成功）；失败时高亮"友好原因"，原始错误折叠在「详情」内可展开。
- 顶部统计条：今日请求数 / 成功率 / 平均耗时 / 错误数。
- 过滤器：只看错误、只看 WebSocket、按模型筛选、时间范围。

**C4. 「仪表盘」联动告警**

主面板新增"最近 5 分钟"实时统计小窗：

```
┌──────────────────────────────────┐
│ 代理运行中  ●                     │
│ 端口 11435  · 运行 2h 13m         │
│                                  │
│ 近 5 分钟  12 请求  91% 成功      │
│ 最近错误:  模型名不被 DeepSeek 接受 │
│                          [查看日志]│
└──────────────────────────────────┘
```

错误数 > 0 时显示红点徽标。

**C5. 日志持久化策略**

- 内存环形缓冲保留最近 1000 条，渲染端拉取。
- 磁盘端通过 `electron-log` 写到 `userData/logs/main.log`，按天滚动，保留 7 天。
- 用户可在「日志」页一键「打开日志目录」「导出当前日志为 .txt」用于反馈 bug。
- 持久化前**统一脱敏**：所有 `Authorization` header、`OPENAI_API_KEY` 值、`sk-*` 模式字符串替换为 `***`。

### 3.3 受影响文件

- `electron/proxy/server.ts` — reqId 生成、生命周期日志、错误翻译
- `electron/proxy/stream.ts` — 把 DeepSeek 状态码/错误体回传调用方
- `electron/proxy/errors.ts`（新）— 错误翻译表
- `electron/ipc/channels.ts` — `proxy:log` push 通道（实时推送给渲染层）
- `src/pages/Logs.tsx` — 卡片分组渲染、过滤器、统计条
- `src/pages/Dashboard.tsx` — 近 5 分钟统计小窗

---

## 4. 主题 D — 版本记录（v1.0.0 发布配套）

### 4.1 需求

> "我们这次发就是 1.0.0 版本，软件不起眼的地方可以看到版本记录，每个版本都增加或者修复了什么。"

### 4.2 改造方案

**D1. 仓库引入 `CHANGELOG.md`**

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。结构：

```markdown
# 更新日志

## [1.0.0] - 2026-05-30

### 新增

- 模型映射前缀兜底，自动识别 gpt-\* / o1 / o3 系列
- Codex 配置备份滚动保留最近 5 份，新增 GUI 备份管理
- 日志按请求维度分组展示，含成功率、耗时、错误原因翻译
- 设置 → 关于 → 版本记录，可查看历史变更
- 自动检查更新：发现新版可一键下载安装，无需手动去 GitHub 下载
- 国内镜像加速：自动探测 ghproxy 等公共镜像，国内用户也能流畅升级
- 内嵌中文帮助：常见问题、报告问题、加入交流群二维码（qa.png）
- Codex 入门向导：首次启动、「仪表盘」、「帮助」抽屉三处入口，5 分钟跑通 Hello World

### 修复

- 修复 `gpt-5.4-mini` 等未知模型被透传给 DeepSeek 导致 400 的问题
- 修复 Codex 配置每次启动生成重复备份的问题

### 变更

- 默认 fallback 模型 `deepseek-v4-flash`，未知模型不再透传
- 全中文界面，移除界面中所有英文术语（保留 DeepSeek、Codex 等产品名）

## [0.1.0] - 2026-05-29

### 新增

- 初始版本：本地代理 + Codex 配置注入 + React UI 向导
- macOS / Windows 双平台打包（x64 + arm64）
```

**D2. 把 CHANGELOG 打包进应用**

构建脚本将 `CHANGELOG.md` 复制到 `dist/` 并由 electron-builder 通过 `extraResources` 写入安装包；运行时由主进程读取并通过 IPC `app:get-changelog` 暴露。

> 优点：版本记录与应用版本一起发布，离线可看，无需打开浏览器。

**D3. 「设置」 → 关于 → "版本记录"按钮**

当前 v0.1.0 的「关于」区块已显示版本号，扩展为：

```
关于
─────────────────────────────────────────
版本     1.0.0                  [检查更新]
代理     http://127.0.0.1:11435
项目主页 github.com/Mark7766/codex-switch
                                [查看版本记录]
```

点击「查看版本记录」弹出「版本记录」弹窗，渲染 CHANGELOG（markdown → React，建议用 `react-markdown` 轻量库；如不想加依赖，可用极简正则把 `##` `###` `-` 解析为 h2/h3/li）。

**D4. 首次启动新版本时弹出"What's New"**

记录上次启动版本号到 electron-store。检测到版本号上升时，在主窗口加载后弹一次性「新版亮点」弹窗，展示**当前版本**的 changelog 段落（不展示全部历史），底部勾选「不再提示」或自动 5 秒后允许关闭。

### 4.3 版本号同步

- `package.json` `version: "1.0.0"`
- `electron-builder.yml` `productName`、artifactName 模板已使用 `${version}`，无需改动
- README 顶部「最新版本」徽章更新
- GitHub Release tag `v1.0.0`，body 直接复用 `CHANGELOG.md` 的 1.0.0 段落

### 4.4 受影响文件

- `CHANGELOG.md`（新）
- `package.json` — version 升到 1.0.0
- `electron-builder.yml` — `extraResources` 加 `CHANGELOG.md`
- `electron/main.ts` — 新增 `app:get-changelog` handler
- `electron/ipc/channels.ts` — 新增通道
- `electron/config/store.ts` — 新增 `lastSeenVersion` 字段
- `src/pages/Settings.tsx` — 「关于」加按钮 + 「版本记录」弹窗
- `src/components/ChangelogModal.tsx`（新）— Markdown 渲染
- `src/App.tsx` — 启动时检测 lastSeenVersion 触发 What's New

---

## 5. 主题 E — 用户友好的版本升级体验

### 5.1 现状与痛点

v0.1.0 用户升级靠"自己去 GitHub Release 页下载新 dmg/exe → 拖应用 → 重启代理"，对小白用户几乎不可能完成。必须做到：**应用自己发现新版本 → 引导用户一键下载安装 → 重启即用**。

### 5.2 技术选型

**electron-updater**（electron-builder 官方配套）

| 备选                            | 评估                                                                                       | 结论             |
| ------------------------------- | ------------------------------------------------------------------------------------------ | ---------------- |
| `electron-updater`              | electron-builder 原生支持，配置一行；支持 GitHub Releases / S3 / 通用 HTTP；macOS 增量更新 | ✅ 选用          |
| Squirrel.Mac / Squirrel.Windows | Electron 内建 autoUpdater，需自己搭服务器，签名要求高                                      | ❌ 重            |
| 应用内开浏览器跳转下载          | 用户体验差，等同手工升级                                                                   | ❌ 仅作 fallback |

后端用 **GitHub Releases**：不需要服务器、不需要 CDN，CI 打包流水线已经把产物上传到 Release 资产，electron-updater 直接读 `latest-mac.yml` / `latest.yml`。

### 5.3 升级流程设计

```
┌──────────────────────────────────────────────────────────────┐
│ 1. 启动后 5 秒静默检查（不阻塞 UI）                              │
│    GET github.com/Mark7766/codex-switch/releases/latest      │
│                                                              │
│ 2. 有新版本？                                                  │
│    ├─ 否 → 静默；下次启动再检查（每 6 小时自动一次）             │
│    └─ 是 →                                                    │
│       ① 「仪表盘」右上角显示蓝色徽标"v1.1.0 可更新"             │
│       ② 不打扰用户，等他点击                                     │
│                                                              │
│ 3. 用户点击徽标 → 弹出升级弹窗                                │
│    ┌────────────────────────────────────┐                   │
│    │ 发现新版本 v1.1.0                   │                   │
│    │ 当前版本 v1.0.0                     │                   │
│    │                                    │                   │
│    │ ### 新增                            │                   │
│    │ - 自定义模型映射 GUI               │                   │
│    │ - 自动重试失败请求                  │                   │
│    │ ### 修复                            │                   │
│    │ - 修复 xxx ...                      │                   │
│    │                                    │                   │
│    │ [稍后再说] [立即更新]                │                   │
│    └────────────────────────────────────┘                   │
│                                                              │
│ 4. 点「立即更新」→ 后台下载                                     │
│    ├─ 「仪表盘」进度条 + 速度 + 剩余时间                       │
│    ├─ 用户可继续正常使用代理                                    │
│    └─ 下载完成 → 弹出"已就绪"提示                              │
│                                                              │
│ 5. 用户点「立即重启安装」                                       │
│    ├─ 代理优雅停止（让 Codex CLI 当前请求完成）                  │
│    ├─ 应用退出 + 自动调用安装器                                  │
│    └─ 安装完成自动重启新版本，代理恢复                          │
└──────────────────────────────────────────────────────────────┘
```

### 5.4 改造方案细分

**E1. 接入 electron-updater + GitHub Provider**

`electron-builder.yml` 增加 `publish` 配置：

```yaml
publish:
  provider: github
  owner: Mark7766
  repo: codex-switch
  releaseType: release # 不抓 prerelease
```

主进程 `electron/updater/index.ts`（新）封装：

- `checkForUpdates()` — 静默检查，触发事件 `update-available` / `update-not-available`
- `downloadUpdate()` — 触发下载，进度通过 `download-progress` 推给渲染层
- `quitAndInstall()` — 调用 autoUpdater 自带方法

**E2. 检查策略（不打扰原则）**

- 启动后 **5 秒** 延迟检查（避开冷启动峰值）
- 之后每 **6 小时** 自动检查一次（应用一直运行的情况）
- 「设置」 → 关于 → 「检查更新」按钮，手动触发；按钮显示当前检查状态（"正在检查 / 已是最新 / 发现新版"）
- 用户可在「设置」关闭"自动检查更新"（默认开）

**E3. 升级弹窗复用「版本记录」弹窗渲染**

升级弹窗的"新增/修复"区块直接渲染**目标版本**的 CHANGELOG 段落（从 GitHub Release body 拿，或下载完成后从新包里读取）。

**E4. 下载进度可视化（不强制弹窗）**

- 「仪表盘」顶部出现一条窄进度条："下载更新 v1.1.0 · 12.3 MB/s · 剩余 8s"
- 用户可以一键暂停（隐藏进度条到托盘）
- 进度过程**完全不阻塞**代理服务，Codex CLI 继续可用

**E5. 安装时机由用户决定**

下载完成后**不立即安装**，避免打断用户当前工作流：

- 弹出非阻塞提示："v1.1.0 已下载完成，下次启动自动安装" + 「立即重启安装」按钮
- 用户下次关闭应用时自动安装（autoUpdater 默认行为）
- 若用户当前正在被 Codex CLI 调用（最近 30 秒有请求），延迟 30 秒再提示，避免打断

**E6. 平台特殊性处理**

| 平台    | 注意点                                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| macOS   | 必须 Developer ID 签名 + notarization，否则 electron-updater 拒绝安装；未签名版本降级为"打开浏览器跳转 GitHub Release 页"（fallback 路径） |
| Windows | NSIS 安装包自动支持差量；未签名时 SmartScreen 会拦，README 已有说明                                                                        |
| ARM64   | electron-updater 自动按 `process.arch` 匹配正确 dmg/exe，无需额外配置                                                                      |

**E7. 失败回滚与诊断**

- 下载失败（网络/校验）→ 通知用户"更新下载失败，可稍后重试或手动从 GitHub 下载"，附带「打开 Release 页」按钮
- 安装失败（罕见，权限/签名问题）→ 写入日志 + 弹窗给出 Release 页链接
- 旧版本与新版本的 `electron-store`/`~/.codex` 完全兼容（配置迁移见主题 A.A3 已涵盖）

**E8. CI/Release 流水线配合**

`.github/workflows/ci.yml` 在 tag 推送时：

1. 多平台并行打包
2. 自动 `electron-builder --publish always`，把 dmg/exe + `latest-mac.yml` + `latest.yml` + `latest-mac-arm64.yml` 等元数据文件上传到 GitHub Release
3. Release tag 必须形如 `v1.1.0`（与 package.json 的 version 严格一致），CI 用一步校验

**E9. 中国镜像加速（解决国内访问 GitHub 慢/失败）**

国内用户对 GitHub raw / release 资产的下载经常超时。本主题给 electron-updater 增加**镜像通道**：

技术方案：electron-updater 支持 `provider: generic` 自定义 base URL。在 `electron/updater/index.ts` 启动时按以下顺序探测可用镜像：

```
镜像优先级（首次成功即用，每次启动重新探测）：
  1. 直连     https://github.com/Mark7766/codex-switch/releases/latest/download/
  2. ghproxy  https://ghproxy.net/https://github.com/Mark7766/codex-switch/releases/latest/download/
  3. ghproxy  https://gh.api.99988866.xyz/https://github.com/Mark7766/codex-switch/releases/latest/download/
  4. mirror.ghproxy.com（备用）
```

实现细节：

- 探测方式：`HEAD` 请求 `latest.yml`，5s 超时，状态码 200 即视为可用
- electron-updater 提供 `setFeedURL({ provider: 'generic', url: <chosen mirror> })` 动态切换，**保留 sha512 校验**（镜像只是 CDN 加速，文件不变，校验仍然防篡改）
- 「设置」中增加镜像选择（默认"自动"）：自动 / 直连 GitHub / ghproxy / 自定义 URL
- 用户填自定义 URL 时给一行说明："格式如 `https://your-mirror/Mark7766/codex-switch/releases/latest/download/`"
- 镜像切换日志清晰可见：`INFO [updater] 使用镜像 ghproxy.net 下载 v1.0.1`

> 安全声明：sha512 校验是**最关键的防线**——即使镜像被劫持，篡改的安装包也会校验失败被拒绝。镜像方案不削弱安全性，只是加速下载。

### 5.5 测试用例

| 场景                                             | 期望                                                        |
| ------------------------------------------------ | ----------------------------------------------------------- |
| 当前 v1.0.0，启动后 5 秒检查 → Release 是 v1.0.0 | 静默，无任何 UI 提示                                        |
| 当前 v1.0.0，Release 是 v1.0.1                   | 「仪表盘」出现升级徽标，点击弹升级弹窗显示 v1.0.1 changelog |
| 点「立即更新」断网 → 下载失败                    | 提示用户失败，提供 GitHub Release 页跳转                    |
| 下载完成时代理刚被 Codex 调用                    | 延迟 30 秒后才弹「已就绪」提示                              |
| 用户在「设置」关闭自动检查                       | 启动不检查；手动按「检查更新」仍可工作                      |
| Release 是 prerelease                            | 不被自动检查发现（releaseType: release）                    |
| GitHub 直连超时但 ghproxy 可达                   | 自动切到 ghproxy，下载成功，日志显示使用的镜像              |
| 镜像下载完成后 sha512 不匹配                     | 拒绝安装，提示用户"安装包校验失败，请稍后重试或切换镜像"    |

### 5.6 受影响文件

```
electron-builder.yml              ← publish 配置（github provider）
electron/updater/index.ts (new)   ← electron-updater 封装 + 镜像探测/切换
electron/updater/mirrors.ts (new) ← 镜像列表与可用性探测
electron/main.ts                  ← 启动 5 秒后触发首次检查，注册定时器
electron/ipc/channels.ts          ← update:check / update:download / update:install / update:on-progress / update:set-mirror
electron/config/store.ts          ← 新增 autoCheckUpdate / updateMirror 字段
src/pages/Dashboard.tsx           ← 升级徽标 + 下载进度条
src/pages/Settings.tsx            ← 「检查更新」按钮 + 自动检查开关 + 镜像选择
src/components/UpdateModal.tsx (new) ← 升级提示弹窗
.github/workflows/ci.yml          ← tag 推送时 publish always；版本号一致性校验
package.json                      ← 加 dep: electron-updater
```

### 5.7 风险与缓解

| 风险                                             | 缓解                                                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 未签名版本在 macOS 上 electron-updater 报错      | 加入"签名检测"，未签名时降级为打开浏览器跳转，绝不让用户卡住                                                |
| 用户网络无法访问 GitHub                          | 检查超时设为 10s，失败静默；不提示"无网络"以免反复打扰                                                      |
| GitHub API rate limit（未登录 60 次/小时/IP）    | electron-updater 默认走 `releases/latest` 静态 JSON，不触发 API；6 小时一次远低于上限                       |
| 版本号不一致（package.json 1.0.0 vs tag v1.0.1） | CI 加 `node -e "process.exit(require('./package.json').version === process.env.TAG.slice(1) ? 0 : 1)"` 校验 |
| 安装包被运营商劫持/篡改                          | electron-updater 默认校验 sha512（写在 latest-\*.yml 里），不匹配直接拒绝                                   |

---

## 6. 主题 F — 内嵌帮助（极简风格）

### 6.1 设计原则（贯穿整个 v1.0.0）

> **极简、可扫读、少即是多。** 帮助不是说明书，是"用户在卡住的那一瞬间能立刻找到答案"的快捷入口。

具体准则：

- **全中文界面**：面向中文用户，所有 UI 文案 / 常见问题 / 错误提示 / 按钮语一律中文，**不出现英文术语**（除不可避免的产品名 / 技术升级名词如 "DeepSeek"、"Codex"）

  > 备注：本文档后续全部采用表中中文名描述界面。代码侧的文件名、类名、IPC 通道名依然使用英文 / 驼峰命名（例如 `Dashboard.tsx` / `UpdateModal` / `help:get-faq`），仅是实现细节，不会出现在用户看得到的 UI 上。

  | UI 中文名（用户可见） | 代码标识 / 路径（开发侧）                     |
  | --------------------- | --------------------------------------------- |
  | 「首次设置」向导      | `src/pages/Setup.tsx`                         |
  | 「仪表盘」            | `src/pages/Dashboard.tsx`                     |
  | 「设置」              | `src/pages/Settings.tsx`                      |
  | 「日志」              | `src/pages/Logs.tsx`                          |
  | 「帮助」抽屉          | `HelpDrawer` 组件                             |
  | 「Codex 入门」抽屉    | `OnboardingDrawer` 组件                       |
  | 「升级提示」弹窗      | `UpdateModal` 组件                            |
  | 「版本记录」弹窗      | `ChangelogModal` 组件                         |
  | 「报告问题」弹窗      | `ReportIssueModal` 组件                       |
  | 「加入交流群」弹窗    | `QaGroupModal` 组件                           |
  | 「顶栏」              | `HeaderBar` 组件                              |
  | 「常见问题」折叠列表  | `FaqList` 组件（数据源 `docs/help/faq.json`） |

- **零跳转优先**：能在应用内 1 次点击解决的问题，绝不让用户开浏览器
- **就地求助**：错误发生在哪里，"如何修"的链接就放在哪里（旁边/卡片底部）
- **三句话原则**：每个常见问题条目控制在 3 句话以内；超过的拆分或外链
- **无搜索框**：常见问题不超过 12 条；超过 12 条说明产品有问题，要先去简化产品本身
- **不写动图/视频**：截图 + 文字即可；保持轻量

### 6.2 改造方案

**F1. 全局 Help 入口（顶栏右上角问号图标）**

四个页面（「首次设置」/「仪表盘」/「设置」/「日志」）顶栏右上角统一加一个 `?` 图标，点击弹出「帮助」抽屉（从右侧滑出 380px 宽）。

抽屉内容**随当前页面智能切换**：

| 当前页面  | 抽屉默认显示                                   |
| --------- | ---------------------------------------------- |
| Setup     | "如何获取 DeepSeek API Key" + "向导每一步说明" |
| Dashboard | "代理状态指标含义" + "无法启动怎么办"          |
| Settings  | "模型映射如何工作" + "备份何时生成"            |
| Logs      | "如何看懂日志卡片" + "常见错误原因翻译表"      |

抽屉底部固定 3 个按钮：

```
[完整常见问题]   [报告问题]   [打开日志目录]
```

**F2. 首次启动「首次设置」向导加 2 行说明**

「首次设置」第一步的「DeepSeek API Key」输入框下方加一行小灰字：

```
还没有 API Key？[点这里] 1 分钟创建（platform.deepseek.com）
```

点击直接 `shell.openExternal`，避免用户卡在第一步。

**F3. 错误现场就地提示（与主题 C 联动）**

Logs 卡片的错误原因下方，**根据错误类型**直接给出"修复建议"链接：

```
✗ 请求失败  耗时 312ms
原因: DeepSeek API Key 无效或已过期
        ↳ [打开设置更新 Key]   [查看完整常见问题]
```

| 错误类型     | 就地建议                                                             |
| ------------ | -------------------------------------------------------------------- |
| API Key 无效 | 「打开设置 → API Key 输入框聚焦」                                    |
| 模型未识别   | 「打开设置 → 模型映射区块」                                          |
| 额度不足     | 「打开 DeepSeek 充值页」（外链）                                     |
| 网络问题     | 「打开诊断」按钮：自动 ping api.deepseek.com、检查代理设置、输出报告 |
| 限流         | 「了解 DeepSeek 限流策略」（外链）                                   |

**F4. 内置「常见问题」集（不超过 12 条）**

放在 `docs/help/faq.json`，构建时打包进应用，由「帮助抽屉」的「完整常见问题」按钮渲染。结构：

```json
[
  { "id": "no-api-key", "q": "我没有 DeepSeek API Key，怎么获取？", "a": "..." },
  { "id": "proxy-port-occupied", "q": "代理启动失败提示端口被占用？", "a": "..." },
  { "id": "codex-cli-not-using-proxy", "q": "Codex CLI 似乎没走代理？", "a": "..." },
  { "id": "model-not-supported", "q": "提示模型名不被 DeepSeek 接受？", "a": "..." },
  { "id": "auth-failed", "q": "提示 API Key 无效？", "a": "..." },
  { "id": "rate-limit", "q": "频繁报错被限流？", "a": "..." },
  { "id": "restore-codex", "q": "想还原原来的 Codex 配置？", "a": "..." },
  { "id": "where-is-log", "q": "日志文件在哪里？", "a": "..." },
  { "id": "uninstall", "q": "如何完全卸载？", "a": "..." },
  { "id": "macos-cannot-open", "q": "macOS 提示文件已损坏无法打开？", "a": "..." },
  { "id": "windows-smartscreen", "q": "Windows SmartScreen 阻止运行？", "a": "..." },
  { "id": "upgrade", "q": "如何升级到新版本？", "a": "..." }
]
```

精确 12 条，覆盖**安装/启动/使用/故障/升级/卸载**全生命周期。

「常见问题」列表：折叠面板（默认全部折叠，点击展开）。每条答案右下角加「这条没用？」反馈按钮，匿名上报到主进程日志（不联网，仅用于自我审视哪些常见问题失败）。

**F5. 「报告问题」一键打包诊断信息**

点击「报告问题」按钮 → 弹出弹窗：

```
报告问题

我们需要这些信息来帮你排查：
  ☑ 应用版本：1.0.0
  ☑ 操作系统：macOS 14.5 (arm64)
  ☑ 最近 100 条日志（已脱敏）
  ☑ 代理状态：运行中，端口 11435
  ☐ 当前 ~/.codex/config.toml（默认不含，可勾选）

[复制诊断信息] [打开 GitHub Issue 页面]
```

- 「复制诊断信息」→ 拼成 markdown 写入剪贴板，用户去 GitHub 粘贴即可
- 「打开 GitHub Issue 页面」→ `shell.openExternal` 跳转到带 issue template 的预填 URL
- 所有信息**统一脱敏**（API Key、邮箱、IP）

**F6. 「打开日志目录」直达**

调用 `shell.showItemInFolder` 直接打开系统文件管理器到 `userData/logs/`，方便用户找日志反馈给客服/朋友。

**F7. README 链接策略**

应用内**不放大段文档**，应用 + 极少常见问题即可。完整文档放 README：

- 应用内「完整常见问题」按钮底部加一句："想看更多？[查看在线文档]" → 跳转 README
- README 顶部加导航：安装 / 使用 / 故障排查 / 贡献，与应用内「常见问题」形成"轻→重"两级

**F8. 问题咨询群二维码（社区支持入口）**

仓库已备二维码图 `docs/qa.png`，用于引导用户加入咨询群。两个入口：

1. **「帮助」抽屉底部加一个「加入交流群」按钮**，点击弹出小弹窗展示二维码 + 一句说明：

   ```
   加入 Codex Switch 交流群

   [二维码图片]

   微信扫一扫，与作者和其他用户交流问题。
   ```

2. **「设置」→ 关于** 区块底部加一行「遇到问题？[加入交流群]」，点击同上

营造「有人答疑」的心理安全感；常见问题解决不了的问题加群问作者。

打包需要：`docs/qa.png` 通过 `extraResources` 写入安装包，主进程读取后以 base64 返回渲染层（`help:get-qa-image` IPC）。

**F9. Codex 入门向导（安装后不知道怎么用）**

问题背景：很多用户反馈“装完 Codex Desktop / CLI 后不知道从哪下手”、“对着黑窗口发恼”。Codex Switch 作为他们连接 DeepSeek 的入口，順手负责「接上代理后该怎么用 Codex」的「第一推」。

**设计原则**：不重新发明 Codex 文档，只重点考虑“刚装完不知从哪下手”的小白场景，**5 分钟内跑通一个 Hello World**。文案口语化、能复制粘贴、给截图。

**入口**：

- 「仪表盘」「代理运行中」状态下，按钮区增加一个**主推动作**「第一次使用？看 5 分钟上手」（首次启动默认高亮闪动，点过一次后变为普通次按钮）
- 「帮助」抽屉顶部第一项「入门：刚装完 Codex 从哪下手」
- 「首次设置」向导最后一步「完成」后默认弹出（带「以后不再提醒」复选框）

**内容结构（抽屉式滑动，不要多页签）**：

```
Codex 入门（5 分钟）
───────────────────────────────────────

☑︎ 第 1 步 ・ 确认 Codex Switch 在跑
   仪表盘右上角为「代理运行中 ●」即可。

② 第 2 步 ・ 选你要用哪个 Codex

   · 刚下载了 Codex Desktop（桌面版）
     → 打开 Codex Desktop → 设置 → 模型代理
        → 填 Base URL： http://127.0.0.1:11435/v1
        → API Key 随意填（例：sk-anything）→ 保存

   · 你用 Codex CLI（命令行版）
     → Codex Switch 已自动帮你写好 ~/.codex/config.toml
        不需任何手动配置，直接跳第 3 步。

③ 第 3 步 ・ 说个“你好”试试水

   · Desktop：打开 Codex Desktop → 新建会话 → 输入「你好，给我写个 hello world」
   · CLI    ：打开终端 → 输 `codex` 回车 → 输「给我写个 hello world」

   看到回复 → 恭喜，你已经连上 DeepSeek 了。

④ 第 4 步 ・ 下一步玩什么？

   三个试一试的说法（按钮点击会复制到剪切板）：
   · 「请帮我把这个文件夹里的所有 .png 名字改成拼音」
   · 「读一下这个 Excel，告诉我哪几列为空」
   · 「帮我写一个 Python 脚本，把桌面上的截图按时间分文件夹」

⑤ 卡住了怎么办？
   · 「报告有错误」 → 点「帮助」抽屉里的「常见问题」
   · 「没反应」   → 看「日志」页是否有请求记录
   · 「还是不行」 → 点「加入交流群」问作者
```

**护航细节**（让入门不变为“又一篇看不懂的文档”）：

- 每一步都带「一键复制」按钮，Base URL / 示例提示词都能一点进剪切板
- 「第 2 步」在列出 Desktop 设置项名时，背后附一张小截图（放 `docs/help/onboarding/codex-desktop-base-url.png`）。未来版本上位后项名变了也可以只换图不改文案。
- 能检测状态的步骤默认勾上 ☑︎：比如「代理是否运行」从「仪表盘」状态取；`~/.codex/config.toml` 存在与否可以从主进程检测。让用户一眼看出在哪一步。
- 末尾提供三个「试一试的说法」是关键：小白装完 Codex 最拓少的不是配置，是「不知道可以问它什么」。
- 不重复 Codex 官方文档内容；抽屉底部加一个「查看 Codex 官方文档」外链交给感兴趣的人去深读。

**多语言 / 多版本**：内容作为纯文案 + 结构存于 `docs/help/onboarding.json`（中文），跟常见问题一起打包；以后要调文案只改 JSON 不动代码。增量更新可跟随主题 D 的 CHANGELOG、主题 E 的 electron-updater 一起发。

**IPC 与打包**：`onboarding.json` 与可选截图都走 `extraResources`；主进程只需增加一个 `help:get-onboarding` IPC 返回结构化数据，渲染端绘制。

### 6.3 极简风格落地清单（应用其他地方一并执行）

帮助系统设计完，顺手检查全应用是否符合极简：

| 项               | 现状        | 调整                                                                             |
| ---------------- | ----------- | -------------------------------------------------------------------------------- |
| 「首次设置」向导 | 多步流程？  | 一屏完成：API Key + 模型默认 + 完成按钮，3 个字段封顶                            |
| 「仪表盘」       | 信息密度    | 突出 1 个核心指标（"代理运行中 ●"），其他 ≤ 4 个次要指标                         |
| 「设置」         | 标签页/分组 | 全部展开在单页，不用标签页；用「关于」「模型」「备份」「更新」4 个区块即可       |
| 「日志」         | 默认视图    | 按 reqId 卡片折叠，默认只显示卡片头部；详情点击展开                              |
| 文案             | 用词        | 全部口语化中文；禁用"配置"、"实例化"、"启用"等术语，改"设置"、"打开"、"开启"     |
| 按钮             | 主次        | 一个页面最多一个**主按钮**（蓝色实心），其余次按钮（白底/灰边）                  |
| 颜色             | 调色板      | 仅 4 色：白底 + 黑字 + 蓝主色 + 错误红；告警黄、成功绿仅出现在状态徽标           |
| 图标             | 来源        | 全部用 lucide-react（已有依赖或新加），统一线条风格，禁止 emoji 作为永久 UI 元素 |
| 字号             | 层级        | 仅 3 级：标题 18px / 正文 14px / 辅助 12px                                       |
| 间距             | 节奏        | 8px 网格：组件间距 8/16/24 三档                                                  |

### 6.4 受影响文件

```
docs/help/faq.json (new)               ← 主题 F（常见问题数据，中文）
docs/help/onboarding.json (new)        ← 主题 F.F9（Codex 入门步骤）
docs/help/onboarding/*.png (new)       ← 主题 F.F9（入门截图，例如 codex-desktop-base-url.png）
docs/qa.png                            ← 主题 F.F8（咨询群二维码，已存在）
src/components/HelpDrawer.tsx (new)    ← 主题 F（顶栏问号抽屉）
src/components/FaqList.tsx (new)       ← 主题 F（「常见问题」折叠列表）
src/components/ReportIssueModal.tsx (new) ← 主题 F（诊断信息打包）
src/components/QaGroupModal.tsx (new)  ← 主题 F.F8（二维码弹窗）
src/components/OnboardingDrawer.tsx (new) ← 主题 F.F9（入门抽屉）
src/components/HeaderBar.tsx (new 或 改造) ← 主题 F（顶栏问号图标）
src/pages/Setup.tsx                    ← 主题 F.F2 + F.F9 结束弹出入门抽屉 + 极简风格调整
src/pages/Dashboard.tsx                ← 信息密度收敛 + 「看 5 分钟上手」按钮
src/pages/Settings.tsx                 ← 单页「区块化」 + “加入交流群”入口
src/pages/Logs.tsx                     ← 主题 F.F3 就地修复建议链接
electron-builder.yml                   ← extraResources 加 docs/help/faq.json + docs/help/onboarding.json + docs/help/onboarding/* + docs/qa.png
electron/main.ts                       ← 新增 `help:get-faq` / `help:get-onboarding` / `help:get-qa-image` / `help:open-logs-dir` / `help:open-external` handler
electron/ipc/channels.ts               ← 新通道
README.md                              ← 顶部加 4 节导航
```

### 6.5 测试用例

| 场景                                              | 期望                                                  |
| ------------------------------------------------- | ----------------------------------------------------- |
| 「仪表盘」页点 `?`                                | 抽屉显示"代理状态指标含义"为默认展开项                |
| 「日志」页一条错误显示"API Key 无效"              | 旁边「打开设置更新 Key」直达「设置」且 Key 输入框聚焦 |
| 点「报告问题」→「复制诊断信息」                   | 剪贴板含版本/OS/日志，**不含**任何 API Key 明文       |
| 点「打开日志目录」                                | 系统文件管理器打开 `userData/logs/`，最新日志高亮     |
| 「完整常见问题」                                  | 12 条以内、默认全部折叠、可单条展开                   |
| 「帮助」抽屉点「加入交流群」                      | 弹出二维码弹窗，图片来自打包内的 `qa.png`             |
| 首次启动「首次设置」完成                          | 自动弹出「Codex 入门」抽屉，有「以后不再提醒」复选框  |
| 「仪表盘」点「看 5 分钟上手」                     | 抽屉展开入门步骤，Base URL 有「一键复制」按钮         |
| 入门抽屉点「一键复制」`http://127.0.0.1:11435/v1` | 剪切板内容为完整 URL，浮层提示已复制                  |

---

## 7. 主题 G — 多平台发布流程（mac + Windows 跨机协作）

### 7.1 现状与挑战

- 你只有一台 macOS 机器（这台），没有 Windows 物理机
- electron-builder 不支持在 macOS 交叉打包出可签名的 Windows 安装包（NSIS 需要 Windows 工具链才稳，wine 方案脆弱）
- GitHub Actions 可以同时跑 mac 和 windows runner，但你希望**保留手动控制权**（自己决定什么时候上线）

### 7.2 推荐方案：双轨并行（CI 自动 + 手动兜底）

**主轨：GitHub Actions 一次推 tag，全平台自动打包并上传 Release（强烈推荐）**

```
你在 Mac 上：
  1. git tag v1.0.0
  2. git push origin v1.0.0
       ↓
GitHub Actions 自动触发：
  ├─ macos-latest runner   → 打 dmg (x64 + arm64) + latest-mac.yml
  ├─ windows-latest runner → 打 exe (x64 + arm64) + latest.yml
  └─ 全部上传到同一个 Release v1.0.0
       ↓
release 自动 published，用户的 1.0.0 应用 5 秒后就能检测到 v1.0.1 升级
```

**优点**：

- 完全无需 Windows 物理机
- 双平台**同步发布**，避免 mac 用户先有新版、win 用户没有的尴尬
- 你只用敲 1 个 `git push` 命令
- 流程可审计：每个 release 在 GitHub Actions 都有完整构建日志

**缺点 / 注意事项**：

- 没有真正的 Windows 代码签名证书时 SmartScreen 会阻拦（README 已说明）；后续如要签名，把证书 base64 加到 GitHub Secrets，CI 里 import 即可
- 需要 `GITHUB_TOKEN`（默认就有）权限写 Release，无需额外配置

**辅轨：手动跨机操作（备用，万一 CI 出问题或没法用）**

如果你坚持要在另一台 Windows 机器上手动打包，按以下步骤：

```
Windows 机器（你或 Copilot 操作）：
  1. git clone https://github.com/Mark7766/codex-switch.git
  2. git checkout v1.0.0    # 切到对应 tag，保证版本一致
  3. pnpm install
  4. pnpm package:win       # 产出 release/*.exe + latest.yml
  5. 上传到 mac 已经创建好的同一个 Release：
     gh release upload v1.0.0 \
       "release/Codex Switch-Setup-1.0.0-win-x64.exe" \
       "release/Codex Switch-Setup-1.0.0-win-arm64.exe" \
       "release/latest.yml"
```

> **关键**：mac 和 win 必须基于**同一个 git tag** 打包，确保 `package.json` 里 version 一致。否则 electron-updater 会因为 latest-\*.yml 互相覆盖而出错。

### 7.3 推荐的实际操作流（v1.0.0 发布日）

**第一选择：纯 CI 自动**

```bash
# 在 Mac 上一气呵成
pnpm typecheck && pnpm test           # 本地最后一次校验
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin main
git push origin v1.0.0                # 触发 CI
# 然后去 GitHub Actions 喝杯咖啡等 10 分钟
# 全部产物自动出现在 Release 页面
```

**第二选择：mac 本地 + win CI 单独跑**

如果你想在 mac 上**先发 mac 包**给小范围用户灰度，几天后再发 win 包：

```bash
# Mac 上
pnpm package:mac                       # 本地打 dmg
gh release create v1.0.0-mac \
  --title "v1.0.0 (macOS only)" \
  --notes-file CHANGELOG-1.0.0.md \
  --prerelease \
  release/*.dmg release/latest-mac*.yml

# Windows 这边稳定后，手动 trigger CI build 或 win 机器打包，再上传到同一 release
```

> 注意：electron-updater **以 latest.yml 为准**判断 win 用户能否升级。Win 包没传时，win 用户不会发现 mac 那边已经发了；这正好可以做"半静默灰度"。

**第三选择：双机协作（你现在问的场景）**

```
Step 1 — Mac 端（你 + 我）：
  - 在 Mac 上 git tag v1.0.0 && git push --tags
  - 在 Mac 上 pnpm package:mac，产出 release/*.dmg + latest-mac*.yml
  - 我帮你执行：
      gh release create v1.0.0 -t "Codex Switch v1.0.0" -F CHANGELOG-1.0.0.md --draft
      gh release upload v1.0.0 release/Codex\ Switch-1.0.0-mac-*.dmg release/latest-mac*.yml
  - Release 保持 draft 状态（不公开），等 win 包上来一起发

Step 2 — Win 端（你换到 Windows + 那边的 Copilot）：
  - git clone <仓库>
  - git checkout v1.0.0
  - pnpm install && pnpm package:win
  - gh release upload v1.0.0 release/Codex\ Switch-Setup-1.0.0-win-*.exe release/latest.yml

Step 3 — 任意一端把 draft release 改为正式 published：
  - gh release edit v1.0.0 --draft=false
  - 此时 1.0.0 用户陆续被 electron-updater 通知升级
```

### 7.4 GitHub CLI（gh）准备

`gh` 是 GitHub 官方 CLI，跨平台可用，是发布最顺手的工具：

| 平台    | 安装                                                                                |
| ------- | ----------------------------------------------------------------------------------- |
| macOS   | `brew install gh`                                                                   |
| Windows | `winget install GitHub.cli` 或下载 [https://cli.github.com](https://cli.github.com) |

首次使用：

```bash
gh auth login
# 选 GitHub.com → HTTPS → 浏览器登录
```

登录后 `gh release upload` 等命令会自动复用 token。

### 7.5 镜像同步（让国内用户也能升级）

主题 E.E9 已设计好客户端镜像探测。**服务端这边什么都不用做**——客户端会自己尝试 `ghproxy.net` 等公共镜像。

如果将来想搭自建镜像（速度更稳）：

- 简易方案：用阿里云/七牛 OSS 写个 GitHub Webhook，每次 release 同步资产到 OSS
- 在 Settings → 镜像选择 → "自定义"里填你的 OSS URL

目前 v1.0.0 不做服务端镜像，靠公共 ghproxy 就够。

### 7.6 Release Notes 模板（每次发版复用）

`gh release create` 时使用模板：

```markdown
## Codex Switch v1.0.0

让 Codex CLI 和 Codex Desktop 无痛连接 DeepSeek 的桌面图形化代理。

### 下载

| 平台    | 架构                        | 下载                                          |
| ------- | --------------------------- | --------------------------------------------- |
| macOS   | Apple Silicon (M1/M2/M3/M4) | [Codex Switch-1.0.0-mac-arm64.dmg](...)       |
| macOS   | Intel                       | [Codex Switch-1.0.0-mac-x64.dmg](...)         |
| Windows | x64                         | [Codex Switch-Setup-1.0.0-win-x64.exe](...)   |
| Windows | arm64                       | [Codex Switch-Setup-1.0.0-win-arm64.exe](...) |

### 本版本变更

（粘贴 CHANGELOG.md 1.0.0 段落）

### 国内用户访问

若 GitHub 下载慢，本应用内置自动镜像加速，可直接打开应用→「检查更新」。
```

可写成 `.github/RELEASE_TEMPLATE.md` 由脚本注入。

### 7.7 风险与应对

| 风险                                                                   | 应对                                                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 双机打包时 git tag 不一致，latest.yml 与 latest-mac.yml 标的版本号不同 | 严格按"先 tag 再 checkout 再打包"；CI 加版本一致性脚本（已计划）                                  |
| Windows 机器没有 pnpm                                                  | 一行解决：`npm i -g pnpm@9.4.0`（README 加注）                                                    |
| draft release 忘了 publish，用户永远看不到                             | CI/手动操作 checklist 末尾必有「`gh release edit v1.0.0 --draft=false`」                          |
| 不同机器打出的 latest-\*.yml 互相覆盖                                  | mac 产出 `latest-mac.yml`+`latest-mac-arm64.yml`，win 产出 `latest.yml`，文件名不冲突，可安全并存 |
| Windows 上 keytar 编译失败                                             | electron-builder 会自动 prebuild-install；若失败，README 加注 "需要 Visual Studio Build Tools"    |

### 7.8 受影响文件

```
.github/workflows/release.yml (new)    ← tag 推送触发的多平台 publish 流水线
.github/RELEASE_TEMPLATE.md (new)      ← 每次 release notes 的模板
docs/RELEASING.md (new)                ← 发版手册（给你和 Copilot 跨机操作时查）
README.md                              ← 加"如何升级"段落给用户
```

> 注意：`docs/RELEASING.md` 是给开发者（你）看的发版 SOP；不要与给用户的 `README.md` / 应用内「常见问题」混在一起。

---

## 8. 优先级与发布范围

| 优先级   | 主题                                                                                                                    | 改动量           | UI       | 是否必上 1.0.0 |
| -------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------- | -------- | -------------- |
| **P0-A** | mapModel 修复 + 白名单 + 前缀 + 扩充默认表 + 迁移 + WARN 日志（主题 A 全部）                                            | ~80 行           | 否       | **必须**       |
| **P0-B** | 备份滚动保留 + 内容去重（B1 + B2）                                                                                      | ~40 行           | 否       | **必须**       |
| **P0-C** | 日志生命周期 + 错误翻译表 + 脱敏（C1 + C2 + C5 持久化）                                                                 | ~120 行          | 否       | **必须**       |
| **P0-D** | CHANGELOG.md + 版本升 1.0.0 + 「设置」版本记录弹窗（D1 + D3）                                                           | ~80 行           | 是（小） | **必须**       |
| **P0-E** | electron-updater 接入 + 检查/下载/安装流程 + 「设置」开关 + **镜像加速**（E1/E2/E5/E6/E8/E9）                           | ~200 行          | 是（小） | **必须**       |
| **P0-F** | 顶栏「帮助」抽屉 + 随页面智能帮助 + 常见问题（12 条）+ 报告问题 + 打开日志目录 + 二维码交流群 + Codex 入门向导（F1–F9） | ~320 行          | 是       | **必须**       |
| **P0-G** | release CI 流水线（tag 推送自动多平台打包+上传） + RELEASING.md 发版手册（G1/G2/G3）                                    | ~50 行（yml+md） | 否       | **必须**       |
| **P1-1** | 「日志」卡片重设计 + 统计条 + 过滤器（C3）                                                                              | ~150 行          | 是       | **必须**       |
| **P1-2** | 「设置」备份管理 GUI（B3 + B4）                                                                                         | ~120 行          | 是       | **必须**       |
| **P1-3** | 「仪表盘」近 5 分钟统计小窗（C4）                                                                                       | ~60 行           | 是       | **建议**       |
| **P1-4** | 首启「新版亮点」弹窗（D4）                                                                                              | ~50 行           | 是       | **建议**       |
| **P1-5** | 「仪表盘」升级徽标 + 下载进度条 + 升级提示弹窗（E3/E4/E7）                                                              | ~120 行          | 是       | **必须**       |
| **P1-6** | 极简风格全应用扫荡（F6.3 表格）：「日志」/「设置」/「仪表盘」修边幅、调色床、字号、间距                                 | ~80 行           | 是       | **必须**       |
| **P2-1** | 「设置」自定义模型映射 GUI（用户能自助加规则）                                                                          | ~100 行          | 是       | 留 v1.1        |
| **P2-2** | 400 自动重试 fallback 模型                                                                                              | ~40 行           | 否       | 留 v1.1        |
| **P2-3** | 增量/差量更新优化（macOS blockmap）                                                                                     | 调研             | 否       | 留 v1.1        |
| **P2-4** | 常见问题反馈收集（匿名上报）与运营分析                                                                                  | ~60 行           | 否       | 留 v1.1        |
| **P2-5** | 自建镜像服务器（阉于公共 ghproxy 不稳定时）                                                                             | OSS+Webhook      | 否       | 留 v1.1        |

**v1.0.0 发布范围 = P0 全部 + P1-1 / P1-2 / P1-5 / P1-6，P1-3 / P1-4 视进度。**

> 说明：「帮助」定位为 P0-F，因为面向完全不懂命令行的用户，「遇到问题能自救」与「代理能跑」同等重要。
> Release 流水线定位为 P0-G，因为没这个你业务上发不了版本；CI yml 文件一次写好后优先级上是一次性成本。

---

## 9. 测试策略汇总

### 8.1 单元测试（Vitest）

| 模块                          | 新增/修改用例                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `translate.mapModel`          | 见 1.3 的 6 条                                                                         |
| `codex/writer`                | 内容相同时不生成新备份；写入第 6 个备份时最老的被删除；备份+还原 round-trip 一致       |
| `proxy/errors`（新）          | 各类 DeepSeek 错误码 → 友好消息映射                                                    |
| `proxy/server`                | 生命周期日志含 reqId / phase / duration / model；reqId 在 success/error 中保持一致     |
| `config/store`                | mapping 版本迁移：旧版本启动后新增 key 被合并，用户自定义 key 不丢                     |
| `updater`（mock autoUpdater） | 版本比较：当前 == latest 不触发；当前 < latest 触发 update-available；下载失败上抛错误 |
| `help/faq.json`               | JSON Schema 校验；条数 ≤ 12；每条 q+a 长度限制                                         |
| `report-issue` 打包           | 脱敏检查：输入含 `sk-xxx` 的日志→输出不含明文 key                                      |

### 8.2 手动验证场景

1. Codex CLI 发 `model: 'gpt-5.4-mini'` → 不再 400，日志显示 WARN "已回退到 deepseek-v4-flash"，请求成功。
2. 连续重启代理 10 次 → `~/.codex` 下最多只有 5 个 config 备份 + 5 个 auth 备份；内容若未变则**完全不增加**备份。
3. 「设置」备份管理：点「还原」生效；点「删除」单条消失；点「一键清理」清空。
4. 杀掉网络发请求 → 「日志」卡片显示红色 ✗、原因 "无法连接到 DeepSeek"，且旁边出现「打开诊断」按钮（主题 F.F3）。
5. 首次启动 1.0.0（从 0.1.0 升级）→ 弹一次 What's New，关闭后不再弹。
6. 「设置」→ 关于 → 「查看版本记录」→ 看到 1.0.0 与 0.1.0 两段历史。
7. 模拟发布 v1.0.1 到 GitHub Release → 当前 v1.0.0 启动 5 秒后「仪表盘」出现升级徽标 → 点击 → 下载 → 进度条 → 完成 → 重启 → 自动安装为 v1.0.1（macOS arm64 + Windows x64 各跑一次）。
8. 任何页面点右上角 `?` → 抽屉默认项与当前页面匹配（主题 F.F1）。
9. 点「报告问题」→「复制诊断信息」→ 粘贴检查：含版本/OS/近 100 条日志，**不含**任何 `sk-*` 明文。

---

## 10. 风险与注意事项

| 风险                                                                          | 缓解                                                                                      |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 内容去重后用户手动改了 `~/.codex/config.toml` 但等价于模板 → 软件不再帮他备份 | 去重比对**写入前与目标文件**字节相等；若用户手动改成不同内容，下次仍会备份                |
| 滚动删除可能误删用户珍贵的备份                                                | 提供 `maxBackupsPerFile` 配置项；删除前所有备份按时间倒序明确日志输出                     |
| 实时日志推送可能 IPC 风暴（高 QPS 场景）                                      | 主进程节流：每 200ms 批量 flush 一次；渲染端虚拟列表                                      |
| `react-markdown` 增加包体积                                                   | 改用 30 行手写解析（仅支持 h2/h3/ul/li/em/code），CHANGELOG 受控不需要完整 markdown       |
| What's New 在企业批量部署场景下打扰用户                                       | 提供「不再提示」勾选；electron-store 持久化偏好                                           |
| 升级期间 Codex CLI 正在调用代理被打断                                         | 安装时机由用户决定（E5）；默认下次启动安装；强制立即重启时先优雅停止代理                  |
| macOS 未签名导致 electron-updater 拒绝                                        | 检测签名状态，未签名版本降级为「打开 Release 页」浏览器跳转（fallback）                   |
| GitHub Release 在中国大陆访问慢/失败                                          | 检查 10s 超时即放弃；提供「设置」「手动从镜像下载」入口（可放置 Gitee 镜像 URL，留 v1.1） |

---

## 11. 文档与发布配套

发布 v1.0.0 时同步更新：

1. `README.md` — 截图换成 v1.0.0、强调"成功/失败一目了然"、"备份自动清理"，加"如何升级"段落
2. `CHANGELOG.md` — 见 D1
3. `docs/RELEASING.md` — 主题 G 的发版手册，记录 mac+win 两机协作 SOP 与 CI 触发方式
4. GitHub Release v1.0.0 — body = `.github/RELEASE_TEMPLATE.md` 渲染 + CHANGELOG 1.0.0 段落 + 下载链接矩阵（mac x64/arm64、win x64/arm64）+ `latest-mac.yml` / `latest.yml` 等 electron-updater 元数据文件
5. `.github/agent/memory/decisions-log.md` — 记录"模型映射改为白名单+前缀"、"日志改为请求生命周期模型"、"自动升级走 electron-updater + GitHub Provider + 国内镜像 fallback"、"发版走 GitHub Actions release.yml 双平台 publish always"四条架构决策
6. `.github/agent/memory/project-memory.md` — 当前版本字段更新到 1.0.0；新增"升级链路"段落说明走 GitHub Releases + ghproxy 镜像兜底
7. CI 流水线 — `.github/workflows/release.yml` tag 推送时自动 `--publish always`；加 tag-version 一致性校验步骤

---

## 12. 受影响文件总览（v1.0.0 范围）

```
electron/proxy/translate.ts        ← 主题 A
electron/proxy/server.ts           ← 主题 A + C
electron/proxy/stream.ts           ← 主题 C（错误体回传）
electron/proxy/errors.ts (new)     ← 主题 C
electron/codex/writer.ts           ← 主题 B
electron/codex/restore.ts (new)    ← 主题 B
electron/config/store.ts           ← 主题 A + D
electron/main.ts                   ← IPC handler 注册
electron/ipc/channels.ts           ← 新通道
src/pages/Settings.tsx             ← 主题 B + D + E（自动检查开关、检查更新按钮）
src/pages/Logs.tsx                 ← 主题 C
src/pages/Dashboard.tsx            ← 主题 C（小窗）+ 主题 E（升级徽标 + 下载进度条）
src/components/ChangelogModal.tsx (new) ← 主题 D
src/components/UpdateModal.tsx (new)    ← 主题 E
electron/updater/index.ts (new)    ← 主题 E（electron-updater 封装）
src/App.tsx                        ← 主题 D（What's New 触发）
src/types/global.d.ts              ← 新 IPC 类型
tests/unit/translate.test.ts       ← 主题 A
tests/unit/writer.test.ts (new)    ← 主题 B
tests/unit/errors.test.ts (new)    ← 主题 C
CHANGELOG.md (new)                 ← 主题 D
docs/help/faq.json (new)           ← 主题 F（中文常见问题）
docs/qa.png                        ← 主题 F.F8（咨询群二维码，已存在）
docs/RELEASING.md (new)            ← 主题 G（发版手册，给开发者看）
src/components/HelpDrawer.tsx (new)      ← 主题 F
src/components/FaqList.tsx (new)         ← 主题 F
src/components/ReportIssueModal.tsx (new) ← 主题 F
src/components/QaGroupModal.tsx (new)    ← 主题 F.F8
src/components/HeaderBar.tsx (new)       ← 主题 F
electron/updater/mirrors.ts (new)        ← 主题 E.E9（镜像探测）
package.json                       ← version: 1.0.0 + dep: electron-updater + lucide-react
electron-builder.yml               ← extraResources: CHANGELOG.md + docs/help/faq.json + docs/qa.png + publish.github
.github/workflows/release.yml (new) ← 主题 G（tag 推送 → 多平台 publish）
.github/workflows/ci.yml           ← 主题 E（版本一致性校验）
.github/RELEASE_TEMPLATE.md (new)  ← 主题 G（release notes 模板）
README.md                          ← v1.0.0 文档更新（含"自动升级"与"常见问题"段落）
```
