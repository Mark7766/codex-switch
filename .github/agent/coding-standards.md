<!-- ai-coding-ok: v2.2.0 -->
# 📏 Codex Switch — 编码规范

> 所有人类和 AI 提交的代码都应遵守本文件中的规范。
> 本项目使用 TypeScript + Electron + React，规范以此为前提书写。

---

## 1. 通用规范

### 1.1 导入

```typescript
// Node 内建
import { createServer } from 'node:http'
import path from 'node:path'

// 第三方
import { app, BrowserWindow } from 'electron'
import Store from 'electron-store'

// 项目内部（@/ 别名指向 electron 或 src 根）
import { translateOpenAIToDeepSeek } from '@/electron/proxy/translate'
import type { ProxyConfig } from '@/electron/config/store'
```

- 导入分三组：Node 内建 → 第三方 → 项目内部，组间空一行
- 禁止使用 `import * as X`，除非确实需要命名空间
- 使用 `@/` 路径别名，禁止深层相对路径（`../../../`）
- 类型导入使用 `import type { ... }`

### 1.2 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 文件（模块） | kebab-case 或 camelCase | `proxy-server.ts` / `useProxyStatus.ts` |
| React 组件文件 | PascalCase | `Dashboard.tsx` |
| 类 / 类型 / 接口 | PascalCase | `ProxyConfig`, `CodexWriter` |
| 函数 / 方法 / 变量 | camelCase | `startProxy()`, `apiKey` |
| 常量 | UPPER_SNAKE | `DEFAULT_PROXY_PORT` |
| 私有成员 | `#field` 或 `_field` | `#privateState` |
| React Hook | use 前缀 + camelCase | `useProxyStatus()` |
| IPC 通道名 | namespace:action | `proxy:start`, `codex:restore-backup` |
| 环境变量 | UPPER_SNAKE | `CSC_LINK`, `CSC_KEY_PASSWORD` |

### 1.3 类型注解

```typescript
// ✅ 正确：严格、不写 any
export interface ProxyConfig {
  port: number
  modelMapping: Record<string, string>
}

export async function startProxy(config: ProxyConfig): Promise<void> {
  // ...
}

// ❌ 错误：使用 any
export function startProxy(config: any) { /* ... */ }

// ✅ 正确：未知输入用 unknown + 类型守卫
function isProxyConfig(v: unknown): v is ProxyConfig {
  return typeof v === 'object' && v !== null && 'port' in v
}
```

- 开启 `strict`、`noUncheckedIndexedAccess`
- 公共 API（导出的函数、类型、IPC 处理器）必须显式标注返回类型
- 禁止 `any`；外部输入用 `unknown` + 类型守卫
- 联合类型 / discriminated union 优先于继承

### 1.4 TSDoc（公共 API）

```typescript
/**
 * Start the local HTTP proxy that translates OpenAI-compatible requests
 * into DeepSeek API calls.
 *
 * @param config - Proxy port and model mapping.
 * @returns Resolves once the server is listening; rejects on bind failure.
 * @throws {ProxyPortInUseError} When the chosen port is already in use.
 */
export async function startProxy(config: ProxyConfig): Promise<void> { /* ... */ }
```

- 导出的函数 / 类 / 类型必须有 TSDoc
- 内部辅助函数可省略 TSDoc，但命名要自解释

### 1.5 错误处理

```typescript
// ✅ 正确：具体错误类型 + 给用户的友好消息
try {
  await startProxy(config)
} catch (err) {
  if (err instanceof ProxyPortInUseError) {
    log.warn('Port %d in use, retrying with %d', config.port, config.port + 1)
    return startProxy({ ...config, port: config.port + 1 })
  }
  log.error('Failed to start proxy', err)
  throw new UserFacingError('启动代理失败，请检查端口是否被占用或重启应用。', { cause: err })
}

// ❌ 错误：吞异常
try { await startProxy(config) } catch {}
```

- 自定义错误类继承 `Error` 并设置 `name`
- 面向用户的错误用 `UserFacingError`，渲染层把 `message` 直接展示
- 永远 `log.error(..., err)`；禁止 `catch {}`

### 1.6 日志（electron-log）

```typescript
import log from 'electron-log/main'

log.transports.file.level = 'info'
log.transports.console.level = 'debug'

log.info('Proxy started on %s:%d', host, port)
log.warn('Falling back to alternative port: %d', altPort)
log.error('Codex config write failed', { path }, err)

// ⚠️ 禁止：泄露密钥
// ❌ log.info('Using API key: %s', apiKey)
// ✅ 仅记录前缀
log.info('Using API key (prefix: %s***)', apiKey.slice(0, 4))
```

- 使用 `electron-log`，禁止 `console.log` 留在生产代码（dev 调试可临时用）
- 默认脱敏：`Authorization`、`api_key`、`sk-*`
- 日志文件路径：`app.getPath('logs')/main.log`

---

## 2. Electron 主进程规范

### 2.1 进程边界

```typescript
// electron/main.ts
const win = new BrowserWindow({
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,    // 必须 true
    nodeIntegration: false,    // 必须 false
    sandbox: true,             // 推荐
  },
})

// electron/preload.ts —— 唯一暴露给渲染层的桥
import { contextBridge, ipcRenderer } from 'electron'
import type { ProxyApi } from './ipc/channels'

const api: ProxyApi = {
  start: (config) => ipcRenderer.invoke('proxy:start', config),
  stop: () => ipcRenderer.invoke('proxy:stop'),
  onStatus: (cb) => ipcRenderer.on('proxy:status', (_e, s) => cb(s)),
}

contextBridge.exposeInMainWorld('codexSwitch', api)
```

- IPC 通道**必须在 `electron/ipc/channels.ts` 集中定义**并导出类型
- preload 只暴露**白名单**接口；不要 expose `ipcRenderer` 本身
- 渲染层访问主进程能力只能通过 `window.codexSwitch.*`

### 2.2 IPC 处理器

```typescript
// electron/ipc/proxy-handlers.ts
import { ipcMain } from 'electron'
import { startProxy, stopProxy } from '@/electron/proxy/server'

ipcMain.handle('proxy:start', async (_e, config: unknown) => {
  if (!isProxyConfig(config)) throw new Error('Invalid config')
  return startProxy(config)
})
```

- 所有 `ipcMain.handle` 入参都视为 untrusted，先做类型守卫
- 处理器**禁止抛出**带堆栈细节的内部错误到渲染层；用 `UserFacingError` 包装

---

## 3. React 渲染层规范

### 3.1 组件

```tsx
// src/pages/Dashboard.tsx
import { useProxyStatus } from '@/hooks/useProxyStatus'

export function Dashboard() {
  const { status, start, stop } = useProxyStatus()

  return (
    <main className="flex flex-col gap-4 p-6">
      <StatusBadge status={status} />
      {status === 'running' ? (
        <button onClick={stop} className="btn-secondary">停止代理</button>
      ) : (
        <button onClick={start} className="btn-primary">启动代理</button>
      )}
    </main>
  )
}
```

- 仅函数组件 + Hooks；禁止 class 组件
- 单文件一个主组件；辅助小组件放同一文件内或同目录
- 样式优先 Tailwind 原子类；只有重复模式才抽 `@apply` 组件类
- 所有面向用户的文案**使用中文**

### 3.2 状态管理

- 默认 `useState` / `useReducer`
- 跨页面共享按需引入 `zustand`（单 store，按 slice 拆分）
- 禁止引入 Redux / MobX / Recoil

---

## 4. 测试规范

### 4.1 测试命名

```typescript
// 格式：<被测对象> <场景> <期望>
describe('translateOpenAIToDeepSeek', () => {
  it('maps gpt-5-codex to configured deepseek model', () => { /* ... */ })
  it('passes through messages unchanged', () => { /* ... */ })
  it('throws when model has no mapping and strict mode is on', () => { /* ... */ })
})
```

### 4.2 测试结构（AAA 模式）

```typescript
import { describe, it, expect } from 'vitest'
import { translateOpenAIToDeepSeek } from '@/electron/proxy/translate'

it('maps model and preserves stream flag', () => {
  // Arrange
  const req = { model: 'gpt-5-codex', messages: [], stream: true }
  const mapping = { 'gpt-5-codex': 'deepseek-chat' }

  // Act
  const out = translateOpenAIToDeepSeek(req, mapping)

  // Assert
  expect(out.model).toBe('deepseek-chat')
  expect(out.stream).toBe(true)
})
```

### 4.3 Mock 策略
- 外部 HTTP：使用 `msw` 或 `vi.fn()` 拦截 `fetch`
- 文件系统：使用 `memfs` 或临时目录 `os.tmpdir() + 随机后缀`
- Electron API：在 `tests/setup.ts` 中 `vi.mock('electron', ...)`
- E2E：Playwright `_electron.launch`，每个测试独立 userData 目录

### 4.4 覆盖率

- 整体 ≥ 80%
- 核心模块（`electron/proxy/`、`electron/codex/`）≥ 90%
- 不为单纯透传函数追求 100%

---

## 5. Git 规范

### 5.1 Commit Message
- 遵循 Conventional Commits
- 格式：`<type>(<scope>): <subject>`（subject 英文，祈使句）
- 类型：`feat` / `fix` / `docs` / `style` / `refactor` / `test` / `chore` / `build` / `ci` / `perf`
- 常用 scope：`proxy` / `codex` / `ui` / `ipc` / `installer` / `config` / `e2e`

示例：
```
feat(proxy): support SSE streaming for /v1/chat/completions
fix(codex): backup config.toml before overwrite on Windows
chore(ci): add macos-latest to test matrix
```

### 5.2 分支策略
- `main`：稳定分支，每次合并即可发布
- `develop`：日常集成分支（可选）
- feature 分支：`feat/<short-desc>`
- fix 分支：`fix/<short-desc>`

---

## 6. 安全清单（每次 PR 自查）

- [ ] 没有任何 `apiKey`、`Authorization`、`sk-*` 出现在日志/IPC/UI 文案
- [ ] 渲染进程 `contextIsolation: true`、`nodeIntegration: false`
- [ ] 代理 `server.listen(port, '127.0.0.1')`，没有 `0.0.0.0`
- [ ] 所有 `ipcMain.handle` 都做了入参校验
- [ ] 修改 `~/.codex/*` 之前先备份
- [ ] 没有引入新的、不必要的 native 依赖（除非确实需要 keytar 等）
