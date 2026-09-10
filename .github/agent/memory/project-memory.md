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
| 项目类型 | **跨平台桌面配置工具**（Electron 桌面应用）——v3.0.0 起不做任何流量转发 |
| 业务场景 | 让不懂命令行的用户在 macOS / Windows 上"双击安装、点几下按钮"，把 Codex（CLI/Desktop）与 Claude（Desktop/CLI）接到 DeepSeek / 智谱 GLM / 自定义等国内模型服务上 |
| 用户规模 | 个人用户与小团队，早期目标 100 – 1000 人 |
| 当前阶段 | **v3.0.0**（2.4.0 / 3.0.0 / 3.1.0 / 3.1.1 四版**从未发布**，已折叠为单一 3.0.0，见 TASK-128/ADR-035；内容含代理移除 → 配置工具转型、GLM 直连、`config.toml` 合并写，见 TASK-127/ADR-034；未 push，160/160 tests ✅） |
| 设计原则 | 零门槛、图形化、一键安装；极简实用 > 功能堆砌 |
| 主语言 | TypeScript 5.x（strict） |
| 桌面运行时 | Electron 30+ |
| 渲染层 | React 18 + Vite + Tailwind CSS |
| 状态/配置 | electron-store（JSON） + keytar（OS 钥匙串） |
| 数据库 | N/A（无数据库；配置体量极小，JSON 足够） |
| 包管理 | pnpm |
| 测试 | Vitest（单元，jsdom/node）+ Playwright for Electron（E2E）。类型检查经 `tsconfig.test.json` 覆盖 `tests/**` —— **`pnpm typecheck` 会一并检查测试文件** |
| 打包 | electron-builder（macOS .dmg / Windows NSIS .exe） |
| 对标产品 | Claude Desktop、VS Code、Discord（均为 Electron） |
| 参考工程 | `codex-deepseek-installer`（<https://github.com/Mark7766/codex-deepseek-installer>）。**v3.0.0 起仅作历史渊源**——从其移植的代理已于本版本删除，不再有代码依赖。 |
| 支持架构 | macOS x64（Intel）、macOS arm64（Apple Silicon）、Windows x64、Windows arm64 |

---

## 🏗️ 架构概述

```
 ┌────────────────────────────────────────────┐
 │ Codex Switch（Electron 主进程）             │
 │  ┌──────────────────────────────────────┐  │
 │  │ 供应商注册表                          │  │
 │  │  electron/config/providers.ts         │  │
 │  │  唯一事实来源：端点 / 模型表 /        │  │
 │  │  Key 账户 / 档位默认值 / 模板差异开关 │  │
 │  └──────────────────────────────────────┘  │
 │  ┌──────────────────────────────────────┐  │
 │  │ 配置写入器（全部先备份，可一键还原）   │  │
 │  │  codex/writer.ts  → ~/.codex/config.toml
 │  │                   → ~/.codex/models.json（合并写）
 │  │  claude/desktop-writer.ts → Claude-3p/…
 │  │  claude/env-writer.ts → ~/.claude/… + shell profile
 │  └──────────────────────────────────────┘  │
 │  ┌──────────────────────────────────────┐  │
 │  │ electron-store（偏好）                │  │
 │  │ keytar（OS 钥匙串存 API Key）         │  │
 │  │ electron/logging（应用日志，诊断包用） │  │
 │  └──────────────────────────────────────┘  │
 │   ▲                                        │
 │   │ IPC（contextBridge 白名单，含 providers:list）
 │   ▼                                        │
 │  Renderer（React + Tailwind）              │
 │   • Setup 向导 / Settings（默认页，菜单第一）
 │   • 工具接入状态 / Plugins / Help          │
 └────────────────────┬───────────────────────┘
                      │ 只写配置文件，不转发流量
                      ▼
   ~/.codex/config.toml · ~/.codex/models.json
   ~/.claude/settings.json · Claude-3p/configLibrary/*.json
                      │
                      ▼  各工具自行直连
      DeepSeek / 智谱 GLM / 自定义（OpenAI Responses + Anthropic 兼容）
```

### 核心特征
- **进程边界严格**：主进程独占文件系统/网络/Codex 配置；渲染层只通过 IPC 间接访问。`contextIsolation: true`、`nodeIntegration: false` 不可变更。
- **供应商注册表是唯一事实来源（v3.0.0）**：`electron/config/providers.ts` 用描述符描述每家供应商的
  Codex 端点与模板差异开关、Claude 端点、模型清单、档位默认值、Key 账户与提示语。**新增供应商（如阿里 Qwen）
  ＝ 加一条数据**（若需独立模型目录，再加一个 json 资产与 `electron-builder.json` 的 `extraResources` 一行）。
  ⚠️ 描述符必须**纯数据**——渲染层经 IPC 通道 `providers:list` 取用（两个 tsconfig 的 rootDir/include 各自独立，
  无法共享模块），任何函数/RegExp 都会让那条通道静默失效（有守门测试）。
- **全部供应商均为直连（v3.0.0）**：本地代理已删除，没有任何转发。Codex 侧要求供应商支持 OpenAI Responses
  协议（`wire_api = "responses"`），Claude 侧要求 Anthropic Messages 兼容端点。
  - **DeepSeek**：`https://api.deepseek.com/`（尾斜杠逐字节保留），`model_reasoning_effort=high`，
    写 `preferred_auth_method`/`forced_login_method`，目录资产 `deepseek-models.json`
    （**2 模型：`deepseek-flash`（多模态，含 image modality）+ `deepseek-v4-pro`**，与官方一键脚本逐字节一致）。
    Claude 端点 `https://api.deepseek.com/anthropic`，档位默认 opus→pro / sonnet,haiku→flash。
  - **智谱 GLM**（v3.0.0 由代理转直连，照官方文档）：`providerId="ZAI"`、
    `https://open.bigmodel.cn/api/v1`、`model_reasoning_effort=max`，目录资产 `glm-models.json`
    （**3 模型：`glm-5.3` / `glm-5.3-flash` / `glm-5.2`**）。Claude 端点
    `https://open.bigmodel.cn/api/anthropic`，档位默认 opus→glm-5.3 / sonnet,haiku→glm-5.3-flash。
  - **自定义**：两个端点均由用户填写；模板用 `requires_openai_auth` + auth.json 而非把 Key 写进 config.toml，
    并额外写 1M 上下文与 `[features]` 开关；Claude 侧只配 Opus+Sonnet（不配 Haiku）。
- **`~/.codex/models.json` 是跨供应商共享文件**：DeepSeek 与 GLM 的 `model_catalog_json` 都指向它，
  因此写入必须**合并**（剔除受管 slug → 追加当前供应商 → 用户无自加条目时逐字节照抄资产）。直接覆盖会让
  切换供应商后另一家的条目消失。**受管 `[model_providers.X]` 段名同样由注册表派生**——手写清单必漏
  （BUG-007 教训）。
- **`normalizeProvider` 只读不写**：已移除的 Agnes 若仍留在存量配置里，读时归一到默认供应商以防 TypeError；
  **不迁移、不提示、不清钥匙串**（`agnes-api-key` 条目刻意保留）。`lifetimeFirstStartAt` 虽带 lifetime
  前缀，但喂的是「早期成员」徽章，**不可删**。
- **凭据安全**：DeepSeek API Key 走 OS keychain（macOS Keychain / Windows Credential Manager），不落盘到普通配置文件。
- **配置可还原**：所有对 `~/.codex/*` 的写入都先备份成 `*.bak.<timestamp>`，提供"一键还原"。
- **跨平台一套代码**：Electron 同时产出 **macOS x64 / arm64** 两个 `.dmg`（可选 universal）与 **Windows x64 / arm64** 两个 NSIS `.exe` 安装包；图标 / 路径 / 安装器脚本全部兼容。
- **零门槛 UX**：对标 Claude Desktop，简洁界面、人话文案、状态用大色块 + 文字双重表达。
- **社区数字口径（v2.0.0）**：侧边栏「和 X 位朋友一起使用」显示**累计注册客户端数**（Server `GET /client/community` 的 `total_clients` = COUNT(client_registry)），不再用「30 天活跃用户」。客户端 `communityGetCount` 读 `total_clients`（回退 `active_users` 兜底，避免数字消失）。**Server 已部署**：生产实测 `{"active_users":172,"total_clients":381}`。回归测试 `codex-switch-server/tests/integration/test_client_community.py`。

---

## 🔄 核心业务流程

```
用户
   │ 1. 下载 .dmg / .exe，双击安装
   ▼
首次启动 → Setup 向导（未完成向导且无 Key 时）
   ├─ 填写 DeepSeek API Key（写入 OS 钥匙串）
   ├─ 选择默认模型（deepseek-flash / deepseek-v4-pro）
   └─ 点「完成并应用配置」
   │
   ▼
[主进程自动执行]
   ├─ 备份 ~/.codex/config.toml → .bak.<ts>
   ├─ 按注册表写入 config.toml + auth.json（0o600）
   ├─ 合并写入 ~/.codex/models.json
   └─ 若检测到 Claude 工具已安装，一并写入其配置
   │
   ▼
[设置]（默认落地页，侧边栏第一项）
   ├─ 供应商设置：切换供应商、填各自 Key、自定义端点
   ├─ Codex 接入：供应商 + 默认模型 → 「保存并应用」
   ├─ Claude Desktop / Claude Code CLI 接入：供应商 + 管理模型映射
   └─ 自动更新 / 关于 / 遥测开关
   │
   ▼
[工具接入状态]：(4 张卡片) 已安装/未安装 · 已配置/未配置，可刷新（会顺手补写缺失配置）
   │
   ▼
用户在 Codex / Claude 里正常使用
   → 各工具**直连**供应商（应用关掉也照常可用，不经过本应用）
```

---

## 📦 核心模块

| 模块 | 路径 | 说明 | 状态 |
|------|------|------|------|
| 应用入口 | `electron/main.ts` | 创建窗口、注册 IPC、启动迁移与自动应用（v3.0.0 起 1057 行） | ✅ v3.0.0 |
| **供应商注册表** | `electron/config/providers.ts` | **唯一事实来源**：端点/模型表/档位默认值/Key 账户/模板开关 + `normalizeProvider` + 受管段名正则 | ✅ v3.0.0 |
| Codex 配置写入 | `electron/codex/writer.ts` | 注册表驱动的**单个** `buildCodexToml`；备份/回滚/滚动保留 | ✅ v3.0.0 |
| 模型目录 | `electron/codex/models-catalog.ts` | 读打包资产 + **合并写** `~/.codex/models.json` | ✅ v3.0.0 |
| 配置还原 | `electron/codex/config-restore.ts` | 「切换到 OpenAI 官方」：整段剥离受管块（段名由注册表派生） | ✅ v3.0.0 |
| Claude Desktop 写入 | `electron/claude/desktop-writer.ts` | 3P gateway profile + `_meta.json`（条目名跟随供应商） | ✅ v3.0.0 |
| Claude CLI 写入 | `electron/claude/env-writer.ts` | `~/.claude/settings.json` env + `config.json` 旁路 + shell profile | ✅ v3.0.0 |
| 凭据存储 | `electron/config/secrets.ts` | keytar 优先、加密 store 回退；对供应商泛型（`getKey/setKey/clearKey`） | ✅ v3.0.0 |
| **配置写入基座** | `electron/config/file-write.ts` | **Codex / Claude 共用的「内容去重 + 备份修剪」写入**（v3.1.0 抽出）。⚠️ 写用户配置文件必须走这里 | ✅ v3.1.0 |
| 日志脱敏 | `electron/config/redact.ts` | `redactSensitive`（遥测上报前的最后一道防线） | ✅ v3.0.0 |
| 应用日志 | `electron/logging/persistent-log.ts` | ndjson 滚动日志，诊断包读取尾部（v3.0.0 从 proxy 迁出） | ✅ v3.0.0 |
| 迁移 | `electron/config/migrations.ts` | 含 **`runV300DirectMigration`**（把仍指向本地代理的 config.toml 改写为直连，覆盖 GLM） | ✅ v3.0.0 |
| Setup 向导 | `src/pages/Setup.tsx` | 首次启动 2 步（Key + 模型） | ✅ v3.0.0 |
| 设置页 | `src/pages/Settings.tsx` | 注册表驱动渲染，默认落地页 | ✅ v3.0.0 |
| 工具接入状态 | `src/pages/Dashboard.tsx` | 只显示四个工具的安装/配置状态 | ✅ v3.0.0 |
| 模型映射弹窗 | `src/components/ModelMappingModal.tsx` | 注册表驱动；旧模型名折叠（`src/lib/model-fold.ts`） | ✅ v3.0.0 |
| 打包配置 | `electron-builder.yml` | macOS .dmg + Windows NSIS；`extraResources` 含两个模型目录资产 | ✅ v3.0.0 |
| **已删除** | `electron/proxy/**`（v3.0.0）、`electron/plugins/**` + `Plugins.tsx`（v3.1.0）、`Logs.tsx`、`PortConflictModal.tsx`、`session-reader.ts`、`QaGroupModal.tsx` | 本地代理及其衍生功能（约 5,400 行）；插件子系统（约 1,750 行） | ❌ 已移除 |

---

## ⚠️ 关键约束

1. **进程边界不可破**：渲染进程 `contextIsolation: true` + `nodeIntegration: false` + `sandbox: true`，所有 native 能力走 preload 白名单。
2. **供应商注册表是唯一事实来源，且必须保持纯数据**：端点、模型表、Key 账户、受管 TOML 段名全部由 `electron/config/providers.ts` 派生。**不要手写这些清单**（BUG-007 教训），也不要在描述符里放函数/RegExp（会静默破坏 `providers:list` IPC）。
3. **写用户配置文件必须走 `electron/config/file-write.ts`**：它保证「内容相同则既不备份也不写」+「备份按 `maxBackupsPerFile` 滚动修剪」两条不变量。**绕过它直接 `fs.writeFile` 就是重演 v3.1.0 的那个缺陷**（用户机器上堆积了 415 份 `~/.zshrc.bak`，因为 Claude 侧写入既不去重也不修剪，而它每次启动都会重写）。
   - 同理：**迁移标记必须用 `setMigrationFlag(key)`**，不要写 `setPreferences({migrations: {…}})` —— `setPreferences` 是浅合并，会整体替换 `migrations` 对象、抹掉其它 flag。
4. **API Key 进 OS keychain**：禁止明文写入 electron-store 或日志。
5. **遥测只上报配置操作，且零个人数据**（v3.1.0）：可上报的只有 `config_write`（字段名）/ `tool_install` / `tool_install_fail`（**本地归类枚举**）。**禁止**上报：设备/客户端标识符（`clientId`）、文件路径、报错原文与堆栈、对话内容、Key 片段。历史上 `tool_install_fail.error_code` 曾把完整 API Key 送进服务端（TASK-098），勿重蹈。
6. **写 `~/.codex/config.toml` 必须「合并」、绝不能整份覆盖**（v3.0.0 教训）：只剥「我们的顶层键 + **当前**供应商的块 + `[features]` 受管键」，其余一律原样保留。两个理由 —— ① **Codex 按对话记住 `model_provider`**（会话文件 `payload.model_provider`），删掉上一家的块会让那家的历史对话报 `Model provider X not found`；② 整份覆盖会静默抹掉用户/Codex 自有的 `notify` / `[desktop]` / `[mcp_servers.*]` / `[projects.*]` / 自建 `[model_providers.*]`。**凡改动 provider 块，先想「会不会让历史对话失效」。**
   - **`[model_providers.*]` 块在任何路径下都不得被删**，**包括「切换到 OpenAI 官方」**。切回官方只需清掉顶层 `model_provider`，让 Codex 回落到内置 `openai` —— **未被选中的块是惰性的**（Codex 只解析 `model_provider` 指向的那一家）。`sanitizeManagedConfig` 的 `stripProviderBlocks` **默认 `[]`（一块不剥）**，只有写入路径传「当前那一家」；**永远不要传「全部」**（ADR-036）。
7. **改完重构必须跑 `pnpm typecheck`（含 tests）+ `pnpm test`；删功能时必须同步搜测试**（v3.1.0 教训：删掉 `'plugins'` 页面的同一次任务里漏改了遍历该页面的测试，而 tests 当时不被类型检查 → 假绿通过。同类事故已发生两次）。测试文件由 `tsconfig.test.json` 覆盖，**不要再让它断链**。
8. **`~/.codex/*` 改动必须先备份**：备份文件名 `<orig>.bak.<unix-timestamp>`；`auth.json` 写入后必须 `chmod 0o600`；UI 提供一键还原入口。
9. **协议兼容（直连，无代理）**：Codex 侧要求供应商支持 OpenAI Responses 协议（`wire_api = "responses"`），Claude 侧要求 Anthropic Messages 兼容端点。新增供应商必须两个端点都想清楚。
10. **日志脱敏**：默认过滤 `Authorization`、`api_key`、`sk-*`。
11. **代码限制**：行宽 100 字符；单函数 ≤ 50 行；单文件 ≤ 400 行。
12. **依赖克制**：不引入 Redux/MobX/Next.js/Electron-Forge/Ant Design/MUI。UI 用 Tailwind + 自写组件。
13. **跨平台兼容**：所有路径用 `path.join`；不假设 POSIX shell；图标同时提供 `.icns` 与 `.ico`。
14. **多架构必出**：macOS x64/arm64 + Windows x64/arm64 都必须产出安装包；Release 资产名带架构后缀。
15. **UI 文案说人话**：面向最终用户的文案禁止技术术语（避免出现 "SSE"、"proxy"、"IPC" 等词）；错误提示要附"下一步该做什么"。
16. **测试覆盖**：核心模块（providers 注册表 / codex 写入 / claude 写入）≥ 90%；整体 ≥ 80%。注册表有两条硬护栏：描述符必须能 JSON 往返（IPC 契约）、任何供应商的模板都不得含 `127.0.0.1` 或端口。

---

## 🐛 已知问题 & 常见坑

| 编号 | 问题描述 | 解决方案 | 日期 |
|------|---------|---------|------|
| BUG-001 | Node 23.x 下 `pnpm install` 进程在 linker 阶段死锁挂起 (0% CPU) | 推荐改用 Node 20 LTS；或者本地使用 `pnpm install --ignore-scripts` + `pnpm rebuild` 两步式安装 | 2026-05-30 |
| BUG-002 | Windows 默认 PowerShell 脚本执行策略禁止运行 npx.ps1 / npm.ps1 / pnpm.ps1 | 运行 `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process` 清理当前对话的受限策略 | 2026-05-30 |
| BUG-003 | Windows 本地打包时，7-zip 提取 `winCodeSign.7z` 中的 OS 符号链接报错 `ERROR: Cannot create symbolic link: 客户端没有所需的特权` | 1. 开启 Windows 系统的【开发人员模式】（设置 -> 系统 -> 开发者选项 -> 开启【开发人员模式】）允许普通用户创建软链接。<br>2. 或以管理员权限重新启动 VS Code/PS终端。 | 2026-05-30 |
| BUG-004 | Windows 自动升级点击「立即安装」后报错程序未关闭，导致升级失败 | 在 `IPC.updateInstall` 显式异步停止 proxy 并 flush lifetime；且在 `before-quit` 最后调用 `app.exit(0)` 强行终止进程以配合 NSIS。 | 2026-06-01 |
| BUG-005 | Claude Desktop 配置写入 `~/Library/Application Support/Claude/claude_desktop_config.json` 完全无效 | Claude Desktop 的 3P (third-party gateway) 网关从 `Claude-3p/configLibrary/<PROFILE_ID>.json` 读，需同时在两份 `claude_desktop_config.json` 中写 `deploymentMode:"3p"`（详见 ADR-006）。`PROFILE_ID = '00000000-0000-4000-8000-0000c0dec501'`，占位 `inferenceGatewayApiKey = 'cs-internal-placeholder'` 用于卸载时识别我们的 profile。Windows 路径用 `LOCALAPPDATA` 而非 `APPDATA`。 | 2026-06-04 |
| BUG-006 | Claude Code CLI 仅靠 `~/.zshrc` 写 env 需要重启终端才生效 | 同时写 `~/.claude/settings.json` 的 `env` 字段（每次调用读取，立即生效）+ `~/.claude/config.json` 的 `primaryApiKey:"any"`（OAuth 旁路标记）。`settings.json` 用 `__codexSwitch:"managed"` 标记我方写入，卸载时只清理 9 个受管 env 键，保留用户其它字段。 | 2026-06-04 |
| BUG-007 | 点「切换到 OpenAI 官方」后 Codex 报「but you passed gpt-6-astra」且左下角仍显示 deepseek | `restoreOriginalConfig()` 未适配 v2.0.0 deepseek 直连格式——只处理 `[model_providers.custom]`，漏删 `model_provider`/`[model_providers.deepseek]`，只删 `model` 行 → Codex 回退 OpenAI 默认模型但仍路由 DeepSeek。已修复（TASK-122）：抽 `electron/codex/config-restore.ts` `sanitizeManagedConfig()` 整段剥离 managed 块 + 受管顶层键，保留用户自有段。 | 2026-09-09 |

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
  - （其代理核心 `proxy/deepseek-proxy.mjs` 已于 v3.0.0 删除，仅作历史渊源）
  - 安装脚本：`install.sh` / `uninstall.sh`（是本项目要取代的 CLI 门槛）
- DeepSeek API 文档：<https://api-docs.deepseek.com/>
- Codex CLI / Desktop 配置规范：参考 `~/.codex/config.toml` 现有结构
- Electron 安全最佳实践：<https://www.electronjs.org/docs/latest/tutorial/security>
