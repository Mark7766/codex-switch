# 稳定性优化方案 v1.1.0（第二版）

> **状态**：✅ Review 已通过 · **目标版本**：v1.1.0
> **变更说明**：相比第一版扩充两大主题——主面板数据持久化（#5）、代理控制可靠性深审（#6）。安装量统计已从本方案移除（不开发服务端）。
> **范围**：稳定性 / UX / 可观测性，不动协议代理与升级链路。

---

## 0. 背景

v1.0.x 在真实用户那边暴露 6 个稳定性问题，全部指向同一个核心：**Codex Switch 的"代理状态"必须可信、可控、可恢复**。

| # | 现象 | 用户感知 | 严重度 |
|---|------|----------|--------|
| 1 | 端口被占自动 11435→11436→…，但 `~/.codex` 仍写 11435 | "代理是绿的，但 Codex 用不了" | 🔴 阻塞 |
| 2 | 设置页两个按钮 `保存偏好` / `重新写入 ~/.codex`，常忘点第二个 | 改完端口 Codex 仍连旧端口 | 🔴 阻塞 |
| 3 | 日志只在内存（500 条），重启即丢 | 出问题想回看，"昨天那条错没了" | 🟡 体验 |
| 4 | 双击图标可同时打开多个 Codex Switch | 后启动者绑 11436+，撞 #1 | 🔴 阻塞 |
| 5 | **主面板请求数 / 运行时长 / 近 5 分钟统计每次重启清零** | "我用了一周，怎么显示 0 次？" | 🟡 体验 |
| 6 | **`启动代理` / `停止代理` 按钮"控制不好使"**——按钮显示停止但端口仍在 / 显示运行但请求 502 | "点了没反应"、"显示绿色但 Codex 连不上" | 🔴 阻塞 |

本提案围绕以上 6 点，给出最小改动、零新运行时依赖的稳定性方案。

---

## 1. 设计原则

1. **端口契约神圣化**：用户看到的端口 = `~/.codex` 写的端口 = 代理实际监听的端口，三者只能同时变。
2. **保存即生效**：一次"保存"完成全部副作用（store + `~/.codex` + 代理重启），用户不当流程编排器。
3. **状态即真相**：UI 上的红/绿灯必须反映**端口实际是否在监听**，不是代理对象的内部 flag。
4. **可观测性持续化**：日志、统计计数、运行时长都要跨重启可回看，磁盘占用可控。
5. **进程唯一**：同时只能跑一个，重复启动 → 礼貌劝退 + 聚焦已有窗口。
6. **零新运行时依赖**：能用 Node 内建 / 已有依赖（electron-log / electron-store）的不引第三方。

---

## 2. 问题 1：端口冲突自动 +1 的私自换号

### 2.1 现状（[electron/proxy/server.ts](../electron/proxy/server.ts) L168–L209）

```ts
private listenWithRetry(startPort: number): Promise<number> {
  // EADDRINUSE → port + 1，最多 10 次
}
```

### 2.2 新流程

```
点击启动 → 绑 127.0.0.1:11435
   ├─ 成功 → 状态=运行中
   └─ EADDRINUSE → 弹窗（占用进程 PID + 路径）
        ├─ [关闭该进程并重试 11435]   → SIGTERM (5s) → SIGKILL → 重绑
        ├─ [打开设置改端口…]          → 跳设置页
        └─ [取消]                     → 状态=停止
```

**绝不自动 +1，绝不自动换端口。**

### 2.3 改动

| 模块 | 改动 |
|------|------|
| `electron/proxy/server.ts` | 删 `listenWithRetry` 重试循环，改名 `listenStrict(port)`，EADDRINUSE 直接 reject 带 `code` |
| `electron/proxy/portInfo.ts`（新建） | 跨平台占用进程探测：mac/linux 用 `lsof -nP -iTCP:<port> -sTCP:LISTEN`；win 用 `netstat -ano \| findstr :<port>` + `tasklist /FI "PID eq <pid>"`。**只读**，`execFile` + 数组参数 |
| `electron/main.ts` | `IPC.proxyStart` 捕获 EADDRINUSE → 调 `portInfo.lookup` → 把 `{ error, occupant }` 返回给渲染层 |
| `electron/main.ts` | 新增 `IPC.proxyKillPort({ pid })` |
| `src/components/PortConflictModal.tsx`（新建） | 弹窗 UI |

### 2.4 安全约束

- `proxyKillPort` **只接受 `lookup` 返回的候选 PID**；前端不可塞任意 PID。
- kill 前再 `lookup` 一次确认 PID 仍占用目标端口。
- 黑名单：`pid===1` / `pid===process.pid` / 命令行含 `launchd` `WindowServer` `systemd`。
- 校验 uid 等于当前进程 uid，跨用户拒绝并置灰按钮。

### 2.5 弹窗文案

```
端口 11435 被占用

占用程序：Codex Switch（旧实例）
  PID: 12345
  路径: /Applications/Codex Switch.app/Contents/MacOS/Codex Switch

可能是上一个 Codex Switch 没正常退出。建议关闭它后重试。

  [关闭该进程并重试 11435]   [改用其它端口…]   [取消]
```

属于黑名单或异用户时按钮置灰：`无法自动结束此进程，请手动结束或改用其它端口`。

---

## 3. 问题 2：保存偏好 + 重新写入 ~/.codex 双按钮

### 3.1 现状（[src/pages/Settings.tsx](../src/pages/Settings.tsx) L165–L176）

两个按钮 `保存偏好` 与 `重新写入 ~/.codex`。

### 3.2 新设计

合并为单按钮 **`保存并应用`**，主进程**事务化**：

1. `setPreferences(form)` → store；
2. 端口 / 模型 / API Key 任一变化 → `writeCodexConfig({ proxyPort, model, apiKey })`；
3. 代理在跑 + 端口变化 → `proxy.restart(newPort)`，串入 §2 的端口冲突处理；
4. 代理停止 + 端口变化 → 仅更新 store + `~/.codex`。

### 3.3 改动

| 模块 | 改动 |
|------|------|
| `src/pages/Settings.tsx` | `savePrefs` + `rewriteCodex` → `saveAndApply()`，删第二个按钮 |
| `electron/main.ts` | 新增 `IPC.prefsApply`：store → `~/.codex` → 必要时 restart proxy → 返回新状态 |
| `electron/proxy/server.ts` | 新增 `restart(port)` 内部 `stop()` + `start()`（依赖 §6 强化版） |

### 3.4 失败回滚

- 写 `~/.codex` 成功但代理重启失败：红 toast `端口被占用，已保存设置但代理未启动，请处理冲突后再启动`，**不回滚** `~/.codex`（它是用户期望的目标态）。
- 写 `~/.codex` 失败：整体失败，`setPreferences(oldPrefs)` 回滚 store。

### 3.5 文案

- 主：`保存并应用`
- tooltip：`保存设置、重写 Codex 配置文件、并按需重启代理`
- 成功：`✓ 设置已保存并生效（代理已重启 / Codex 配置已更新）`

---

## 4. 问题 3：日志没有持久化

### 4.1 现状（[electron/main.ts](../electron/main.ts) L25–L47）

仅内存 `logBuffer`（上限 500 条），重启即清空。

### 4.2 新设计

**格式 / 位置 / 滚动**

- JSON Lines：`app.getPath('userData')/logs/proxy-log.ndjson`。
- 单文件 ≤ **10 MB**；超过滚动 `proxy-log.1.ndjson` → `.2` → ... → `.4`，最多保留 4 个历史 + 1 个当前 → 总上限 **50 MB**。
- 单一 `fs.createWriteStream(path, { flags: 'a' })`，写入前 `redactSensitive`。
- 启动时若总占用超出 50 MB（用户调整阈值或文件未轮转干净），从最旧的 `.4` / `.3` 起逐个删除直到达标。

**启动加载**：从最新 ndjson 反向读最后 N=500 条灌入 `logBuffer`。> 1 MB 跳读最后 1 MB 按 `\n` 边界。

**新 IPC**：`logs:exportZip` / `logs:clearPersisted` / `logs:openDir` / `logs:getStats`。

**UI 改动**（[src/pages/Logs.tsx](../src/pages/Logs.tsx)）：增加 `[导出全部]` `[打开日志目录]` `[清空历史]`；顶部状态条 `本地已保留 X.X MB / 上限 50 MB`。

### 4.3 改动

| 模块 | 改动 |
|------|------|
| `electron/proxy/persistentLog.ts`（新建） | 单例：`appendLog` / `loadTail` / `clearAll` / `getStats` / `exportZip` |
| `electron/main.ts` | `proxy.on('log')` 追加一行；启动时 `logBuffer.push(...await loadTail(500))` |
| `electron/ipc/channels.ts` / `preload.ts` / `src/types/global.d.ts` | 同步新通道 |

### 4.4 降级

- 写盘失败：`electron-log.warn`，代理不受影响，UI 顶部黄横幅 `日志写盘暂不可用：<原因>`。
- ndjson 坏行：`try/catch` 跳过 + warn。

---

## 5. 问题 4：可同时打开多个 Codex Switch

### 5.1 现状

[electron/main.ts](../electron/main.ts) L264 没有 `app.requestSingleInstanceLock()`。多实例会抢同一 11435（撞 §2）、并发污染备份目录、并发读写 `electron-store`（无并发保证）。

### 5.2 新设计

```ts
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send(IPC.appOnSecondInstance);
  }
});
```

### 5.3 用户感知

- Dock / 任务栏二次双击 → 主窗口弹到最前 + 顶部 2 秒 toast `Codex Switch 已经在运行`。
- `app.on('activate')` 也优先 `mainWindow.show()`，不再 `createWindow()`。

### 5.4 边界

- `cmd+Q` 后再启动：锁随进程退出自动释放。
- 崩溃幽灵锁：Electron 实现基于 IPC，进程消失自动释放。

---

## 6. 问题 5：主面板数据没有持久化（**新增**）

### 6.1 现状

[src/pages/Dashboard.tsx](../src/pages/Dashboard.tsx) 显示三组数据，**全部活在 `DeepSeekProxy` 实例的内存里**：

| 数据 | 出处 | 持久化情况 |
|------|------|------------|
| 处理请求数（累计） | `this.stats.total` | ❌ 进程退出即清零 |
| 运行时长 | `Date.now() - this.startedAt` | ❌ 每次 start 重置 |
| 近 5 分钟成功率 / 平均耗时 | `this.stats.recent[]` 滑动窗口 | ❌ 进程退出即清零 |
| 最近一次错误 | `this.stats.lastError` | ❌ 进程退出即清零 |

用户感受："明明用了一周，每天都在看主面板，怎么数字老是从 0 开始？这软件没在工作？"

### 6.2 新设计

#### 6.2.1 字段分层

把"统计数据"拆为三类，分别处理：

| 类别 | 含义 | 是否持久化 |
|------|------|------------|
| **生命周期累计** | 自首次安装以来的累计请求数、累计运行时长（小时） | ✅ 持久化到 `electron-store`，跨重启累加 |
| **本次会话** | 本次进程启动以来的请求数、本次运行时长 | ❌ 内存即可（语义上就是"这次") |
| **近 5 分钟滑窗** | 近 5 分钟请求数 / 成功率 / 平均耗时 / 最近错误 | ❌ 内存即可（短窗口语义） |

#### 6.2.2 持久化策略

- 字段加到 [electron/config/store.ts](../electron/config/store.ts) 的 `UserPreferences`：
  ```ts
  lifetimeRequestCount: number;     // 累计请求数
  lifetimeUptimeSec: number;        // 累计运行时长（秒）
  lifetimeFirstStartAt: number;     // 首次启动时间戳
  lastSessionEndedAt: number;       // 上次正常关闭时间戳
  ```
- **写入时机**：节流到 **30 秒一次**（避免每条请求都写盘）：proxy 内部一个 30s 定时器把 `delta` flush 到 store；`stop()` 与 `before-quit` 触发立即 flush。
- **运行时长累加**：`uptimeAccum += Date.now() - lastFlushAt`，避免长会话单次落盘超量。
- **最近错误**：单独存 `lastErrorMessage` + `lastErrorAt`，便于"上次崩溃时间"展示。

#### 6.2.3 主面板 UI 重构

```
┌─────────────────────────────────────────────┐
│ 本地代理   ● 运行中 · 127.0.0.1:11435  [停止]│
│                                              │
│ ┌─ 本次会话 ─────────────────────────────┐  │
│ │ 处理 12 次  │ 运行 3分20秒 │ 协议 HTTP+WS │
│ └────────────────────────────────────────┘  │
│                                              │
│ ┌─ 近 5 分钟 ────────────────────────────┐  │
│ │ 5 次 │ 成功率 100% │ 平均 1.2 秒        │  │
│ └────────────────────────────────────────┘  │
│                                              │
│ ┌─ 累计 ─────────────────────────────────┐  │
│ │ 总请求 1,284 次 │ 总运行 47 小时         │  │
│ │ 自 2026-01-15 起                        │  │
│ └────────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

新增"累计"区块，让用户一眼看到自己长期使用的事实。

### 6.3 改动

| 模块 | 改动 |
|------|------|
| `electron/config/store.ts` | 新增 4 个字段 + migration |
| `electron/proxy/server.ts` | `stats` 结构拆分 lifetime / session / recent；新增 `lifetimeFlush()` 30s 定时器 |
| `electron/main.ts` | `before-quit` 调用 `proxy.lifetimeFlush()`；`proxyInfo` 返回新增 lifetime 字段 |
| `electron/ipc/channels.ts` / `preload.ts` / `src/types/global.d.ts` | `ProxyInfo` 类型扩展 |
| `src/pages/Dashboard.tsx` | 新增"累计"区块；标签从单一统计改为三层结构 |

---

## 7. 问题 6：代理控制按钮"不好使"（**深度审视，新增**）

> 用户反馈："停止代理后端口仍在响应"、"启动代理后 Codex 连不上"、"按钮点了没反应"。

### 7.1 现有控制链路（[electron/proxy/server.ts](../electron/proxy/server.ts)）

```
用户点 [启动] → IPC proxy:start → ensureProxy() → proxy.start()
                                                  ├─ if (status==='running'||'starting') return
                                                  ├─ status='starting'
                                                  ├─ listenWithRetry(11435)
                                                  └─ status='running'
用户点 [停止] → IPC proxy:stop  → proxy.stop()
                                  ├─ this.server=null; this.wss=null  ← ⚠️ 提前清空
                                  ├─ await wss.close()
                                  ├─ await server.close()             ← ⚠️ 等所有连接断
                                  └─ status='stopped'
```

### 7.2 经过仔细审查，发现 8 处真实缺陷

| # | 缺陷 | 用户实际感受 |
|---|------|--------------|
| **C1** | `stop()` 在 `await close` **之前**就把 `this.server` / `this.wss` 置 null。如果 close 回调因长连接（SSE / WebSocket）阻塞 60 秒以上，UI 已收到 status=stopped 但 OS 端口仍被占用。下次 start 撞 EADDRINUSE → 私自换号 11436。 | "我点了停止，代理灯灭了，但 11435 还能响应" |
| **C2** | `start()` 的 early-return：`if (status==='running'\|\|'starting') return this.actualPort`。但若上一次 start 在 listen 阶段 reject（status 变 'error'），再点启动时 status='error' 不命中 early-return —— **新建** 第二个 server 去 listen，而**前一次失败留下的引用**（理论上没 listen 成功不持有句柄，但若 wss 已挂了 connection listener 会泄漏）会累积事件监听器。 | "反复点启动后内存升高 / 偶发崩溃" |
| **C3** | `server.once('error', ...)` 只在 listen 之前监听一次。**listen 成功后就没有运行期错误监听**：socket 层 ECONNRESET 风暴、EMFILE（文件句柄耗尽）等会让 server 崩溃但 status 仍是 'running'，UI 显示绿灯，实际请求 502。 | "显示运行中但 Codex 报错连不上" |
| **C4** | 没有"端口实际监听"的健康自检。UI 红绿灯只看 `status` 字段，不看 `server.listening`。 | 同 C3 |
| **C5** | `stop()` 没有超时。SSE 流可以挂一两分钟；用户点了停止，但代理"还活着"。 | "点停止按钮没反应" |
| **C6** | `before-quit` 处理器：若 `await proxy.stop()` 抛错，`app.quit()` 不会被调用 → 主窗口已隐藏，进程僵死。 | "右上角点关闭按钮，App 看似消失但 Activity Monitor 里还在" |
| **C7** | UI 端 `toggle()` 失败默默吞错。`proxyStart` 抛异常 → `finally setBusy(false)` 复位按钮，但用户不知道**为什么失败**。 | "点启动按钮闪一下又恢复了，啥都没变" |
| **C8** | UI 用 1.5 秒轮询 `proxyInfo()` 取状态，期间真实状态可能已经变了 → 红绿灯抖动；启动失败的窗口期内 UI 还显示"正在启动"。 | "状态灯一闪一闪" |

### 7.3 新设计：把"端口实际在监听"作为唯一真相

#### 7.3.1 重写 `start()` / `stop()` 状态机

```ts
type ProxyStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

async start(): Promise<number> {
  // 互斥锁：所有状态切换走单一队列
  return this.serialize(async () => {
    if (this.status === 'running') return this.actualPort;
    if (this.status === 'starting' || this.status === 'stopping') {
      throw new Error('代理正忙，请稍候');
    }
    this.transition('starting');
    try {
      const port = await this.listenStrict(this.opts.port);
      this.actualPort = port;
      this.installRuntimeErrorHandlers();      // ← 新增 C3 修复
      this.startHealthCheck();                  // ← 新增 C4 修复
      this.transition('running');
      return port;
    } catch (e) {
      this.transition('error');
      throw e;
    }
  });
}

async stop({ timeoutMs = 3000 } = {}): Promise<void> {
  return this.serialize(async () => {
    if (this.status === 'stopped') return;
    if (this.status === 'stopping') return;
    this.transition('stopping');
    const server = this.server;
    const wss = this.wss;
    try {
      this.stopHealthCheck();
      // 先关 WS（中断流），再关 server，全部带超时
      await withTimeout(closeAll(wss), timeoutMs / 2);
      // 强制断开仍存在的 keep-alive socket
      this.destroyAllSockets();                 // ← 新增 C5 修复
      await withTimeout(closeServer(server), timeoutMs / 2);
    } finally {
      // 仅在 close 全部走完才清空引用 ← 修复 C1
      this.server = null;
      this.wss = null;
      this.actualPort = 0;
      this.transition('stopped');
    }
  });
}
```

要点：

- **C1 修复**：`this.server = null` 移到 `finally` 块、且在 close 完成之后；任何阶段 close 超时都通过 `destroyAllSockets()` 强行掐断 keep-alive，然后再清字段。
- **C2 修复**：所有状态切换串行化（`this.serialize` 内部一个 Promise 队列），杜绝并发 start。
- **C5 修复**：`stop` 默认 3 秒整体超时；超时后强制 `destroy` 所有 socket，**绝不让 stop 卡住 UI**。
- **C7/C8**：`start` / `stop` 抛错往上冒，IPC handler 捕获后通过新的 `IPC.proxyOnError` push 到渲染层做错误 toast。

#### 7.3.2 运行期错误监听（C3 修复）

```ts
private installRuntimeErrorHandlers(): void {
  this.server!.on('error', (err) => {
    this.log({ level: 'error', source: 'proxy', message: `运行期错误：${err.message}` });
    this.transition('error');
    // 触发自动重启（最多 3 次，间隔指数退避 1s/3s/9s）
    this.scheduleAutoRecover(err);
  });
  this.server!.on('clientError', (err, socket) => {
    socket.destroy();
  });
}
```

#### 7.3.3 健康自检（C4 修复）

```ts
private startHealthCheck(): void {
  this.healthTimer = setInterval(() => {
    if (!this.server?.listening) {
      // 状态字段说运行中但 socket 已挂
      this.log({ level: 'error', source: 'proxy', message: '健康检查：端口未在监听' });
      this.transition('error');
      this.scheduleAutoRecover(new Error('socket-not-listening'));
    }
  }, 5000);
}
```

健康检查每 5 秒一次；同时把 `server.listening` 直接作为 `proxyInfo` 的真实状态字段（而不是只看 `status`）。

#### 7.3.4 自动恢复（**有限次**）

- 健康检查 / runtime error 触发 `scheduleAutoRecover`：最多 3 次重启尝试，间隔 1s / 3s / 9s 指数退避。
- 三次都失败 → 状态停留在 `error` + 推送 `IPC.proxyOnError` → 渲染层 toast `代理意外退出且自动恢复失败，请手动重启或查看日志`，**不再无限重试**。
- 自动恢复事件在日志里以 `auto-recover` source 单独标记，便于事后排查。

#### 7.3.5 退出守护（C6 修复）

```ts
app.on('before-quit', async (e) => {
  if (proxy && proxy.getStatus() !== 'stopped') {
    e.preventDefault();
    try {
      await Promise.race([proxy.stop({ timeoutMs: 2000 }), sleep(2500)]);
    } catch (err) {
      log.warn('stop on quit failed:', (err as Error).message);
    }
    // 无论 stop 成功失败都要退出
    app.exit(0);
  }
});
```

`app.exit(0)` 不再触发 before-quit 二次循环。最多卡 2.5 秒就硬退出，绝不僵死。

#### 7.3.6 UI 反馈（C7/C8 修复）

- IPC `proxy:start` / `proxy:stop` 始终 await 到状态稳定后再返回，渲染层用返回值直接更新 store。
- 新增 `IPC.proxyOnError`（main → renderer，单向 push）：渲染层订阅后用红色 toast `代理出错：<reason>` 显示，附带 `[重试启动]` 按钮。
- Dashboard 红绿灯改读 `info.serverListening`（来自 `server?.listening`），不只看 `status`：
  - 🟢 绿灯：`status==='running' && serverListening===true`
  - 🟡 黄灯：`status==='starting' \|\| status==='stopping'`（带"…"动画）
  - 🔴 红灯：`status==='error'` 或 `running 但 !serverListening`，附"代理异常，[查看日志]"
  - ⚪ 灰灯：`stopped`

### 7.4 改动清单

| 模块 | 改动 |
|------|------|
| `electron/proxy/server.ts` | 串行队列、`stop` 超时、`destroyAllSockets`、运行期 error / clientError、健康检查、自动恢复 |
| `electron/main.ts` | `before-quit` 加 race + `app.exit(0)`；`proxyStart` / `proxyStop` IPC 错误传到渲染层；新增 `proxyOnError` push |
| `electron/ipc/channels.ts` / `preload.ts` | 新增 `proxy:on-error` |
| `src/pages/Dashboard.tsx` | 红绿灯逻辑改为 `serverListening` + status 双因子；订阅 `proxyOnError` 显示 toast |
| `src/components/Toast.tsx`（新建） | 通用 toast 组件 |

### 7.5 单测要点

- `start` 串行化：并发 5 次 `start()` 只产生 1 次 listen，4 次返回同一端口。
- `stop` 超时：构造一个挂着 SSE 的 socket，stop 应在 3s 内完成且端口立即释放。
- 运行期 server emit error → status 变 error → auto-recover 3 次后停留 error。
- 健康检查：手动 destroy server 后下一轮 tick 应 transition 到 error。
- `before-quit` race：proxy.stop 故意挂 10s，App 应在 ~2.5s 内 `app.exit`。

---

## 8. 总体改动清单

### 8.1 文件（预估 LOC，无新运行时依赖）

| 文件 | 状态 | 主题 | LOC |
|------|------|------|-----|
| `electron/main.ts` | 改 | §2 §3 §5 §7 | +160 / -40 |
| `electron/proxy/server.ts` | 改 | §2 §6 §7 | +180 / -50（新状态机 + 健康检查 + 自动恢复 + lifetime 统计） |
| `electron/proxy/portInfo.ts` | 新建 | §2 | +90 |
| `electron/proxy/persistentLog.ts` | 新建 | §4 | +160 |
| `electron/config/store.ts` | 改 | §6 | +30 |
| `electron/ipc/channels.ts` | 改 | §2 §3 §4 §5 §7 | +14 |
| `electron/preload.ts` | 改 | 同上 | +30 |
| `src/types/global.d.ts` | 改 | 同上 | +20 |
| `src/pages/Settings.tsx` | 改 | §3 §4 | +50 / -25 |
| `src/pages/Dashboard.tsx` | 改 | §6 §7 | +70 / -10 |
| `src/pages/Logs.tsx` | 改 | §4 | +50 |
| `src/components/PortConflictModal.tsx` | 新建 | §2 | +90 |
| `src/components/Toast.tsx` | 新建 | §5 §7 | +60 |
| `tests/unit/portInfo.test.ts` | 新建 | §2 | +80 |
| `tests/unit/persistentLog.test.ts` | 新建 | §4 | +120 |
| `tests/unit/server.lifecycle.test.ts` | 新建 | §7 | +180（串行化 / stop 超时 / health check / auto-recover） |

合计 **~+1500 / -125 LOC**，无新运行时依赖。

### 8.2 新 IPC 通道

| 通道 | 方向 | 主题 |
|------|------|------|
| `proxy:lookupPort` | renderer → main | §2 |
| `proxy:killPort` | renderer → main | §2 |
| `proxy:on-error` | main → renderer | §7 |
| `prefs:apply` | renderer → main | §3 |
| `logs:exportZip` | renderer → main | §4 |
| `logs:clearPersisted` | renderer → main | §4 |
| `logs:openDir` | renderer → main | §4 |
| `logs:getStats` | renderer → main | §4 |
| `app:on-second-instance` | main → renderer | §5 |

### 8.3 `UserPreferences` 新增字段

```ts
// §6 主面板持久化
lifetimeRequestCount: number;
lifetimeUptimeSec: number;
lifetimeFirstStartAt: number;
lastSessionEndedAt: number;
lastErrorMessage: string;
lastErrorAt: number;
```

---

## 9. 兼容性与迁移

| 项 | 影响 |
|----|------|
| v1.0.x → v1.1.0 | store 自动 migrate 新字段（默认值）；用户首次进入 Dashboard 看到累计=0 是正常的，从此开始统计；`lifetimeFirstStartAt` 设为 v1.1.0 首次启动当天，文案显示 `自 YYYY-MM-DD 起累计` |
| `~/.codex` | 格式不变，仅写入时机变 |
| 端口偏好 | 不动，默认仍 11435 |
| auto-update | 不动 ADR-013，darwin 仍走浏览器手动下载 |

---

## 10. 测试矩阵

### 10.1 单元（Vitest）

- `portInfo.lookup`：mock `execFile`，覆盖 mac/linux/win 解析、空输出、错误码。
- `persistentLog`：tmpdir 内 append → 滚动到 5 个文件 → 总量超 50 MB 触发删旧 → 坏行跳过 → `loadTail` 反向读尾部。
- `proxy.start` 串行化：并发 5 次只 listen 1 次。
- `proxy.stop` 超时：挂 SSE 的连接，stop 在 3s 内返回且端口释放。
- `proxy` 运行期 error：手动 emit error → status='error'，auto-recover 3 次后停留 error。
- `proxy` 健康检查：destroy server → 下一 tick transition 到 error。
- `proxy.lifetimeFlush`：30s 节流；stop 时强制 flush。
- `prefs:apply`：mock writeCodexConfig + setPreferences + proxy.restart，验证顺序。

### 10.2 手测（小白用户最关心）

1. ✅ 启动时 11435 被自己上次没退出的实例占用 → 弹窗 → 关闭并重试 → 在 11435 起来。
2. ✅ 启动时 11435 被无关进程占用 → 弹窗 → 改端口为 11500 → 保存并应用 → 代理在 11500 起来 + `~/.codex` 也是 11500。
3. ✅ 改端口时代理在跑 → 保存并应用 → 代理停 → 在新端口起 → `~/.codex` 同步 → Codex CLI 立刻可用。
4. ✅ 关闭 1 分钟再开 → 日志页能看到关闭前最后几条。
5. ✅ 已运行时双击图标 → 主窗口弹前台 + toast；不出现第二窗口。
6. ✅ 主面板"累计"区块在重启后保留，不归零。
7. ✅ 在 Codex 长时间流式输出中点 [停止代理] → 3 秒内端口确实释放（`lsof -i:11435` 为空）。
8. ✅ 模拟代理崩溃（kill 内部 server）→ Dashboard 红绿灯变红 + 自动尝试恢复 + 失败后红色 toast 提示。

### 10.3 E2E：暂不新增。

---

## 11. 不做的事（明确划界）

- ❌ 不改协议代理 / translate / reasoning / stream。
- ❌ 不引入 sqlite / leveldb，ndjson + electron-store 足够。
- ❌ 不做 mac 签名 / 公证（与 ADR-013 解耦）。
- ❌ 不"自动检测占用并直接 kill"，必须用户点确认。
- ❌ 弹窗不展示完整命令行 / 环境变量，只显示 PID + 进程路径。
- ❌ **不做安装量统计 / 任何 telemetry**：本期暂不开发服务端，客户端也不预埋上报代码；后续如要做需单独立项 + 隐私评审。
- ❌ 不给"出错时不自动重启"开关：自动恢复有限次（3 次）+ 失败后明确 toast 提示，已足够；引入开关只会增加用户困惑。
- ❌ 不保留"单独重写 ~/.codex"按钮：保存即应用，单一入口。

---

## 12. 上线节奏

| 步骤 | 产出 |
|------|------|
| 1. PR1：代理控制可靠性（§7）+ 单实例（§5） | v1.1.0-rc.1，**最高优先级**，直接堵稳定性大坑 |
| 2. PR2：端口冲突弹窗（§2） | 依赖 PR1 的新状态机 |
| 3. PR3：保存合并按钮（§3）+ 主面板累计（§6） | 用户体验类 |
| 4. PR4：日志持久化（§4） | 独立 |
| 5. 合并发 v1.1.0 | CHANGELOG 写明 6 项稳定性 / 体验改进 |

---

## 13. 风险与回滚

| 风险 | 缓解 |
|------|------|
| §7 自动恢复打架（与 §2 的 EADDRINUSE 弹窗）| 自动恢复仅在**已经成功 listen 过、运行期 crash** 的情况下触发；EADDRINUSE 一律走弹窗，不进入自动恢复 |
| `kill` 误杀别人的进程 | §2.4 强 PID 验证 + 黑名单 + uid 检查；最坏情况影响一次会话 |
| ndjson 大文件读尾部边界处理不对 | 单测覆盖；坏行 skip 不阻塞 |
| 50 MB 日志拖慢启动加载 | `loadTail` 只读尾部 1 MB，与总量无关；启动 I/O 可控 |
| `electron-store` 字段 migration 错误 | 单测覆盖；新字段加默认值，老字段不动 |
| 30s 节流的 lifetime 数据写盘和 setPreferences 并发 | 用一个 mutex 把写盘和读全量 prefs 串行化 |

---

## 14. Review 决议（已确认）

用户已对所有开放问题给出明确答复，本节作为方案的最终边界条件存档：

| # | 议题 | 决议 |
|---|------|------|
| 1 | §2.5 弹窗按钮顺序 | **`关闭进程并重试` 放第一位**（省事；破坏性已被 §2.4 的 PID 验证 + 黑名单 + uid 校验充分约束） |
| 2 | §4.2 日志保留量 | **总上限 50 MB**：单文件 10 MB × 5（1 当前 + 4 历史）。不在设置页做滑杆，硬编码即可，足够用 |
| 3 | §5.2 toast 时长 | 2 秒，按现案保留 |
| 4 | §3.2 是否保留 "危险按钮 ▸ 单独重写 ~/.codex" | **不保留**。保存即应用，单一入口，不留二级菜单 |
| 5 | §6.2 累计起算时间 | 设为 v1.1.0 首次启动当天，UI 文案 `自 YYYY-MM-DD 起累计`，不回填估算值 |
| 6 | §7.3.4 自动恢复策略 | 3 次 / 1s-3s-9s 退避维持。**不给用户开关**——失败后明确 toast 提示已足够，开关只会增加困惑 |
| 7 | §8 安装量统计 | **整个章节移除**：本期不做 telemetry，不预埋客户端上报代码，不部署服务端。后续如要做需单独立项 + 隐私评审 |

Review 已通过，可按 §12 顺序开 PR。
