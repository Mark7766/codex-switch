# Codex Switch v1.7.0 — 软件质量全面审计报告

- **审计日期**：2026-06-13
- **审计范围**：codex-switch（Electron 客户端）全量代码 + codex-switch-server（服务端安全相关）
- **审计维度**：架构结构、代码质量、安全、测试
- **审计方法**：4 个并行 Agent 独立扫描 → 交叉验证 → 综合评级
- **质量提升目标版本**：v1.8.0（本报告发现的问题将在 v1.8.0 中修复）

---

## 总体健康评级：🟡 需改进

| 维度       | 评级  | 关键指标                                                      |
| ---------- | ----- | ------------------------------------------------------------- |
| 架构与结构 | 🟡 C+ | 3 个文件超 400 行限制（最严重 1587 行），9 个函数超 50 行限制 |
| 代码质量   | 🟡 B- | 无循环依赖 ✅，但存在并发竞态、异常处理空洞                   |
| 安全       | 🟡 C+ | IPC 路径穿越、API Key 多份明文落盘、无 CSP                    |
| 测试       | 🔴 D  | 152 个单测全绿 ✅，但渲染层 0% 覆盖、main.ts 完全未测、无 E2E |

---

## 一、Critical 问题（必须修复）

### C1. `electron/proxy/server.ts` — 上帝对象（1587 行 / 400 行约束）

DeepSeekProxy 类承载了 HTTP 路由、WebSocket 处理、代理生命周期、协议转换、流式编排、对话历史、压缩、统计、遥测等全部职责。`handleWs` 方法 360 行、`handleResponses` 229 行。

**改进建议**：拆分为 `HttpRouter`、`WsHandler`、`ProxyLifecycleManager` 三个类，协议逻辑归入已有的 `translate.ts` / `stream.ts`。

### C2. 渲染层 0% 测试覆盖

19 个 `.tsx` 文件（全部 pages、components、Zustand store）完全没有测试。vitest 配置显式排除了 `src/` 目录。

**改进建议**：至少为 `store.ts`（Zustand 状态管理）和 `Settings.tsx`（用户最常交互的页面）增加 `@testing-library/react` + `vitest jsdom` 测试。

### C3. 无 E2E 测试

作为 Electron 桌面应用，零 Playwright/Spectron 端到端测试意味着每次发版前都必须依赖人工点击验证。

**改进建议**：用 Playwright for Electron 覆盖核心流程：Setup 向导 → 保存 API Key → 启动代理 → 发一次请求 → Dashboard 状态正确。

### C4. 无 Content-Security-Policy

`src/index.html` 没有 CSP `<meta>` 标签。一旦发生 XSS，攻击者可访问完整的 IPC 桥（API Key 管理、代理控制、进程终止、文件写入）。

**改进建议**：添加 `Content-Security-Policy` meta 标签，至少限制 `script-src 'self'`，禁止 inline script 和 `eval()`。

### C5. API Key 多处明文落盘

| 位置                                              | 风险                          |
| ------------------------------------------------- | ----------------------------- |
| `~/.codex/auth.json`                              | 明文 `OPENAI_API_KEY`         |
| `~/.claude/claude_desktop_config.json` 3P profile | 明文 `inferenceGatewayApiKey` |
| `~/.zshrc` / `~/.bashrc` 等 shell profile         | 明文 `ANTHROPIC_AUTH_TOKEN`   |

**改进建议**：shell profile 写入应作为旧版兼容保留，新安装仅写 `~/.claude/settings.json`（已在做）。长期方案：全部迁移到 OS keychain 引用。

---

## 二、High 问题（建议本版本修复）

### H1. IPC 路径穿越

`codexRestore`、`codexBackupDelete`、`claudeDesktopRestore` 等 IPC handler 接受 renderer 传来的路径字符串，仅做正则检查后缀（`.bak.\d+$`），未限制在允许的目录内。

**改进建议**：用 `path.resolve()` 解析后检查是否以 `codexDir()` 或 `claudeDir()` 开头。

### H2. Windows `setx` 命令注入

`electron/claude/env-writer.ts` 中 `execAsync(\`setx ${key} "${value}"\`)`—`value`源自用户可配置的`claudeCli.envVars`，可注入 shell 元字符。

**改进建议**：使用 `execFile` 替代 `exec`，拆分参数数组。

### H3. macOS 代码签名禁用

`electron-builder.yml` 中 `identity: null`、`hardenedRuntime: false`，导致 macOS 无法走 Squirrel.Mac 原子升级（ADR-013）。

**改进建议**：获取 Apple Developer ID 证书或至少启用 ad-hoc 签名（`identity: '-'`）。

### H4. `store.ts` / `secrets.ts` / `migrations.ts` 完全未测试

配置持久化、API Key 管理（含 keytar 回退逻辑）、v1.3.0/v1.6.0/v1.7.0 迁移全部零测试覆盖。

**改进建议**：至少覆盖 `migrateIfNeeded` 的核心分支和 `secrets.ts` 的 keytar→fallback 切换。

### H5. IPC 输入校验缺失

| Handler                             | 问题                                         |
| ----------------------------------- | -------------------------------------------- |
| `keySet`                            | 无 key 格式校验（非 string、空字符串都接受） |
| `proxyLookupPort` / `proxyKillPort` | 无端口范围校验                               |
| `prefsSet`                          | 无 schema 校验（`proxyPort: "abc"` 不报错）  |

**改进建议**：IPC handler 入口加 `typeof` + 范围 guard。

### H6. 并发状态访问竞态

`applyPreferencesTransaction()` 回滚可能覆盖其他 IPC handler 的并发修改。`enqueue()` 的 taskQueue 如果两个不同 IPC channel 同时触发，可能读到相同的旧基线。

**改进建议**：为 preferences 写入引入简单的 mutex（`writing` promise chain），或使用 electron-store 的事务 API。

---

## 三、Medium 问题（纳入技术债务跟踪）

### M1. 静默 catch 黑洞

多处 `.catch(() => {})` 或 `.catch(() => undefined)` 完全无日志，包括：

- `conversation-store.ts` flush 失败
- `persistentLog.ts` append 失败
- `server.ts` forceFlush 失败
- `server.ts` conversationStore.load 失败

**改进建议**：至少加 `log.warn('...', err.message)`。

### M2. 死代码

| 位置                                                   | 内容                    |
| ------------------------------------------------------ | ----------------------- |
| `channels.ts:3` `proxyStatus`                          | 定义但从未使用          |
| `channels.ts:7` `proxyLog`                             | 定义但从未使用          |
| `translate.ts` `VALID_DEEPSEEK_MODELS`、`PREFIX_RULES` | 导出但无外部引用        |
| `main.ts` `void dialog`                                | 抑制 unused import 警告 |

### M3. IPC 常量双重维护

`electron/preload.ts` 内联了完整的 IPC channel map（53 行），与 `electron/ipc/channels.ts` 重复。注释说"避免打包进 asar 后依赖加载链断裂"，但没有自动化检查保证两边一致。

**改进建议**：加一个 vitest 测试，断言 preload.ts 的 IPC 对象与 channels.ts 一致。

### M4. Server 端 admin session 永不过期

`itsdangerous` 的 `s.loads()` 未传 `max_age`，admin 登录 cookie 理论上可永久复用。默认 admin token 为 `"change-me"`。

**改进建议**：服务端加 `max_age=86400` 校验。

### M5. `electron-store` 和 `keytar` 已过时/不再维护

`electron-store@8.x` 已 deprecated，`keytar@7.x` 最后更新于 2021 年。

**改进建议**：评估迁移到 `@electron-toolkit/store` 或纯 JSON 文件方案。

---

## 四、亮点（已做对的事情）

1. ✅ **无循环依赖** — import 图完全无环，模块边界清晰
2. ✅ **代理只监听 127.0.0.1** — 无公网暴露风险
3. ✅ **日志脱敏系统** — `redactSensitive()` 统一过滤 sk-\* / Authorization / api_key
4. ✅ **API Key IPC 脱敏** — renderer 只拿到前 4 后 4 字符
5. ✅ **contextIsolation: true + nodeIntegration: false** — Electron 安全最佳实践
6. ✅ **translate.test.ts / errors.test.ts** — 纯函数充分测试，可作为单测范本
7. ✅ **遥测离线退避机制** — 3 次失败后指数退避，不影响代理主流程
8. ✅ **model_call 聚合上报** — 减少 99%+ HTTP 请求和 DB 写入
9. ✅ **任务队列串行化** — 代理 start/stop/restart 通过 promise chain 排队

---

## 五、改进优先级矩阵

| 优先级 | 问题                  | 投入    | 影响                    |
| ------ | --------------------- | ------- | ----------------------- |
| P0     | C1 拆分 server.ts     | 3-5 天  | 消除最大的可维护性债务  |
| P0     | C4 添加 CSP           | 30 分钟 | 一劳永逸消除 XSS 攻击面 |
| P1     | H1 路径穿越修复       | 1 小时  | 消除文件系统攻击面      |
| P1     | H2 Windows 命令注入   | 30 分钟 | 消除远程代码执行风险    |
| P1     | H5 IPC 输入校验       | 2 小时  | 防止配置损坏和异常行为  |
| P1     | H6 并发竞态修复       | 4 小时  | 消除数据丢失和不一致    |
| P2     | C3 E2E 测试           | 2-3 天  | 发版质量保障            |
| P2     | C2 渲染层测试         | 1-2 天  | 覆盖用户可见的 5 个页面 |
| P2     | M1 静默 catch 加日志  | 1 小时  | 大幅提升问题排查效率    |
| P3     | M2 死代码清理         | 30 分钟 | 减少认知负担            |
| P3     | M3 IPC 常量一致性检查 | 15 分钟 | 防止维护漂移            |
| P3     | M5 依赖更新评估       | 1 天    | 长期维护安全性          |

---

## 六、测试缺口总览

```
覆盖情况：
  electron/proxy/translate.ts   ████████████████████ 90%+
  electron/proxy/errors.ts      ████████████████████ 90%+
  electron/proxy/reasoning.ts   ████████████████████ 90%+
  electron/proxy/compact.ts     ████████████████░░░░ 80%
  electron/proxy/stream.ts      ██████████░░░░░░░░░░ 50%（仅 endTurn + compaction）
  electron/proxy/server.ts      ██████░░░░░░░░░░░░░░ 30%（仅 lifecycle + 4 HTTP 端点）
  electron/proxy/conversation-store ████████████████░░ 80%
  electron/proxy/persistentLog  ████████████████░░░░ 80%
  electron/proxy/portInfo       ████████████████░░░░ 80%
  electron/server-client/telemetry ██████████░░░░░░░░ 50%
  electron/server-client/client ░░░░░░░░░░░░░░░░░░░░ 0%
  electron/server-client/config ░░░░░░░░░░░░░░░░░░░░ 0%（仅内联工具函数）
  electron/claude/*             ████░░░░░░░░░░░░░░░░ 20%（writer 有测试但过度 mock）
  electron/codex/*              ██████████░░░░░░░░░░ 50%
  electron/config/*             ░░░░░░░░░░░░░░░░░░░░ 0%
  electron/updater/*            ░░░░░░░░░░░░░░░░░░░░ 0%
  electron/ipc/*                ░░░░░░░░░░░░░░░░░░░░ 0%
  electron/main.ts              ░░░░░░░░░░░░░░░░░░░░ 0%
  src/**/*.tsx                  ░░░░░░░░░░░░░░░░░░░░ 0%
  E2E                           ░░░░░░░░░░░░░░░░░░░░ 0%
```
