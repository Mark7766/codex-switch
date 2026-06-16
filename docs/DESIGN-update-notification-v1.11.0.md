# Design: 自动更新 + 一键安装 — v1.11.0

- **日期**：2026-06-16
- **状态**：方案设计，待 Review
- **版本**：v1.11.0

---

## 1. 现状 vs 目标

### 1.1 当前更新流程（v1.11.0）

```
用户打开 Settings
  → 点"检查更新"
  → 等几秒，看到"发现新版本 v1.11.0"
  → 再点"下载更新"
  → 等下载完成
  → 再点"安装更新"
  → 完成
```

> 三步手动操作，每次都要用户主动想起来去 Settings。95% 用户不会走这个流程。

### 1.2 目标流程（v1.11.0）

```
用户打开 Codex Switch
  → 后台自动检查（启动时 + 每 6 小时）
  → 发现新版本 → 💛 右上角通知
  → 用户点击 → 完成
```

> 用户只需**点一次**。检查和下载全自动。

### 1.3 平台差异

macOS 未签名（`identity: null`），Squirrel.Mac 无法执行**原子替换安装**（ADR-013）。但**下载 DMG 文件不需要 Squirrel.Mac**——用 Node.js 原生 `https` 下载即可，和插件包下载完全一样。

| 步骤       |               Windows               |                       macOS                       |
| ---------- | :---------------------------------: | :-----------------------------------------------: |
| 自动检查   |                 ✅                  |                        ✅                         |
| 自动下载   |          ✅ NSIS 静默下载           |     ✅ 原生 `https` 下载 DMG 到 `~/Downloads`     |
| 右上角通知 |           ✅ "💛 可安装"            |                  ✅ "💛 可安装"                   |
| 一键安装   |        ✅ `quitAndInstall()`        |    ✅ 先退出应用 → 自动打开 DMG → 用户拖拽覆盖    |
| 下载方式   | `electron-updater.downloadUpdate()` | `https.get(url).pipe(fs.createWriteStream(path))` |

> 两端体验几乎一致：检查 → 下载 → 💛 通知 → 点一下完成。

---

## 2. 核心设计

### 2.1 自动更新开关

Settings 新增勾选框，文案**按平台显示不同**：

**Windows**：

```
┌─ 自动更新 ────────────────────────────┐
│  ☑ 自动下载并安装新版本                │
│    有新版本时自动下载，完成后通知你      │
│    一键安装                            │
└───────────────────────────────────────┘
```

**macOS**：

```
┌─ 自动更新 ────────────────────────────┐
│  ☑ 自动下载新版本                      │
│    有新版本时自动下载 DMG 到下载文件夹，  │
│    完成后通知你打开安装                  │
└───────────────────────────────────────┘
```

- **默认勾选**（新用户安装即自动）
- 关闭后，回到现有手动流程（检查 → 下载 → 安装）
- 存量用户升级到 v1.11.0 时，默认勾选

### 2.2 自动检查节奏

```
启动时         ─ 立即检查一次
每 6 小时      ─ 定时检查（仅在代理空闲时）
手动触发       ─ Settings 按钮保留
```

> 两种检查共用同一个 Server 端点，不分平台。

### 2.3 检查到新版本后的行为

```
                  ┌─ ON ──→ 两端都自动下载（Windows NSIS / macOS 原生 https）
检查到新版本 ────┤
                  └─ OFF ──→ 右上角不显示，Settings 里手动下载
```

> 两端行为一致，仅下载方式不同（NSIS vs 原生 https），对用户透明。

### 2.4 右上角通知（UpdateBadge 三态）

```
HeaderBar 右侧，两端统一：

  平时：                不显示
  下载中：              ↓ 45% · 2.1 MB/s
  下载完成：            💛 v1.11.0 可安装
```

### 2.5 点击后的操作

```
┌─────────────────────────────────────┐
│        Codex Switch v1.11.0         │
│            已下载完成                 │
│  ┌─ 更新内容 ──────────────────┐     │
│  │  🔌 Codex 离线插件一键安装    │     │
│  │  🧠 Claude Desktop 扩展支持  │     │
│  └─────────────────────────────┘     │
│                                      │
│  Windows：[ 立即安装并重启 ]           │
│  macOS：  [ 退出 Codex Switch 并打开 DMG ] │
│           拖入 Applications 覆盖即可      │
└─────────────────────────────────────┘
```

---

## 3. 技术设计

### 3.1 Server 端（已有，无需改动）

`POST /api/v1/update/check` 已返回 `update_highlights`。两端共用同一个端点。

### 3.2 客户端新增/修改

```
codex-switch/
├── electron/
│   ├── updater/
│   │   └── index.ts              # 修改：check() 后按平台自动下载或通知
│   └── main.ts                   # 修改：启动定时检查 + 代理空闲判断
├── src/
│   ├── components/
│   │   └── UpdateBadge.tsx       # 重写：按平台显示不同状态
│   ├── pages/
│   │   └── Settings.tsx          # 修改：增加自动更新勾选框（平台文案）
│   └── types/
│       └── global.d.ts           # 修改：UpdateEvent 增加 platform
```

### 3.3 检查到新版本后的处理

```typescript
// UpdaterManager.check() 的回调中
autoUpdater.on('update-available', (info) => {
  const prefs = getPreferences();
  if (!prefs.autoDownload) return; // 开关关闭，不打扰

  if (process.platform === 'win32') {
    // Windows：electron-updater 自动下载（NSIS）
    autoUpdater.downloadUpdate();
  } else {
    // macOS：不走 Squirrel.Mac（签名校验必败）
    // 用原生 https 下载 DMG 到 ~/Downloads
    downloadMacDmg(info.version);
  }
});
```

**macOS 下载实现**（和 PluginManager 同模式）：

```typescript
async function downloadMacDmg(version: string): Promise<void> {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const url = `${serverBaseUrl}/updates/Codex-Switch-${version}-mac-${arch}.dmg`;
  const savePath = path.join(app.getPath('downloads'), `Codex-Switch-${version}-mac-${arch}.dmg`);

  https.get(url, (res) => {
    // 跟随 302 到 COS
    const finalUrl = res.headers.location || url;
    const file = fs.createWriteStream(savePath);
    https.get(finalUrl, (cosRes) => {
      cosRes.pipe(file);
      // 每 500ms 读 fs.statSync 推送进度到 UpdateBadge
      // 完成后 emit 'downloaded'
    });
  });
}
```

> 下载链路：Server 302 → COS 广州，和插件包完全一致。不走 Squirrel.Mac。

### 3.4 UpdateBadge 统一三态

两端 UI 完全一致：

```typescript
// 收到 download-progress → 显示进度条
// 收到 downloaded → 显示 💛 按钮

function handleClick() {
  if (process.platform === 'win32') {
    autoUpdater.quitAndInstall(); // Windows 一键安装重启
  } else {
    // macOS：先退出应用（否则无法覆盖 /Applications/Codex Switch.app）
    // 再打开 DMG 文件，用户拖拽覆盖即可
    app.quit();
    shell.openPath(downloadedDmgPath);
  }
}
```

### 3.5 定时检查

```typescript
// main.ts — app.whenReady()
if (prefs.autoCheckUpdate) {
  // 启动后 5s 首次检查（给代理启动留时间）
  setTimeout(() => updater.check(), 5_000);

  // 每 6 小时检查一次
  setInterval(() => {
    // 仅在代理空闲时检查（无进行中的请求）
    if (!proxy || proxy.isIdle()) {
      updater.check().catch(() => {});
    }
  }, 6 * 3600_000);
}
```

> 两端共用相同定时逻辑。Windows 多一个 `autoUpdater.downloadUpdate()` 调用。

### 3.6 UpdateBadge 实现要点

```typescript
// 仅保留现有 'available' 事件处理，增加 'downloaded' 和 'download-progress'
// 'manual-download' 事件不再需要——macOS 用 'available' 代替

// Windows: 收到 'available' 时 autoUpdater 已在后台开始下载，等待 'download-progress'
// macOS:   收到 'available' 时直接显示 💛 按钮

function handleClick() {
  if (state === 'downloaded') {
    // Windows：已下载，直接安装
    window.codexSwitch.updateInstall();
  } else if (state === 'available') {
    // macOS：打开浏览器下载
    window.codexSwitch.openExternal('https://github.com/Mark7766/codex-switch/releases/latest');
  }
}
```

### 3.7 配置存储

```typescript
// UserPreferences 新增
autoDownload: boolean; // 默认 true
```

> 不新增 `UpdateReminderState`、skipCount、强制遮罩。极简。

---

## 4. 用户故事

> **小王**装 Codex Switch v1.10.0 一个月了。今天打开应用，右上角出现 💛 v1.11.0 可安装。他点了一下，弹窗显示更新内容（插件功能），点"安装并重启"，10 秒后应用重启，已经是 v1.11.0。他什么都没做，只是点了一下。

---

## 5. 对比总结

| 维度     | 旧流程                 |  新流程（Windows）   |      新流程（macOS）       |
| -------- | ---------------------- | :------------------: | :------------------------: |
| 步骤数   | 3 步（检查→下载→安装） |  **1 步**（点 💛）   | **2 步**（点 💛 → 拖 DMG） |
| 检查     | 手动去 Settings        | 自动（启动 + 每 6h） |    自动（启动 + 每 6h）    |
| 下载     | 手动点按钮             |   **自动静默下载**   |       自动打开浏览器       |
| 通知     | Settings 小字          |   右上角 💛 可安装   |       右上角 💛 可用       |
| 默认     | 不检查不下载           | 自动检查 + 自动下载  |      自动检查 + 通知       |
| 签名限制 | 无解                   |          —           |    依然无解（ADR-013）     |

> macOS 的 2 步比之前的 3 步省掉了"手动去 Settings 检查"这一步，且右上角 💛 主动提醒。

---

## 6. 实施顺序

| 步骤 | 内容                                                                                 |  估时  |
| :--: | ------------------------------------------------------------------------------------ | :----: |
|  1   | `electron/config/store.ts` 增加 `autoDownload` 字段                                  | 5 min  |
|  2   | `electron/updater/index.ts`：`check()` 后按平台分流（Windows 自动下载 / macOS 通知） | 15 min |
|  3   | `electron/main.ts`：启动自动检查 + 6h 定时器 + 代理空闲判断                          | 10 min |
|  4   | `src/components/UpdateBadge.tsx`：按平台三态 + 点击弹 highlights                     | 25 min |
|  5   | `src/pages/Settings.tsx`：勾选框 + 平台不同文案                                      | 10 min |
|  6   | Windows + macOS 两端验证                                                             | 20 min |

---

> 🤖 Generated with [Claude Code](https://claude.com/claude-code)
