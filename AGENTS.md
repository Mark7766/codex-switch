<!-- ai-coding-ok: v2.2.0 -->

# AGENTS.md — Codex Switch

## ⚠️ AI Agent 必读规范（每次任务必须执行）

本项目使用 [ai-coding-ok](https://github.com/Mark7766/ai-coding-ok) 三层记忆系统。**在执行任何任务之前，必须完成以下步骤：**

### Plan 阶段（强制，任务开始前）

1. 读取 `AGENTS.md` — 本文件，架构速查
2. 读取 `.github/agent/system-prompt.md` — Agent 人格、角色切换、行为边界
3. 读取 `.github/agent/workflows.md` — 场景工作流（Feature/Bug/Refactor/部署）
4. 读取 `.github/agent/coding-standards.md` — 编码规范
5. 读取 `.github/agent/memory/project-memory.md` — 项目事实和架构约束
6. 读取 `.github/agent/memory/decisions-log.md` — 历史技术决策
7. 读取 `.github/agent/memory/task-history.md` — 近期任务上下文

### Act 阶段（强制，任务结束后）

1. 更新 `.github/agent/memory/task-history.md` — 记录本次任务摘要
2. 如有架构决策变化 → 更新 `.github/agent/memory/decisions-log.md`
3. 如有项目事实变化 → 更新 `.github/agent/memory/project-memory.md`
4. 如 AGENTS.md / system-prompt.md / workflows.md / coding-standards.md 有事实性过时内容 → 同步更新对应文件

> ⛔ 以上步骤不可跳过。若在使用 superpowers brainstorming / writing-plans，
> 在调用这些 skill **之前**先完成 Plan 阶段，**结束后**完成 Act 阶段。

---

## 项目概述

**Codex Switch** 是一个 **跨平台桌面图形化代理工具（Electron 应用）**。它在本地启动一个 HTTP 代理服务，把 OpenAI 兼容协议（Codex CLI / Codex Desktop 使用的协议）的请求转发到 DeepSeek API，并自动写好 Codex 的本地配置文件，让完全不懂命令行的用户也能在 macOS / Windows 上**双击安装、点几下按钮**就把 Codex 接到 DeepSeek。

定位与对标：参考 Claude Desktop / VS Code / Discord 的 Electron 桌面应用形态，主打"零门槛"。

## 系统架构与数据流

```
 ┌───────────────────────┐      ┌────────────────────────────────────────┐
 │ Codex CLI / Desktop   │──▶──│ Codex Switch（Electron 主进程）         │
 │ （OpenAI Responses     │      │  ┌──────────────────────────────────┐  │
 │  API + WebSocket）     │      │  │ 本地代理（127.0.0.1:11435）       │  │
 └───────────────────────┘      │  │  ├─ HTTP /v1/responses 转换       │  │
                                │  │  ├─ WebSocket（Codex v0.132+）   │  │
                                │  │  ├─ 协议转换 Responses ⇄ Chat    │  │
                                │  │  ├─ 模型映射 (model mapping)     │  │
                                │  │  ├─ reasoning_content 跨轮回传    │  │
                                │  │  └─ SSE/流式响应转发              │  │
                                │  ├──────────────────────────────────┤  │
                                │  │ Codex 配置注入                    │  │
                                │  │  ├─ ~/.codex/config.toml         │  │
                                │  │  └─ ~/.codex/auth.json           │  │
                                │  ├──────────────────────────────────┤  │
                                │  │ 配置存储（electron-store JSON）   │  │
                                │  └──────────────────────────────────┘  │
                                │                                        │
                                │  Renderer（React + Tailwind）：        │
                                │   首次启动向导 / 状态面板 / 设置 / 日志│
                                └──────────────────┬─────────────────────┘
                                                   │ HTTPS
                                                   ▼
                                       ┌────────────────────────┐
                                       │   DeepSeek API         │
                                       └────────────────────────┘
```

- **`electron/main.ts`** — Electron 主进程入口，创建窗口、挂载托盘、启动代理。
- **`electron/proxy/`** — 本地代理（HTTP + WebSocket）与协议转换（OpenAI Responses ⇄ DeepSeek Chat Completions，支持流式 SSE，处理 `reasoning_content`）。**核心实现移植自参考工程** `/Users/mark/work/gitspace/opensource/codex-deepseek-installer/proxy/deepseek-proxy.mjs`，用 TypeScript 重写并融入 Electron 主进程。
- **`electron/codex/`** — Codex 配置注入，读写 `~/.codex/config.toml` 和 `~/.codex/auth.json`（权限 600）。
- **`electron/config/`** — 用户配置持久化（API Key、模型映射、端口），基于 electron-store。
- **`electron/ipc/`** — 主进程 ↔ 渲染进程 IPC 通道与 preload bridge。
- **`src/`** — Renderer，React + TypeScript + Tailwind，UI/UX 对齐 Claude Desktop 简洁风格。

## 常用命令

```bash
# 安装依赖
pnpm install

# 开发模式（Vite + Electron 热重载）
pnpm dev

# 测试
pnpm test                 # Vitest 单元测试
pnpm test:e2e             # Playwright 端到端测试
pnpm test:coverage        # 覆盖率报告

# 代码检查 & 格式化
pnpm lint                 # ESLint
pnpm format               # Prettier
pnpm typecheck            # tsc --noEmit

# 构建 / 打包
pnpm build                       # 编译主进程 + 渲染进程
pnpm package:mac                 # 生成 .dmg（macOS）：x64 + arm64 两个分包
pnpm package:mac:universal       # 生成 universal .dmg（一个包通吃 Intel + Apple Silicon）
pnpm package:win                 # 生成 NSIS .exe 安装包（Windows）：x64 + arm64 两个分包
pnpm package:all                 # 多平台一键打包（CI 使用）
```

## 约定与模式

- **语言统一**：所有代码使用 TypeScript（`strict: true`），禁止 `any`，必要时用 `unknown` + 类型守卫。
- **进程边界**：主进程负责文件系统、网络代理、Codex 配置；渲染进程**只通过 IPC** 间接访问系统资源，禁止开启 `nodeIntegration`，必须使用 `contextIsolation: true` + preload bridge。
- **安全默认**：所有 IPC 通道使用白名单；DeepSeek API Key 走 OS 凭据存储（keytar）或加密的 electron-store，**绝不**明文写入日志。
- **代理端口**：默认 `127.0.0.1:11435`（与参考工程 codex-deepseek-installer 保持一致，便于已有用户迁移），仅监听 loopback，禁止暴露到公网。
- **日志**：使用 `electron-log`，按级别 (debug/info/warn/error) 分文件；请求日志默认脱敏 Authorization。
- **UI 风格**：参考 Claude Desktop，简洁、白底/暗黑双主题、关键操作集中在主面板（启动/停止代理、查看状态、打开设置）。
- **打包签名**：macOS 使用 Developer ID 签名 + notarization；Windows 使用 EV/OV 证书签名（无证书时降级为未签名但显示明确说明）。
- **多硬件架构**：
  - macOS：同时产出 `x64` 与 `arm64` 两个 `.dmg`（或一个 universal .dmg），覆盖 Intel Mac 与 Apple Silicon。
  - Windows：同时产出 `x64` 与 `arm64` NSIS `.exe`，覆盖传统 x86_64 与 Surface / ARM 笔电。
  - Release 资产命名带架构后缀，例如 `Codex-Switch-0.1.0-mac-arm64.dmg` / `Codex-Switch-Setup-0.1.0-win-x64.exe`。

## 测试模式

```typescript
// 单元测试：协议转换示例（Vitest）
import { describe, it, expect } from 'vitest';
import { openAIToDeepSeek } from '@/electron/proxy/translate';

describe('openAIToDeepSeek', () => {
  it('maps gpt-5-codex to deepseek-chat', () => {
    const req = { model: 'gpt-5-codex', messages: [{ role: 'user', content: 'hi' }] };
    const out = openAIToDeepSeek(req, { 'gpt-5-codex': 'deepseek-chat' });
    expect(out.model).toBe('deepseek-chat');
  });
});

// E2E：首次启动向导（Playwright + electron）
import { test, expect, _electron as electron } from '@playwright/test';

test('first-run wizard saves API key and starts proxy', async () => {
  const app = await electron.launch({ args: ['.'] });
  const window = await app.firstWindow();
  await window.getByLabel('DeepSeek API Key').fill('sk-test-xxxx');
  await window.getByRole('button', { name: '完成并启动代理' }).click();
  await expect(window.getByText('代理运行中')).toBeVisible();
  await app.close();
});
```

## 重要约束

- **禁止重量级依赖** — 不引入 Redux/MobX/Next.js/Electron-Forge；UI 状态优先用 React 内置 hooks + Zustand（按需）。
- **凭据管理** — DeepSeek API Key 通过 OS keychain（keytar）保存，禁止写入仓库/日志/截图。
- **配置文件改动** — 修改 `~/.codex/*` 之前必须先备份成 `*.bak.<timestamp>`，提供"一键还原"。`auth.json` 文件权限必须设为 `0o600`。
- **网络监听** — 代理仅绑定 `127.0.0.1`，端口冲突时自动 +1 重试，且向用户明确提示新端口。
- **协议兼容** — 必须同时支持 HTTP `/v1/responses` 和 WebSocket（Codex CLI v0.132+ 使用 WebSocket 流式协议）；模型映射要覆盖 `deepseek-chat`（V3）与 `deepseek-reasoner`（R1），后者需正确处理 `reasoning_content` 字段并在多轮对话中回传。
- **代码限制** — 行宽 100 字符，单函数不超过 50 行，单文件不超过 400 行；超出请拆分。
- **跨平台兼容** — 所有路径使用 `path.join`；shell 命令禁止假设 POSIX；图标/安装器资源同时提供 `.icns` 与 `.ico`。

## 目录结构

```
codex-switch/
├── electron/                   # 主进程（Node 侧）
│   ├── main.ts                 # 应用入口
│   ├── preload.ts              # 渲染进程的安全桥
│   ├── proxy/                  # OpenAI ⇄ DeepSeek 代理与协议转换
│   ├── codex/                  # ~/.codex 配置读写与备份
│   ├── config/                 # 用户配置（API Key、模型映射）
│   ├── ipc/                    # IPC 通道定义
│   └── tray.ts                 # 系统托盘
├── src/                        # 渲染进程（React UI）
│   ├── main.tsx
│   ├── App.tsx
│   ├── pages/                  # Setup / Dashboard / Settings / Logs
│   ├── components/
│   ├── hooks/
│   └── styles/                 # Tailwind 入口
├── tests/
│   ├── unit/                   # Vitest
│   └── e2e/                    # Playwright (electron)
├── build/                      # 图标、安装器资源（.icns / .ico / LICENSE.txt）
├── electron-builder.yml        # 打包配置（dmg / nsis；mac+win，各含 x64 与 arm64）
├── vite.config.ts
├── tsconfig.json
├── package.json
└── README.md
```
