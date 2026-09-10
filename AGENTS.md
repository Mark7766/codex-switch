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

**Codex Switch** 是一个 **跨平台桌面配置工具（Electron 应用）**。它自动写好 Codex（CLI / Desktop）与 Claude（Desktop / Code CLI）的本地配置文件，让完全不懂命令行的用户在 macOS / Windows 上**双击安装、点几下按钮**就能把这些工具接到 DeepSeek、智谱 GLM 等国内模型服务上。

**v3.0.0 起它不再做任何转发**：本地代理已整个删除，配置写好后各工具直连供应商，应用关掉也照常可用。

定位与对标：参考 Claude Desktop / VS Code / Discord 的 Electron 桌面应用形态，主打"零门槛"。

## 系统架构与数据流

```
 ┌──────────────────────────────────────┐
 │ Codex Switch（Electron 主进程）       │
 │  ┌────────────────────────────────┐  │
 │  │ 供应商注册表                    │  │
 │  │  electron/config/providers.ts  │  │
 │  │  （唯一事实来源：端点/模型表/    │  │
 │  │    Key 账户/档位默认值）         │  │
 │  └────────────────────────────────┘  │
 │  ┌────────────────────────────────┐  │
 │  │ 配置写入器                      │  │
 │  │  codex/writer.ts → config.toml │  │
 │  │                → models.json   │  │
 │  │  claude/desktop-writer.ts      │  │
 │  │  claude/env-writer.ts          │  │
 │  │  （全部先备份，可一键还原）      │  │
 │  └────────────────────────────────┘  │
 │  ┌────────────────────────────────┐  │
 │  │ 配置存储 electron-store         │  │
 │  │ 凭据存储 keytar（OS 钥匙串）     │  │
 │  └────────────────────────────────┘  │
 │   ▲                                  │
 │   │ IPC（contextBridge 白名单）       │
 │   ▼                                  │
 │  Renderer（React + Tailwind）        │
 │   • Setup 向导 / Settings /          │
 │     Dashboard（工具接入状态）/        │
 │     Plugins / Help                   │
 └──────────────────┬───────────────────┘
                    │ 仅写配置文件，不转发流量
                    ▼
      ~/.codex/config.toml · ~/.codex/models.json
      ~/.claude/settings.json · Claude-3p/configLibrary/*.json
                    │
                    ▼  各工具自行直连
        DeepSeek / 智谱 GLM / 自定义（OpenAI Responses + Anthropic 兼容）
```

- **`electron/main.ts`** — Electron 主进程入口，创建窗口、挂载托盘、注册 IPC。
- **`electron/config/providers.ts`** — **供应商注册表，唯一事实来源**（v3.0.0）。新增供应商＝加一条数据；描述符必须保持**纯数据**（渲染进程经 `providers:list` 通道取用）。
- **`electron/codex/`** — Codex 配置注入，读写 `~/.codex/config.toml` 和 `~/.codex/auth.json`（权限 600）。⚠️ **写入是「合并」不是「覆盖」**：只更新我们的顶层键与**当前**供应商的块，其它内容（含其它 `[model_providers.*]`）一律保留 —— Codex 按对话记住 provider，删块会让历史对话失效（ADR-034）。
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
pnpm typecheck            # tsc --noEmit（含 electron / src / tests 三个项目）

# 构建 / 打包
pnpm build                       # 编译主进程 + 渲染进程
pnpm package:mac                 # 生成 .dmg（macOS）：x64 + arm64 两个分包
pnpm package:mac:universal       # 生成 universal .dmg（一个包通吃 Intel + Apple Silicon）
pnpm package:win                 # 生成 NSIS .exe 安装包（Windows）：x64 + arm64 两个分包
pnpm package:all                 # 多平台一键打包（CI 使用）
```

## 约定与模式

- **语言统一**：所有代码使用 TypeScript（`strict: true`），禁止 `any`，必要时用 `unknown` + 类型守卫。
- **进程边界**：主进程负责文件系统与配置写入；渲染进程**只通过 IPC** 间接访问系统资源，禁止开启 `nodeIntegration`，必须使用 `contextIsolation: true` + preload bridge。（渲染进程不能 import `electron/` —— 两个 tsconfig 的 rootDir/include 各自独立，共享数据一律走 IPC，类型在 `src/types/global.d.ts` 手抄镜像。）
- **安全默认**：所有 IPC 通道使用白名单；DeepSeek API Key 走 OS 凭据存储（keytar）或加密的 electron-store，**绝不**明文写入日志。
- **日志**：使用 `electron-log`，按级别 (debug/info/warn/error) 分文件；请求日志默认脱敏 Authorization。
- **UI 风格**：参考 Claude Desktop，简洁、白底/暗黑双主题、关键操作集中在设置页（侧边栏第一项，也是默认落地页）。
- **打包签名**：macOS 使用 Developer ID 签名 + notarization；Windows 使用 EV/OV 证书签名（无证书时降级为未签名但显示明确说明）。
- **多硬件架构**：
  - macOS：同时产出 `x64` 与 `arm64` 两个 `.dmg`（或一个 universal .dmg），覆盖 Intel Mac 与 Apple Silicon。
  - Windows：同时产出 `x64` 与 `arm64` NSIS `.exe`，覆盖传统 x86_64 与 Surface / ARM 笔电。
  - Release 资产命名带架构后缀，例如 `Codex-Switch-0.1.0-mac-arm64.dmg` / `Codex-Switch-Setup-0.1.0-win-x64.exe`。

## 测试模式

```typescript
// 单元测试：注册表守门（Vitest）—— 每个供应商都必须产出可用的 config.toml
import { describe, it, expect } from 'vitest';
import { writeCodexConfig } from '../../electron/codex/writer';
import { PROVIDER_LIST } from '../../electron/config/providers';

describe('provider registry', () => {
  it('描述符必须是纯数据（providers:list 的 IPC 契约）', () => {
    expect(JSON.parse(JSON.stringify(PROVIDER_LIST))).toEqual(PROVIDER_LIST);
  });

  it('每个供应商的模板都不含本地地址与端口', async () => {
    // v3.0.0 最重要的一条护栏：直连时代不该再出现 127.0.0.1
  });

  it('每个描述符都能产出 Codex 读得懂的 config.toml', async () => {
    // 必需顶层键、model_provider 与段名一致、端点逐字节不变
  });
});

// E2E：首次启动向导（Playwright + electron）
import { test, expect, _electron as electron } from '@playwright/test';

test('first-run wizard saves API key and writes config', async () => {
  const app = await electron.launch({ args: ['.'] });
  const window = await app.firstWindow();
  await window.getByLabel('DeepSeek API Key').fill('sk-test-xxxx');
  await window.getByRole('button', { name: '③ 完成并应用配置' }).click();
  await expect(window.getByText('设置')).toBeVisible();
  await app.close();
});
```

## 重要约束

- **禁止重量级依赖** — 不引入 Redux/MobX/Next.js/Electron-Forge；UI 状态优先用 React 内置 hooks + Zustand（按需）。
- **凭据管理** — DeepSeek API Key 通过 OS keychain（keytar）保存，禁止写入仓库/日志/截图。
- **配置文件改动** — 修改 `~/.codex/*` 之前必须先备份成 `*.bak.<timestamp>`，提供"一键还原"。`auth.json` 文件权限必须设为 `0o600`。
- **协议兼容** — 各供应商均为**直连**：Codex 侧要求供应商支持 OpenAI Responses 协议（`wire_api = "responses"`），Claude 侧要求 Anthropic Messages 兼容端点。新增供应商必须同时想清楚这两个端点（见 `electron/config/providers.ts`）。
- **供应商一致性** — 受管 `[model_providers.X]` 段名与 Key 通道都由注册表派生。**绝不要手写这些清单**：v2.3.0 曾因漏掉新增供应商的段名，导致「切换到 OpenAI 官方」后配置残留（BUG-007 同类）。
- **代码限制** — 行宽 100 字符，单函数不超过 50 行，单文件不超过 400 行；超出请拆分。
- **跨平台兼容** — 所有路径使用 `path.join`；shell 命令禁止假设 POSIX；图标/安装器资源同时提供 `.icns` 与 `.ico`。

## 目录结构

```
codex-switch/
├── electron/                   # 主进程（Node 侧）
│   ├── main.ts                 # 应用入口
│   ├── preload.ts              # 渲染进程的安全桥
│   ├── config/providers.ts     # 供应商注册表（唯一事实来源，纯数据）
│   ├── codex/                  # ~/.codex 配置读写与备份
│   ├── config/                 # 用户配置 + 供应商注册表 + Key 存储 + 共用写入基座
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
