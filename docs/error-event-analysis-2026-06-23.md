# 生产环境 Error / Proxy Error 事件分析报告

- **日期**：2026-06-23
- **分析人**：Claude + wangliang
- **数据来源**：广州服务器 `telemetry_events` 表
- **时间范围**：2026-06-15 ~ 2026-06-23

---

## 一、proxy_error（代理错误）

### 概览

| 指标         | 值          |
| ------------ | ----------- |
| 事件总数     | 17          |
| 受影响客户端 | 6           |
| 时间范围     | 6/15 ~ 6/23 |

### 按日期分布

```
6/15: ███ 3
6/16: ████████ 8
6/17: 0
6/18: 0
6/19: 0
6/20: ██ 2
6/21: 0
6/22: 0
6/23: ████ 4
```

### 错误类型

| error_kind    | 数量 | 占比 | 端口                       |
| ------------- | ---- | ---- | -------------------------- |
| port-conflict | 13   | 76%  | 11435（12例）/ 7890（1例） |
| runtime       | 4    | 24%  | 11435                      |

### 按客户端分布

| 客户端             | 次数 | 时间             | 类型                      |
| ------------------ | ---- | ---------------- | ------------------------- |
| `eb7876f68404c093` | 4    | 6/23 00:54       | runtime                   |
| `809957b638318222` | 4    | 6/16 12:31~15:13 | port-conflict             |
| `0a3d29ff867a5a4e` | 4    | 6/16 10:05~12:53 | port-conflict             |
| `a420c85cc9368b04` | 2    | 6/15 14:20       | port-conflict             |
| `781bf64d0dee7f26` | 2    | 6/20 05:59       | port-conflict             |
| `a5b1fe08cb156c72` | 1    | 6/15 09:58       | port-conflict（端口7890） |

### 分析

1. **端口冲突是核心问题**：76% 的事件是 `port-conflict`，用户本地有其他程序占用了代理端口（11435）
2. **规模很小**：17 条记录 / 6 个用户，不是大规模故障
3. **重复上报**：同一客户端在短时间内多次上报（如 `eb7876...` 在 10 秒内报了 4 次），说明缺少客户端去重
4. **7890 端口异常**：1 例使用了非默认端口，说明该用户修改过配置但仍有冲突
5. **数据不完整**：properties 中缺少 `platform`、`app_version`、`error_message` 字段，无法定位根因

---

## 二、error（应用异常）

### 概览

| 指标         | 值          |
| ------------ | ----------- |
| 事件总数     | 101         |
| 受影响客户端 | 17          |
| 时间范围     | 6/15 ~ 6/22 |

### 按日期分布

```
6/15: ████████ 15
6/16: 0
6/17: ██ 4
6/18: █ 2
6/19: ████ 8
6/20: █████████████ 25  ← 暴增
6/21: █████████████ 25
6/22: ███████████ 22
```

### 错误类型

| error_type         | 数量 | 占比 |
| ------------------ | ---- | ---- |
| unhandledRejection | 79   | 78%  |
| uncaughtException  | 22   | 22%  |

### Top 受影响的客户端（占总量 76%）

| 客户端             | 次数 | 时间范围  | 集中时段                    |
| ------------------ | ---- | --------- | --------------------------- |
| `71e37070d942e4e5` | 33   | 6/19~6/21 | 6/21 晚 18:00~19:30（密集） |
| `ca53c2e985c0f981` | 19   | 6/20      | 6/20 凌晨~清晨              |
| `781bf64d0dee7f26` | 14   | 6/19~6/21 | 分散                        |
| `99b7c063a5213323` | 11   | 6/15~6/17 | 分散                        |

### 分析

1. **6/20 起突然暴增**：之前的日均个位数（0~8），6/20 飙升至 25 并持续高位
   - 与 v1.14.3 发布时间（约 6/20）高度吻合
   - 推测：新版本引入了未处理的 Promise rejection
2. **高度集中**：前 4 个客户端贡献了 77/101 = 76% 的错误
   - 不是普遍问题，是特定用户环境/操作触发
3. **数据严重缺失**：properties 中只有 `error_type` 和 `source`
   - 没有 `error_message` → 无法知道具体报什么错
   - 没有 `error_stack` → 无法定位代码行
   - 没有 `platform` / `app_version` → 无法按平台/版本定位
4. **`unhandledRejection` 占主导**（78%）：说明大量异步操作没有 `.catch()` 或 try/catch 包裹
5. **重复上报严重**：同一客户端 `71e37070...` 在 90 分钟内报了 33 次

---

## 三、数据质量问题

两个事件类型都存在严重的 properties 字段缺失：

| 应有字段                | proxy_error | error   |
| ----------------------- | ----------- | ------- |
| error_message           | ❌ 缺失     | ❌ 缺失 |
| error_stack             | ❌ 缺失     | ❌ 缺失 |
| platform (darwin/win32) | ❌ 缺失     | ❌ 缺失 |
| app_version             | ❌ 缺失     | ❌ 缺失 |
| error_type / error_kind | ✅ 有       | ✅ 有   |

---

## 四、解决方案（客户端改造建议）

以下改造在 **codex-switch 客户端（Electron）** 执行，不动服务端。

### 4.1 增强 Error 上报（P0）

```typescript
// 在 main process 入口注册全局错误捕获
process.on('uncaughtException', (error) => {
  telemetry.report('error', {
    error_type: 'uncaughtException',
    error_message: error.message,
    error_stack: error.stack?.slice(0, 500), // 截断防止过大
    platform: process.platform, // darwin / win32
    app_version: app.getVersion(),
  });
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : '';
  telemetry.report('error', {
    error_type: 'unhandledRejection',
    error_message: message,
    error_stack: stack?.slice(0, 500),
    platform: process.platform,
    app_version: app.getVersion(),
  });
});
```

### 4.2 增强 proxy_error 上报（P0）

```typescript
// 代理启动失败时上报
function reportProxyError(kind: 'port-conflict' | 'runtime', port: number, err?: Error) {
  telemetry.report('proxy_error', {
    error_kind: kind,
    port: port,
    error_message: err?.message || '',
    platform: process.platform,
    app_version: app.getVersion(),
  });
}
```

### 4.3 客户端去重/聚合（P1）

同一客户端同类型错误 5 分钟内只上报 1 次，用 `count` 字段聚合：

```typescript
const ERROR_DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const errorCache = new Map<string, { lastReported: number; count: number }>();

function shouldReportError(key: string): { should: boolean; count: number } {
  const now = Date.now();
  const cached = errorCache.get(key);
  if (cached && now - cached.lastReported < ERROR_DEDUP_WINDOW_MS) {
    cached.count++;
    return { should: false, count: cached.count };
  }
  errorCache.set(key, { lastReported: now, count: 1 });
  return { should: true, count: 1 };
}
```

### 4.4 端口冲突友好提示（P2）

代理启动前检测端口占用，给出中文提示：

```typescript
async function checkPort(port: number): Promise<boolean> {
  try {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, () => {
        server.close();
        resolve();
      });
    });
    return true; // port available
  } catch {
    dialog.showErrorBox(
      '端口冲突',
      `端口 ${port} 已被占用。请在 Codex Switch 设置中更换端口，或关闭占用该端口的程序后重试。`,
    );
    return false;
  }
}
```

### 4.5 排查 v1.14.3 的 unhandledRejection（P0）

1. 对比 v1.14.3 的 git diff，重点检查：
   - 新增的 `fetch` / `axios` / IPC 调用是否都有 `.catch()`
   - 新增的 `async` 函数是否都有 try/catch
   - Electron IPC `invoke` / `handle` 的错误处理
2. 在开发环境开启 `--enable-logging` 复现
3. 重点关注 client `71e37070...`、`ca53c2e9...` 的报错时间对应的用户操作路径

---

## 五、优先级与分工

| 优先级 | 任务                                                          | 类型       | 影响                       |
| ------ | ------------------------------------------------------------- | ---------- | -------------------------- |
| 🔴 P0  | `error`/`proxy_error` 上报附带 message/stack/platform/version | 客户端改动 | 解决当前无法定位根因的问题 |
| 🔴 P0  | 排查 v1.14.3 unhandledRejection 根因                          | 客户端排查 | 6/20 起暴增 5 倍的核心原因 |
| 🟡 P1  | 客户端 error 去重/聚合（5 分钟窗口）                          | 客户端改动 | 减少无效数据噪音           |
| 🟢 P2  | 代理启动前端口检测 + 友好提示                                 | 客户端改动 | 改善用户体验               |
| ⬜ P3  | 服务端 error 分析（有了 message 后再做）                      | 服务端     | 按错误消息分类展示         |

---

## 六、后续跟踪

- 客户端改造完成后，观察 1 周的 error 数据
- 关注 `unhandledRejection` 数量是否回落
- 有了 `error_message` 后再做一次分类分析，定位高频错误
