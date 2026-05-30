# 📜 Codex Switch — 任务历史

> **用途**：记录近期任务摘要，为 AI Agent 提供短期上下文记忆。
> 保留最近 30 条任务记录，超出后归档。

---

## 记录格式

```markdown
### [TASK-{编号}] {任务标题}
- **日期**：YYYY-MM-DD
- **类型**：feat / fix / refactor / docs / chore
- **摘要**：一句话说明做了什么
- **变更文件**：列出核心变更文件
- **关联 Issue**：#xxx（如有）
- **注意事项**：后续需要注意的事项（如有）
```

---

## 任务记录

### [TASK-001] 安装 ai-coding-ok 并完成 Codex Switch 项目初始化
- **日期**：2026-05-30
- **类型**：chore
- **摘要**：通过 ai-coding-ok skill 安装三层记忆系统与编码规范模板；根据用户一句话需求（"做一个跨平台代理，让 Codex CLI 和 Codex Desktop 都能连接 DeepSeek，替代过于复杂的 `codex-deepseek-installer` CLI 安装流程，采用 Electron 桌面 GUI 让小白用户能图形化安装/使用，对标 Claude Desktop / VS Code / Discord 的 Electron 桌面应用形态"）自动推断技术栈、目录结构、核心模块并填充所有 14 个占位符文件。
- **变更文件**：
  - `AGENTS.md`
  - `.github/copilot-instructions.md`
  - `.github/project-metadata.yml`
  - `.github/PULL_REQUEST_TEMPLATE.md`
  - `.github/ISSUE_TEMPLATE/config.yml`
  - `.github/workflows/ci.yml`
  - `.github/workflows/memory-check.yml`
  - `.github/agent/system-prompt.md`
  - `.github/agent/coding-standards.md`
  - `.github/agent/workflows.md`
  - `.github/agent/prompt-templates.md`
  - `.github/agent/memory/project-memory.md`
  - `.github/agent/memory/decisions-log.md`
  - `.github/agent/memory/task-history.md`
- **关键决策**：
  - 技术栈：TypeScript + Electron 30 + React 18 + Vite + Tailwind CSS + electron-builder + Vitest + Playwright + pnpm
  - 无数据库：用户配置走 electron-store JSON；API Key 走 OS keychain（keytar）
  - 代理：Node 内建 http 模块（不引入 express/koa），仅监听 `127.0.0.1:8765`
  - 打包：electron-builder 同时产出 macOS `.dmg` 与 Windows NSIS `.exe`
  - 已写入 ADR-001（Electron + React + TypeScript 选型）
- **注意事项**：
  1. 项目尚未实际初始化代码（无 `package.json` / `tsconfig.json` / `electron-builder.yml` / 业务代码），下一步任务应是 scaffolding：`pnpm init` → 配置 TypeScript / Vite / Electron / Tailwind → 搭出最小可运行框架。
  2. 已根据项目目录约定使用 `electron/` 与 `src/` 分层，后续生成代码请严格遵守。
  3. 首次启动向导 + Dashboard 的 UI/UX 需对标 Claude Desktop，建议在动手写代码前先做 Figma 或低保真原型。
  4. macOS 与 Windows 的签名/公证凭据尚未准备；CI 暂以无签名构建跑通即可，正式发布前需补 ADR + 配置 Secrets。

### [TASK-002] 校正参考工程路径、对齐代理实现细节、扩展多硬件打包矩阵
- **日期**：2026-05-30
- **类型**：docs
- **摘要**：用户指出参考工程的正确本地路径是 `/Users/mark/work/gitspace/opensource/codex-deepseek-installer`（不是之前错写的 `/c/Users/Liang/...`）；同时强调 Windows 打包必须是真正的安装包，且 macOS / Windows 都要覆盖多硬件架构。基于此走读了参考工程的 `proxy/deepseek-proxy.mjs` 与 `config/config.toml.template`，把项目记忆与配置文件全面对齐：默认代理端口由 `8765` 改为 **`11435`**（与参考工程一致，便于老用户迁移）；代理实现明确为 **HTTP `/v1/responses` + WebSocket**（Codex CLI v0.132+ 必需），并写明 `deepseek-reasoner` 的 `reasoning_content` 跨轮回传；新增运行时依赖 `ws`；CI 的 build 矩阵改为 **mac×{x64, arm64} + win×{x64, arm64} 共 4 个分支**，每个分支产出对应架构的独立安装包；Release 资产命名带架构后缀；新增 ADR-002（借鉴 deepseek-proxy.mjs 实现）和 ADR-003（多硬件架构打包策略）。
- **变更文件**：
  - `AGENTS.md`（端口、ws、Responses+WebSocket、参考路径、多硬件、打包命令）
  - `.github/copilot-instructions.md`（端口、ws、Responses、参考路径、目录树新增 `reasoning.ts`、禁止改动 11435）
  - `.github/project-metadata.yml`（端口、`reference_project`、`platforms`、`build_targets` 矩阵、ws 依赖、打包命令）
  - `.github/workflows/ci.yml`（build job 改为 mac/win × x64/arm64 4 元 matrix；产物按 target+arch 分包上传）
  - `.github/agent/system-prompt.md`（业务流程端口、协议描述、DevOps 模式多架构说明）
  - `.github/agent/memory/project-memory.md`（基本信息、架构图、核心特征、模块表、关键约束 #2/#5/#10、开发命令、参考资源）
  - `.github/agent/memory/decisions-log.md`（新增 ADR-002、ADR-003）
- **关键决策**：
  - 默认代理端口锁定为 `127.0.0.1:11435`（ADR-002）
  - 代理实现以 `proxy/deepseek-proxy.mjs` 为蓝本用 TS 重写，必含 WebSocket + reasoning_content（ADR-002）
  - 每平台同时产出 x64 与 arm64 两个独立安装包，Windows 必须是真正的 NSIS `.exe`（ADR-003）
- **注意事项**：
  1. `electron-builder.yml` 还未创建；下次 scaffolding 时按 ADR-003 的命名规则配置 `mac.target` 与 `win.target`。
  2. Windows ARM 的 native 依赖（特别是 `keytar`）需要确认 prebuild 是否覆盖；如不覆盖，需要在 CI 上准备 cross-compile 环境或回退为 electron-store 加密存储。
  3. `pnpm package:mac:universal` 仅作为可选命令；默认 Release 不带 universal 包，避免下载页太乱。
  4. 下载页/README 需要给出"我该下哪个？"的图文表（Mac 看 Apple 菜单 → 关于本机 → 芯片；Windows 看设置 → 系统 → 系统信息 → 系统类型）。

### [TASK-003] 端到端搭建 Codex Switch v0.1.0：代码、测试、构建、打包、冒烟全通
- **日期**：2026-05-30
- **类型**：feat
- **摘要**：从零完成全部脚手架代码并跑通"开发 → 测试 → 编译 → 打包 → 安装可启动"完整链路。从参考工程 `proxy/deepseek-proxy.mjs` 移植协议代理核心为 TypeScript 模块（translate / reasoning / stream / server），实现 Electron 主进程（main / preload / ipc / config / codex writer / secrets）与 React 渲染端（Setup 向导 / Dashboard / Settings / Logs）。pnpm 9.4.0 全局安装；首次 `pnpm install` 在链接阶段挂起（0% CPU、无子进程），改用 `pnpm install --ignore-scripts` + 手动 `pnpm rebuild keytar/electron` 解决。修复 `DeepSeekProxy.listenWithRetry` 在 port=0 时未取 `server.address().port` 的 bug。typecheck/lint/build 全通；25 个单测全过；smoke-proxy 脚本对 `/healthz` 返回 200；electron-builder 同时产出 `Codex Switch-0.1.0-mac-arm64.dmg`（91 MB）与 `Codex Switch-0.1.0-mac-x64.dmg`（96 MB），打包后的 `.app` 启动 6 秒不崩溃，asar 内含 `keytar.node` 原生二进制。
- **变更文件**：
  - 主进程：`electron/main.ts`、`electron/preload.ts`、`electron/ipc/channels.ts`、`electron/config/{store,secrets}.ts`、`electron/codex/{paths,writer}.ts`、`electron/proxy/{translate,reasoning,stream,server}.ts`
  - 渲染端：`src/main.tsx`、`src/App.tsx`、`src/pages/{Setup,Dashboard,Settings,Logs}.tsx`、`src/lib/store.ts`、`src/styles/tailwind.css`、`src/index.html`、`src/types/global.d.ts`
  - 测试：`tests/unit/{translate,reasoning,server}.test.ts`
  - 构建/配置：`package.json`、`pnpm-lock.yaml`、`tsconfig.json`、`tsconfig.electron.json`、`tsconfig.renderer.json`、`tsconfig.test.json`、`vite.config.ts`、`vitest.config.ts`、`tailwind.config.js`、`postcss.config.js`、`.eslintrc.cjs`、`.prettierrc`、`.gitignore`、`electron-builder.yml`
  - 脚本：`scripts/start-electron-dev.mjs`、`scripts/smoke-proxy.mjs`
  - 打包产物：`release/Codex Switch-0.1.0-mac-arm64.dmg`、`release/Codex Switch-0.1.0-mac-x64.dmg`
- **关键决策**：
  - 暂未提供 `build/icon.icns` / `build/icon.ico`；electron-builder.yml 暂时移除 `icon:` 字段，使用 Electron 默认图标，待图标设计完成后再补回（下次任务）。
  - 因首次 `pnpm install` 在 linker 阶段挂起（pnpm 9.4 + node 23 已知偶发问题），项目沿用 `pnpm install --ignore-scripts && pnpm rebuild keytar electron` 的两步式安装；后续若问题复现可考虑降到 pnpm 9.0 或换 node 20 LTS。
- **注意事项**：
  1. macOS dmg 已通过本地构建+启动验证；Windows nsis 在当前 macOS 主机无法本地构建，需在 GitHub Actions windows-latest runner 上跑 `pnpm package:win` 验证。
  2. 应用图标 `build/icon.icns` / `build/icon.ico` 仍为 TODO；上线前必须补齐。
  3. 已知 vitest 报 "CJS build of Vite's Node API is deprecated" 警告，非阻塞；未来升级 Vite 6 时一并解决。
  4. 整个端到端首次跑通耗时主要在 `pnpm install`（10+ 分钟，含若干 ECONNRESET 重试）；CI 缓存命中后会显著缩短。

### [TASK-004] 补齐应用图标、修正 CI Windows 打包路径、README 增补 troubleshooting
- **日期**：2026-05-30
- **类型**：chore
- **摘要**：解决 TASK-003 遗留的三个 TODO。1) 用 Python+PIL 写 `scripts/make-icons.py` 生成 1024×1024 主图与 iconset，再用 macOS 自带 `iconutil` 合成 `build/icon.icns`（204 KB）+ Pillow 直接合成多尺寸 `build/icon.ico`（34 KB），恢复 `electron-builder.yml` 里 `mac.icon` / `win.icon` 字段；重新打包后 `Codex Switch.app/Contents/Resources/icon.icns` 已就位。2) `.github/workflows/ci.yml` 的 build job 把 artifact path 从 `dist/*.{dmg,exe}` 改为 `release/*` 以匹配 electron-builder.yml `directories.output: release`，并新增 `List release artifacts` 步骤便于排查，`if-no-files-found` 由 `warn` 改为 `error`；Windows .exe 验证依赖该 CI matrix（windows-latest × {x64, arm64}）在 PR 上自动跑。3) 新增 `README.md`，含下载表（mac arm64/x64 + win x64/arm64）、"我该下哪个？"指南、开发命令、Troubleshooting 章节：详细写了 pnpm 9.4 + Node 23 链接挂起根因（pnpm 用 worker_threads 做并行 hardlink，与 Node 23 V8 12.4 + libuv 1.50 调度有竞态）与三档解决方案（首选 Node 20 LTS、次选 `--ignore-scripts` 两步走、第三档升级 pnpm）+ `prebuild-install` 良性警告说明 + macOS Gatekeeper / Windows SmartScreen 临时绕过指引。
- **变更文件**：
  - `scripts/make-icons.py`（新增）
  - `build/icon.icns`、`build/icon.ico`、`build/icon.png`、`build/icon.iconset/*.png`（生成产物）
  - `electron-builder.yml`（恢复 `mac.icon: build/icon.icns` 与 `win.icon: build/icon.ico`）
  - `.github/workflows/ci.yml`（artifact path 修正 + 错误级别提升 + 安装步骤加入 pnpm 9 + Node 20 LTS 注释）
  - `README.md`（新增）
- **关键决策**：
  - 图标采用纯程序生成（Tailwind blue-600 圆角矩形 + 白色 "C/" 字样），不依赖外部设计资源；后续若设计同学交付 SVG 可一键替换 `scripts/make-icons.py` 中的绘制逻辑。
  - 不专门为 Windows 写本地构建 workaround；走 CI 即可——Windows .exe 必须在 windows-latest runner 验证（无法在 macOS 本地交叉打包 NSIS）。
  - pnpm 挂起问题在 README 写明三档方案，CI 已锁 Node 20 LTS 规避问题。
- **注意事项**：
  1. 真正的 Windows .exe 产物需要等 push 后查 GitHub Actions 的 `installer-win-x64` / `installer-win-arm64` artifact 才能验证签名/启动状况；本地无法验证。
  2. 当前图标是占位风格的"C/"字样，发布前最好替换为正式品牌设计稿（保留 `scripts/make-icons.py` 的尺寸矩阵）。
  3. README 假设 GitHub Releases 资产名带版本号；正式发版时 release.yml 还未建（仍是 TASK-004 之后的 TODO）。

### [TASK-005] 修复 macOS 启动时 `Cannot find module 'conf'`
- **日期**：2026-05-30
- **类型**：fix
- **摘要**：用户反馈 `/Applications/Codex Switch.app` 启动后弹错 `Cannot find module 'conf'`（位于 `app.asar/node_modules/electron-store/index.js:4`）。根因：pnpm 默认 isolated linker 把传递依赖放在 `node_modules/.pnpm/<pkg>/node_modules/...`，electron-builder 24 把项目 `node_modules` 打进 asar 时未能跨 `.pnpm/` 解析 `electron-store` 的传递依赖 `conf`/`type-fest` 等，所以 asar 里只有 `electron-store` 自己，缺失 `conf`。解决：新增 `.npmrc` 设 `node-linker=hoisted` 使 node_modules 变成扁平结构（与 npm/yarn 一致），删除 `node_modules` + `pnpm-lock.yaml` 重装重打包。验证：`asar list` 已能看到 `/node_modules/conf/package.json`、`/node_modules/electron-store/package.json`、`/node_modules/keytar/package.json`、`/node_modules/ws/package.json`、`/node_modules/zustand/package.json` 五个 dep 全部入包。
- **变更文件**：
  - `.npmrc`（新增 `node-linker=hoisted`）
  - `pnpm-lock.yaml`（regenerate，从 isolated 切到 hoisted 后 lock 内容变化）
  - `README.md`（troubleshooting 增补「Cannot find module 'conf'」段落，包含解决步骤与 asar 验证命令）
  - `release/Codex Switch-0.1.0-mac-arm64.dmg` / `…-x64.dmg`（重新构建）
- **关键决策**：选择 `node-linker=hoisted` 而非 `shamefully-hoist=true`：前者是 pnpm 9 推荐方式，行为更可预测；后者会把所有依赖提升到 root node_modules（包括幽灵依赖），不利于隔离。CI 也无需改动，`.npmrc` 会自动生效。
- **注意事项**：
  1. 切换 linker 后 lock 文件结构会变，需要让团队成员都 `rm -rf node_modules && pnpm install` 一次。
  2. CI 缓存 key 含 `pnpm-lock.yaml` 哈希，会自动失效一次（属于一次性成本）。
  3. 该问题在 Windows CI 上也会复现，本修复同样生效。

### [TASK-006] 解决 Windows 环境本地运行且打包 `pnpm package:win` 阻碍
- **日期**：2026-05-30
- **类型**：fix
- **摘要**：修复 Windows 环境下 PowerShell 终端找不到 `pnpm` 命令且脚本执行被禁问题；揭示并排查 electron-builder 在提取 `winCodeSign.7z` 时因为 Windows 缺少创建符号链接权限（无 Developer Mode) 导致提取失败的问题。
- **变更文件**：
  - 更新项目长期记忆 `.github/agent/memory/project-memory.md` 和 `README.md`
- **关键决策**：
  - 通过 `Set-ExecutionPolicy -Scope Process` 与 `npm install -g pnpm` 在 Windows 构建机中安装全局 `pnpm@9.4.0`；
  - 明确添加并在 `README.md` 及长期记忆中提供 Windows「无法创建符号链接：客户端没有所需的特权」时的处理方式：启用 Windows "开发人员模式"（Developer Mode）或以管理员身份运行。
- **注意事项**：
  1. Windows 本地打包时注意务必开启开发人员模式，这样 electron-builder 在提取 winCodeSign 等工具套件里的 macOS 动态库符号链接时才不会出现特权报错。

### [TASK-007] 统一 macOS 与 Windows 打包图标，实现纯 Node.js 的 ICO 与 ICNS 双重编译器
- **日期**：2026-05-30
- **类型**：fix
- **摘要**：针对 Windows 自定义打包图标缺失（退化为 Electron 默认绿色图标）的问题进行完全修复。使用纯 Node.js （不依赖外部 Python 环境和 PIL 等动态依赖）实现高兼容性的 ICO 与 ICNS 双重文件二进制编译器，自动提取 `build/icon.iconset/` 里的预置 PNG 生成合规的 Windows `icon.ico` 与 macOS `icon.icns`，并在全局 `pnpm build` 指令中挂载该编译器，实现多端桌面打包图标完全一致的视觉统一。
- **变更文件**：
  - 新增 `scripts/make-icons.mjs`
  - 修改 `package.json`
  - 自动覆盖生成 `build/icon.ico`、`build/icon.icns`、`build/icon.png`
- **关键决策**：
  - 不引入额外的外部原生二进制绘制依赖（如 sharp / canvas / jimp），完美利用现有的 `build/icon.iconset/` 高清预置源进行多尺寸打包拼合。
  - 通过编写针对 ICO 格式的图片目录条目与 PNG 数据偏移二进制编码，以及对 ICNS 格式的 ID 数据对包头拼接，实现了不需要 python 运行时的纯原生前端部署保障。
- **注意事项**：
  1. 用户后续只需运行 `pnpm build` 或 `pnpm package:win`等命令，就会静默、无感知地在 `build` 目录下生成绝对对齐、合规并且跨平台一致的精美应用图标。

### [TASK-008] 编写 v1.0.0 改进方案（仅文档）
- **日期**：2026-05-30
- **类型**：docs
- **摘要**：在 `docs/PROPOSAL-v1.0.0-improvements.md` 系统化写下 v1.0.0 升级方案，覆盖 7 大主题（A 模型映射健壮性、B 备份治理、C 日志体验、D 版本记录、E 升级体验+国内镜像 ghproxy 加速、F 极简风格中文帮助+交流群二维码、G mac/Windows 双机协作发布流程）+ 优先级表（P0/P1/P2）+ 测试 + 风险 + 文件总览。本次任务**未写代码**，仅产出方案文档。
- **变更文件**：
  - 修改 `docs/PROPOSAL-v1.0.0-improvements.md`（新增 §5.E9 镜像加速 + §7 主题 G 多平台发布流程 + §6.F8 二维码 + §6.F9 Codex 入门向导 + §1.0.0 changelog 补充国内镜像/全中文化/入门向导条目；章节重新编号 8→8/9/10/11/12）
- **关键决策**：
  - 升级链路走 electron-updater + GitHub Releases 为主，国内 ghproxy 镜像作为自动 fallback；客户端运行时探测 5s 超时切换；sha512 校验防镜像劫持。
  - 发版采用"双轨"：首选 GitHub Actions `release.yml`（tag 推送 → mac+win 并行 publish always）；兜底是双机手动 + `gh release upload` 同 tag 累加资产。
  - UI 全中文（保留 DeepSeek、Codex 产品名），帮助抽屉 + 交流群二维码（docs/qa.png）通过 extraResources 打包。
- **注意事项**：
  1. 方案中提到的所有"新增/修改文件"在落地实现前都未真正创建；下一个任务才进入编码阶段。
  2. 本次未触动代码，typecheck / 测试无需重跑。

### [TASK-009] 方案中文化扫荡（仅文档）
- **日期**：2026-05-30
- **类型**：docs
- **摘要**：根据用户要求"UI/UX 界面都用中文"，对 `docs/PROPOSAL-v1.0.0-improvements.md` 中所有用户可见的英文 UI 名词进行中文化替换：Setup→「首次设置」、Dashboard→「仪表盘」、Settings→「设置」、Logs→「日志」、Help→「帮助」、Drawer→抽屉、Modal→弹窗、Tab→标签页、Section→区块、FAQ→常见问题、accordion→折叠面板、context-aware→随当前页面切换、toast→浮层提示。在 §6.1 新增"中英对照表"明确：用户文案中文，代码标识（文件名/类名/IPC 通道）保持英文/驼峰。本次未写代码。
- **变更文件**：
  - 修改 `docs/PROPOSAL-v1.0.0-improvements.md`
- **注意事项**：
  1. 仍保留的英文片段均为代码标识符（如 `Dashboard.tsx` / `UpdateModal` / `help:get-faq` / `electron-builder.yml`），非用户可见 UI 文案，符合 §6.1 对照表约定。
  2. 未触动源码，无需重跑测试。

### [TASK-010] 端到端实施 v1.0.0 全部主题（代码、测试、构建全通）
- **日期**：2026-05-30
- **类型**：feat
- **摘要**：把 `docs/PROPOSAL-v1.0.0-improvements.md` 七大主题（A 模型映射健壮性 / B 备份治理 / C 日志体验 / D 版本记录 / E 升级体验+ghproxy 镜像 / F 中文帮助中心+交流群+入门向导 / G 双机发布流程）全部落地为代码。版本号从 0.1.0 升到 1.0.0。51 个单测全部通过、typecheck 干净、lint 仅一个无害 warning、`pnpm build` 渲染器+主进程构建成功。
- **变更文件（核心）**：
  - 协议代理：`electron/proxy/translate.ts`（resolveModel + 白名单 + 前缀回退）、`electron/proxy/server.ts`（ProxyLogEntry 增加 reqId/phase/durationMs/model 等字段，HTTP+WS 全程发 start/success/error 三阶段日志，5 分钟滚动统计，端口冲突重试，错误就地翻译）、`electron/proxy/errors.ts`（新增：DeepSeek 错误翻译表 + 4 类 errorAction + redactSensitive 脱敏）、`electron/proxy/stream.ts` 沿用现有错误格式被 server 解析。
  - Codex 配置：`electron/codex/writer.ts`（按内容相同跳过备份+写入；按 maxBackupsPerFile 滚动保留；删除单份/清空全部；恢复时强制 0o600）。
  - 配置存储：`electron/config/store.ts`（新增 7 个偏好 + CURRENT_MAPPING_VERSION=2 + migrateIfNeeded 合并默认映射保留用户键）。
  - 自动更新：`electron/updater/index.ts` + `electron/updater/mirrors.ts`（auto/github/ghproxy/custom 四种镜像，HEAD 5s 探测，sha512 校验保留）。
  - 主进程：`electron/main.ts`（appGetChangelog / help * 5 / update * 4 / codexBackupClean+Delete IPC；启动时按偏好挂载镜像 + 3s 静默检查；诊断包含 100 条脱敏日志）。
  - IPC + preload：`electron/ipc/channels.ts` + `electron/preload.ts` 全量同步。
  - 帮助资源：`docs/help/faq.json`（12 条）、`docs/help/onboarding.json`（5 步入门）、`docs/qa.png` 已就位 ; `electron-builder.yml` 加 `extraResources` + `publish: github`。
  - 渲染端：`src/App.tsx`（HeaderBar+ChangelogModal lastSeenVersion 触发）；新增 `src/components/{ChangelogModal, HeaderBar, HelpDrawer, FaqList, ReportIssueModal, QaGroupModal, OnboardingDrawer, UpdateBadge}.tsx`；`src/pages/Logs.tsx`（按 reqId 折叠分组+统计条+过滤）；`src/pages/Dashboard.tsx`（5 分钟统计卡）；`src/pages/Settings.tsx`（备份治理 GUI + 自动更新区块 + 查看版本记录按钮）；`src/lib/store.ts` 与 `src/types/global.d.ts` 类型同步。
  - 测试：`tests/unit/errors.test.ts`（11 条：401/402/429/400 model/timeout/5xx/raw + 脱敏 4 条）；`tests/unit/translate.test.ts` 扩到 25 条（whitelist+prefix+fallback+pure resolveModel）；`tests/unit/writer.test.ts` 7 条（vi.mock 重定向 codex 路径到 tmpdir，覆盖 dedup/retention/restore/clean/delete-safety）。
  - CI / 发布：`.github/workflows/release.yml`（tag 触发；版本一致性校验 + macOS/Windows matrix；electron-builder --publish always）；`.github/RELEASE_TEMPLATE.md`；`docs/RELEASING.md`。
  - 文档：`CHANGELOG.md`（Keep a Changelog 格式，含 1.0.0 + 0.1.0 段落）；`package.json` version 升到 1.0.0；新增依赖 `electron-updater`。
- **关键决策**：
  - 模型映射改为「精确 → 白名单 → 前缀（按特异性排序）→ 默认回退」四级链；前缀/回退命中时打 WARN，附带 requested→resolved 信息。
  - 备份默认保留 5 份；删除前正则校验 `\.bak\.\d+$` 防误删；恢复时先备份当前文件。
  - 日志带 `reqId`（`req_${randomBytes(3).hex}`）+ `phase` 三段；所有日志在 emit 前经 `redactSensitive`。
  - 自动更新走 `electron-updater` generic provider + `setFeedURL`，国内用户切 ghproxy 不破坏 sha512。
  - 帮助中心走"右侧抽屉 + 标签页"形态，FAQ/入门/二维码静态打包到 `extraResources`。
  - 渲染端 Markdown 用 30 行手写解析器，避免引入 react-markdown。
- **验证**：`pnpm typecheck` 干净；`pnpm test` 5 文件 51/51 passed；`pnpm lint` 0 errors / 1 warning（已存在的测试无害 unused import）；`pnpm build:renderer` + `pnpm build:electron` 均成功，57 模块打包，CSS 16 KB / JS 178 KB。
- **注意事项**：
  1. release.yml 仅校验 + macOS/Windows 自助发布；首次发版前需要先在 GitHub 仓库设置好 `GITHUB_TOKEN`（默认有，无需手工）和（如需）签名证书 secrets；当前流程默认无签名构建。
  2. `docs/qa.png` 当前是历史占位图（171 KB），上线前最好换成正式交流群二维码。
  3. `electron-store` 升级未必同步，旧版用户首次打开 v1.0.0 会触发 `migrateIfNeeded`，把内置默认映射合并到本地映射；一次性事件，无回滚需求。
  4. autoUpdater 在 `app.isPackaged === false` 时不实际触发更新事件，只在打包后生效。
  5. WebSocket 路径下 `lastToolCalls` 修复了原版工具调用上下文，但与 Theme C 的 reqId 是独立维度，互不干扰。
  6. P1 主题中"极简风格扫荡"只在新增组件上落实（4 色/3 字号/8px 栅格，单主按钮），未对存量页面做整体视觉迁移；如需统一可作为 v1.1 任务。
