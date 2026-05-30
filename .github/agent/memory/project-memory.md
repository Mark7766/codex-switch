# 🧠 Codex Switch — 项目长期记忆

> **用途**：存储项目的稳定事实、架构决策、关键约束和常见问题。
> AI Agent 在每次任务开始时应阅读此文件获取上下文。
> 当项目发生重大变化时，必须同步更新此文件。

---

## 📋 项目基本信息

| 属性 | 值 |
|------|---|
| 项目名称 | Codex Switch |
| 仓库名 | codex-switch |
| 项目类型 | 跨平台桌面图形化代理（Electron 桌面应用） |
| 业务场景 | 让不懂命令行的用户在 macOS / Windows 上"双击安装、点几下按钮"，把 Codex CLI 和 Codex Desktop 接到 DeepSeek 上 |
| 用户规模 | 个人用户与小团队，早期目标 100 – 1000 人 |
| 当前阶段 | v1.0.0（首个公开稳定版） |
| 设计原则 | 零门槛、图形化、一键安装；极简实用 > 功能堆砌 |
| 主语言 | TypeScript 5.x（strict） |
| 桌面运行时 | Electron 30+ |
| 渲染层 | React 18 + Vite + Tailwind CSS |
| 状态/配置 | electron-store（JSON） + keytar（OS 钥匙串） |
| 数据库 | N/A（无数据库；配置体量极小，JSON 足够） |
| 包管理 | pnpm |
| 测试 | Vitest（单元）+ Playwright for Electron（E2E） |
| 打包 | electron-builder（macOS .dmg / Windows NSIS .exe） |
| 对标产品 | Claude Desktop、VS Code、Discord（均为 Electron） |
| 参考工程 | `codex-deepseek-installer`（本地路径 `/Users/mark/work/gitspace/opensource/codex-deepseek-installer`，仓库 <https://github.com/Mark7766/codex-deepseek-installer>）。代理核心逻辑 `proxy/deepseek-proxy.mjs` 会被移植重写为 TypeScript，默认端口 `11435` 与其保持一致，便于已有用户迁移。 |
| 默认代理端口 | `127.0.0.1:11435` |
| 支持架构 | macOS x64（Intel）、macOS arm64（Apple Silicon）、Windows x64、Windows arm64 |

---

## 🏗️ 架构概述

```
 ┌───────────────────────┐       ┌──────────────────────────────────────────┐
 │ Codex CLI / Desktop   │──HTTP─▶│ Codex Switch（Electron 主进程）           │
 │ （OpenAI Responses     │       │  ┌────────────────────────────────────┐  │
 │  API + WebSocket）     │       │  │ 本地代理（127.0.0.1:11435）         │  │
 └───────────────────────┘       │  │  • HTTP /v1/responses + WebSocket  │  │
                                 │  │  • 协议转换 Responses ⇄ Chat       │  │
                                 │  │  • 模型映射                          │  │
                                 │  │  • reasoning_content 跨轮回传       │  │
                                 │  │  • SSE / 流式响应转发                │  │
                                 │  ├────────────────────────────────────┤  │
                                 │  │ Codex 配置注入                       │  │
                                 │  │  • ~/.codex/config.toml（写+备份）   │  │
                                 │  │  • ~/.codex/auth.json（写+备份）     │  │
                                 │  │  • 一键还原                          │  │
                                 │  ├────────────────────────────────────┤  │
                                 │  │ 配置 / 密钥                          │  │
                                 │  │  • electron-store JSON（偏好）       │  │
                                 │  │  • keytar OS 钥匙串（API Key）       │  │
                                 │  └────────────────────────────────────┘  │
                                 │   ▲                                       │
                                 │   │ IPC (contextBridge 白名单)            │
                                 │   ▼                                       │
                                 │  Renderer（React + Tailwind）             │
                                 │   • Setup 向导                           │
                                 │   • Dashboard 主面板                      │
                                 │   • Settings                             │
                                 │   • Logs                                  │
                                 └────────────────────┬─────────────────────┘
                                                      │ HTTPS
                                                      ▼
                                          ┌────────────────────────┐
                                          │   DeepSeek API         │
                                          └────────────────────────┘
```

### 核心特征
- **进程边界严格**：主进程独占文件系统/网络/Codex 配置；渲染层只通过 IPC 间接访问。`contextIsolation: true`、`nodeIntegration: false` 不可变更。
- **代理仅监听 loopback**：默认 `127.0.0.1:11435`，与参考工程保持一致；端口被占自动 +1 重试并通知用户，绝不绑定 `0.0.0.0`。
- **协议双通道**：同时支持 HTTP `/v1/responses` 与 WebSocket（Codex CLI v0.132+ 使用）；后端调 DeepSeek `chat/completions`；需正确处理 `deepseek-reasoner`（R1）的 `reasoning_content` 字段并在多轮中回传。
- **凭据安全**：DeepSeek API Key 走 OS keychain（macOS Keychain / Windows Credential Manager），不落盘到普通配置文件。
- **配置可还原**：所有对 `~/.codex/*` 的写入都先备份成 `*.bak.<timestamp>`，提供"一键还原"。
- **跨平台一套代码**：Electron 同时产出 **macOS x64 / arm64** 两个 `.dmg`（可选 universal）与 **Windows x64 / arm64** 两个 NSIS `.exe` 安装包；图标 / 路径 / 安装器脚本全部兼容。
- **零门槛 UX**：对标 Claude Desktop，简洁界面、人话文案、状态用大色块 + 文字双重表达。

---

## 🔄 核心业务流程

```
小白用户
   │
   │ 1. 去 GitHub Releases 下载 .dmg / .exe，双击安装
   ▼
首次启动 Codex Switch
   │
   │ 2. Setup 向导
   ▼
[Setup]
  ├─ 填写 DeepSeek API Key
  ├─ 选择默认模型映射（gpt-5-codex → deepseek-chat / deepseek-reasoner）
  ├─ 确认代理端口（默认 11435，可改）
  └─ 点"完成并启动代理"
   │
   ▼
[主进程自动执行]
  ├─ API Key 写入 OS keychain
  ├─ 启动本地 HTTP + WebSocket 代理
  ├─ 备份 ~/.codex/config.toml → .bak.<ts>
  ├─ 写入新的 config.toml & auth.json（auth.json 权限 0o600），指向 http://127.0.0.1:11435
  └─ 推送状态到渲染层
   │
   ▼
[Dashboard]
  ├─ ✅ 代理运行中 (127.0.0.1:11435)
  ├─ ✅ Codex CLI 配置已注入
  ├─ ✅ Codex Desktop 配置已注入
  └─ 按钮：[停止代理] [打开日志] [设置] [还原 Codex 配置]
   │
   ▼
用户在 Codex CLI / Desktop 正常对话
  → 请求经本地代理（HTTP 或 WebSocket）→ 协议转换 → DeepSeek → 流式响应回 Codex（含 reasoning_content）
```

---

## 📦 核心模块

| 模块 | 路径 | 说明 | 状态 |
|------|------|------|------|
| 应用入口 | `electron/main.ts` | 创建窗口、挂载托盘、生命周期 | ✅ 已完成 v0.1 |
| Preload 桥 | `electron/preload.ts` | contextBridge 暴露白名单 API | ✅ 已完成 v0.1 |
| 系统托盘 | `electron/tray.ts` | 托盘菜单：启停代理、显示窗口、退出 | ⬜ 待开发 |
| 代理服务 | `electron/proxy/server.ts` | Node http server + ws WebSocketServer，监听 127.0.0.1:11435 | ✅ 已完成 v0.1 |
| 协议转换 | `electron/proxy/translate.ts` | OpenAI Responses ⇄ DeepSeek Chat Completions 请求/响应映射 | ✅ 已完成 v0.1 |
| 推理状态 | `electron/proxy/reasoning.ts` | `deepseek-reasoner` `reasoning_content` 跨轮回传 | ✅ 已完成 v0.1 |
| 流式转发 | `electron/proxy/stream.ts` | SSE pipe，断流处理 | ✅ 已完成 v0.1 |
| Codex 路径 | `electron/codex/paths.ts` | 跨平台 `~/.codex` 解析 | ✅ 已完成 v0.1 |
| Codex 写入 | `electron/codex/writer.ts` | 写 config.toml / auth.json + 备份 + 还原 | ✅ 已完成 v0.1 |
| Codex 还原 | `electron/codex/writer.ts` | 一键还原最近的备份（合并到 writer.ts） | ✅ 已完成 v0.1 |
| 用户配置 | `electron/config/store.ts` | electron-store 封装 | ✅ 已完成 v0.1 |
| 密钥管理 | `electron/config/secrets.ts` | keytar（主）+ electron-store 加密（备） | ✅ 已完成 v0.1 |
| IPC 通道 | `electron/ipc/channels.ts` | 通道枚举与类型 | ✅ 已完成 v0.1 |
| Setup 向导 | `src/pages/Setup.tsx` | 首次启动 3 步向导 | ✅ 已完成 v0.1 |
| Dashboard | `src/pages/Dashboard.tsx` | 代理状态主面板 | ✅ 已完成 v0.1 |
| Settings | `src/pages/Settings.tsx` | API Key / 模型映射 / 端口 | ✅ 已完成 v0.1 |
| Logs | `src/pages/Logs.tsx` | 实时请求日志（脱敏） | ✅ 已完成 v0.1 |
| 打包配置 | `electron-builder.yml` | macOS .dmg + Windows NSIS .exe；每平台 x64 + arm64 两个分包（暂未配图标） | ✅ 已完成 v0.1 |
| 发布流水线 | `.github/workflows/release.yml` | tag → 多平台构建 + 上传 | ✅ v1.0.0 |

---

## ⚠️ 关键约束

1. **进程边界不可破**：渲染进程 `contextIsolation: true` + `nodeIntegration: false` + `sandbox: true`，所有 native 能力走 preload 白名单。
2. **代理仅监听 `127.0.0.1:11435`**：禁止 `0.0.0.0` 或公网地址；端口冲突自动 +1 重试。该端口与参考工程保持一致，不要轻改。
3. **API Key 进 OS keychain**：禁止明文写入 electron-store 或日志。
4. **`~/.codex/*` 改动必须先备份**：备份文件名 `<orig>.bak.<unix-timestamp>`；`auth.json` 写入后必须 `chmod 0o600`；UI 提供一键还原入口。
5. **协议双通道兼容**：同时支持 HTTP `/v1/responses` 与 WebSocket（Codex CLI v0.132+）；模型映射覆盖 `deepseek-chat` / `deepseek-reasoner`；`reasoning_content` 跨轮回传不可丢。
6. **日志脱敏**：默认过滤 `Authorization`、`api_key`、`sk-*`。
7. **代码限制**：行宽 100 字符；单函数 ≤ 50 行；单文件 ≤ 400 行。
8. **依赖克制**：不引入 Redux/MobX/Next.js/Electron-Forge/Ant Design/MUI。UI 用 Tailwind + 自写组件。
9. **跨平台兼容**：所有路径用 `path.join`；不假设 POSIX shell；图标同时提供 `.icns` 与 `.ico`。
10. **多架构必出**：macOS x64/arm64 + Windows x64/arm64 都必须产出安装包；Release 资产名带架构后缀。
11. **UI 文案说人话**：面向最终用户的文案禁止技术术语（避免出现 "SSE"、"proxy"、"IPC" 等词）；错误提示要附"下一步该做什么"。
12. **测试覆盖**：核心模块（proxy / translate / codex）≥ 90%；整体 ≥ 80%。

---

## 🐛 已知问题 & 常见坑

| 编号 | 问题描述 | 解决方案 | 日期 |
|------|---------|---------|------|
| BUG-001 | Node 23.x 下 `pnpm install` 进程在 linker 阶段死锁挂起 (0% CPU) | 推荐改用 Node 20 LTS；或者本地使用 `pnpm install --ignore-scripts` + `pnpm rebuild` 两步式安装 | 2026-05-30 |
| BUG-002 | Windows 默认 PowerShell 脚本执行策略禁止运行 npx.ps1 / npm.ps1 / pnpm.ps1 | 运行 `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process` 清理当前对话的受限策略 | 2026-05-30 |
| BUG-003 | Windows 本地打包时，7-zip 提取 `winCodeSign.7z` 中的 OS 符号链接报错 `ERROR: Cannot create symbolic link: 客户端没有所需的特权` | 1. 开启 Windows 系统的【开发人员模式】（设置 -> 系统 -> 开发者选项 -> 开启【开发人员模式】）允许普通用户创建软链接。<br>2. 或以管理员权限重新启动 VS Code/PS终端。 | 2026-05-30 |

---

## 🔧 开发环境

### 启动方式
```bash
# 首次安装
pnpm install

# 开发（Vite 热重载渲染层；electron 主进程自动重启）
pnpm dev

# 单元测试 / E2E
pnpm test
pnpm test:e2e

# 打包当前平台
pnpm package:mac    # macOS：x64 + arm64 两个 .dmg
pnpm package:win    # Windows：x64 + arm64 两个 NSIS .exe
```

### 系统要求
- Node.js 20 LTS
- pnpm 9.x
- macOS 12+ / Windows 10+
- 构建 macOS 包需要 Xcode Command Line Tools；构建 Windows NSIS 安装包需要 Windows 主机或 Wine + Mono

### 参考资源
- 参考工程（本项目的前身）：`/Users/mark/work/gitspace/opensource/codex-deepseek-installer`
  - 代理核心文件：`proxy/deepseek-proxy.mjs`（~523 行，Node + ws，默认端口 11435）
  - Codex 配置模板：`config/config.toml.template`（`openai_base_url = "http://127.0.0.1:11435/v1"`）
  - 安装脚本：`install.sh` / `uninstall.sh`（是本项目要取代的 CLI 门槛）
- DeepSeek API 文档：<https://api-docs.deepseek.com/>
- Codex CLI / Desktop 配置规范：参考 `~/.codex/config.toml` 现有结构
- Electron 安全最佳实践：<https://www.electronjs.org/docs/latest/tutorial/security>
