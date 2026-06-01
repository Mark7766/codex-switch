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

### [TASK-023] 修复多工具调用导致 DeepSeek 400 错误
- **日期**：2026-06-01
- **类型**：fix
- **摘要**：`itemsToMessages` 将每个 `function_call` 翻译成独立的 assistant 消息，当同一轮次有多个工具调用时 DeepSeek 报 400："An assistant message with tool_calls must be followed by tool messages"。改用 while 循环将连续 `function_call` 合并为一条 `assistant` 消息的 `tool_calls` 数组；新增两个测试用例验证分组逻辑。
- **变更文件**：
  - `electron/proxy/translate.ts`（`itemsToMessages` 从 for-of 改为 while 循环分组）
  - `tests/unit/translate.test.ts`（新增 2 个分组测试；修正断言：multi-turn 应为 7 条消息而非 6 条）
  - `CHANGELOG.md`（追加至 v1.2.1）
- **发布**：v1.2.1 tag force-pushed；GitHub Release 更新说明
- **注意事项**：CI 会重新构建 v1.2.1 DMG 和 exe；安装包会替换旧 v1.2.1 资产

### [TASK-022] 修复 Windows 升级程序被锁定导致失败
- **日期**：2026-06-01
- **类型**：fix
- **摘要**：针对 Windows 升级时 "Codex Switch.exe was not closed" 报错，优化了退出与升级流程。① 新增 `isInstallingUpdate` 状态；② `IPC.updateInstall` 异步清理资源后再调用 `quitAndInstall`；③ `before-quit` 触发后最终调用 `app.exit(0)` 而非 `app.quit()` 以确保进程物理终止。
- **变更文件**：
  - `electron/main.ts`（增加 `isInstallingUpdate`，重写 `updateInstall` handler 增加 cleanup，重写 `before-quit` 使用 `app.exit(0)`）
  - `package.json`（v1.2.0 → v1.2.1）
  - `CHANGELOG.md`（新增 v1.2.1 记录）

### [TASK-021] 修复日志 token 数字前多了硬编码 "5"
- **日期**：2026-06-01
- **类型**：fix
- **摘要**：`server.ts` 第 1022 行 log message 模板中有硬编码的 `5`，导致详细日志显示 `↑57367↓220` 而实际 inputTokens 字段值是 7367。Badge 和 lifetime 统计是正确的；只是日志消息字符串多了一个 `5`。
- **变更文件**：`electron/proxy/server.ts`（移除 tokenTag 模板里的硬编码 `5`）

### [TASK-020] 修复端口变更后 Codex Desktop 仍用旧端口
- **日期**：2026-06-01
- **类型**：fix
- **摘要**：根因是 Codex Desktop 读取 config.toml 是在启动时一次性加载，不动态重载；Codex Switch 写配置无误。修复方向：在 `applyPreferencesTransaction` 返回 `portChanged` 字段，Settings.tsx 端口变更时弹出 info 提示"请手动重启 Codex Desktop 使新端口生效"。
- **变更文件**：
  - `electron/main.ts`（函数返回类型新增 `portChanged: boolean`；return 语句补充字段）
  - `src/types/global.d.ts`（`applyPreferences` 返回类型新增 `portChanged: boolean`）
  - `src/pages/Settings.tsx`（`savePrefs` 在 `res.portChanged` 为真时追加 info toast）
- **注意事项**：DMG 已重新构建（v1.2.0 arm64+x64），等待用户验证后再 push+tag。

### [TASK-019] v1.2.0 拦截过滤 + Token 计费
- **日期**：2026-06-01
- **类型**：feat
- **摘要**：两大功能：① 拦截请求不计入统计，日志默认隐藏，可切换显示；② DeepSeek token 消耗追踪（per-request + lifetime 持久化）。
- **变更文件**：
  - `electron/proxy/stream.ts`（StreamResult 增 `usage: {inputTokens, outputTokens, totalTokens}`，resolve 时从 upstreamUsage 填充）
  - `electron/proxy/server.ts`（RequestStats 增 pendingInput/OutputTokensDelta；recordSuccess：isBlocked 时跳过 stats，accumulate token deltas，log entry 带 token 字段；consumeLifetimeDelta 返回 token 增量；handleWs: stats.total/pendingDelta 移至 blocked check 之后才累加；handleResponses/handleWs streamDeepSeek 调用处解构 usage 传递）
  - `electron/config/store.ts`（UserPreferences + DEFAULTS 增 lifetimeInputTokens / lifetimeOutputTokens / tokenSavingEnabled 预留）
  - `electron/main.ts`（flushLifetime 消耗 token delta 并写 prefs；proxy:info lifetime 返回 inputTokens + outputTokens）
  - `src/types/global.d.ts`（LifetimeStats 增 inputTokens / outputTokens；proxyInfo 日志条目类型增 inputTokens / outputTokens）
  - `src/lib/store.ts`（LogEntry 增 inputTokens / outputTokens；Lifetime 增 inputTokens / outputTokens；初始值补 0）
  - `src/pages/Logs.tsx`（showBlocked 默认 false；groups 按 showBlocked 过滤；统计条改为"显示/隐藏拦截请求(N)"切换按钮；Group 增 token 字段；groupByReqId 捕获 token；成功行末尾显示 ↑X ↓Y tokens）
  - `src/pages/Dashboard.tsx`（累计区块条件渲染 输入/输出/总 token 三格；新增 formatTokens helper）
  - `package.json`（1.1.10 → 1.2.0），`CHANGELOG.md`
- **验证**：`pnpm typecheck` ✅ / `pnpm test` 78/78 ✅ / DMG 构建 arm64 92M + x64 97M ✅
- **注意事项**：
  1. token 数据从 DeepSeek SSE 末尾 usage 字段提取（prompt_tokens/completion_tokens/total_tokens 映射为 input/output/total）
  2. blocked 请求零 token、不写 stats、不计入 lifetime，但仍写 ndjson 日志文件（可 debug）
  3. `tokenSavingEnabled` 字段预留给未来付费"节省 token"功能，本期不实现逻辑
  4. 未推送远程仓库，等用户验证后再 push

### [TASK-018] v1.1.0 稳定性专项实现（PR1-PR4 一次性合入）
- **日期**：2026-06-01
- **类型**：feat / fix
- **摘要**：按 `docs/PROPOSAL-v1.1.0-stability.md` §12 顺序一次性实现全部 6 大稳定性主题。**P0 bug 修复**：设置端口 → 停用 → 启动后端口与设置不一致——根因是 ① `start()` 在 EADDRINUSE 时静默 +1 ② `stop()` 没重置 `actualPort` ③ Dashboard 未跟随 polling 更新 port ④ 改 prefs 没同步写 `~/.codex`。修复方式：server 状态机化（串行任务队列、`server.listening` 为真相、3s 硬 stop+`closeAllConnections`、不再自动 +1）+ `prefs:apply` 事务化 IPC（store→`~/.codex`→必要时 restart）+ Dashboard 跟随 `info.port` 实时更新。
- **新增模块**：
  - `electron/proxy/portInfo.ts`（lsof/netstat+tasklist 查询占用 + 安全 kill：黑名单 launchd/svchost.exe、拒绝 pid<=1/self、SIGTERM→5s→SIGKILL）
  - `electron/proxy/persistentLog.ts`（10MB×5 文件 ndjson 滚动、50MB prune、loadTail 反向读、坏行 skip）
  - `src/components/Toast.tsx`（2s 自动消失）
  - `src/components/PortConflictModal.tsx`（按钮顺序：关闭进程并重试 PORT / 打开设置改端口… / 取消）
  - 测试：`tests/unit/portInfo.test.ts`(7) `persistentLog.test.ts`(6) `server.lifecycle.test.ts`(5) — 全部通过
- **变更文件**：
  - `electron/proxy/server.ts`（增 ProxyErrorKind/Info、taskQueue、autoRecover 3×退避、consumeLifetimeDelta、stop 3s 硬超时）
  - `electron/config/store.ts`（+5 字段：lifetime{RequestCount,UptimeSec,FirstStartAt} / lastError{Message,At}；migrate 在首次 v1.1.0 启动写入 firstStartAt=今天）
  - `electron/ipc/channels.ts`（+10 新通道：proxyLookupPort/KillPort/OnError、prefsApply、logsLoadPersisted/Clear/OpenDir/GetStats、appOnSecondInstance）
  - `electron/preload.ts`（镜像 +10 通道、新 api：applyPreferences / proxyLookupPort / proxyKillPort / onProxyError / onSecondInstance / loadPersistedLogs / clearPersistedLogs / openLogsFolder / getLogsStats）
  - `electron/main.ts`（单实例锁 + second-instance toast、PersistentLog 实例 + prune、事务化 prefsApply handler、proxy:on-error → setPreferences(lastError)、30s lifetime flush、before-quit 3s 硬超时 + app.exit(0) 兜底；总 LOC=509，**超过 400 行约束**，TODO 后续拆分到 `electron/ipc/handlers.ts`）
  - `src/types/global.d.ts`（PortHolder / ProxyErrorInfo / LifetimeStats 类型 + 新 api 方法）
  - `src/lib/store.ts`（lifetime / lastError / toasts / portConflict）
  - `src/App.tsx`（订阅 onProxyError → port-conflict 时 lookupPort 后开 PortConflictModal；onSecondInstance toast）
  - `src/pages/Dashboard.tsx`（polling 更新 port、累计区块、firstStartAt 文案）
  - `src/pages/Settings.tsx`（移除 "保存偏好/重新写入 ~/.codex" 双按钮，合并为 "保存并应用" 调 applyPreferences）
  - `src/pages/Logs.tsx`（mount loadPersistedLogs(500)、显示文件总量、清空/打开目录按钮）
  - `package.json` → 1.1.0；`CHANGELOG.md` 写入 1.1.0 条目
- **验证**：`pnpm typecheck` ✅、`pnpm test` 69/69 ✅（其中 §7 lifecycle 测试覆盖串行启动/端口冲突不 +1/stop 重置 port/idle stop 幂等）、`pnpm lint` 仅 1 个预存在 warning。
- **遗留事项**：
  1. `electron/main.ts` 509 行超过项目 400 行硬约束，下一个 PR 拆 IPC handlers 出去。
  2. 未实现 `logs:exportZip`（zip 导出），决议中也未提及；现仅有"打开目录"+"清空"。
  3. 自动恢复路径只有单元覆盖到 schedule，没做完整 e2e 模拟"运行中 crash → 重启成功"。
  4. lifetime flush 用 baseline diff (sessionLastUptimeMs)，代理重启会清零 baseline，正确；但需注意应用整个生命周期内每 30s 累加，长会话下精度足够。

### [TASK-017] v1.1.0 稳定性优化方案（仅文档，Review 通过）
- **日期**：2026-05-31
- **类型**：docs
- **摘要**：编写并完成 review `docs/PROPOSAL-v1.1.0-stability.md`，最终覆盖 6 大稳定性主题：①端口冲突弹窗+kill 占用进程（不再私自换号）②设置页 `保存并应用` 单按钮事务化（**不保留**单独重写 `~/.codex` 的二级菜单）③日志 ndjson 持久化（**10 MB × 5 文件 = 50 MB 上限**，硬编码不给滑杆）④单实例锁（toast 2 秒）⑤主面板累计统计持久化到 electron-store（lifetime 字段+30s 节流，文案"自 v1.1.0 升级日起累计"）⑥代理控制可靠性深审：8 处真实缺陷 → 串行队列状态机+健康检查+3 次/1s-3s-9s 退避自动恢复+`app.exit(0)` 硬退出兜底，**不给用户"出错时不自动重启"开关**。**telemetry/安装量统计章节整体移除**（不开发服务端、不预埋客户端上报代码，后续如要做需单独立项+隐私评审）。本任务**未写代码**，Review 已通过，可按方案 §12 顺序开 PR。
- **变更文件**：
  - `docs/PROPOSAL-v1.1.0-stability.md`（v2 终版：移除 §8 telemetry 整章及所有下游引用；§9-§14 重新编号；§14 改为"Review 决议（已确认）"含 7 行决议表）
- **最终决议（用户 2026-05-31 拍板）**：
  - 端口冲突弹窗按钮顺序：`关闭进程并重试 11435` 放第一位（PID 验证+黑名单+uid 校验已充分约束破坏性）
  - 日志保留 50 MB（10 MB×5 滚动），硬编码不出滑杆
  - 单实例 toast 2 秒
  - 设置页 `保存并应用` 单按钮事务化，不保留"单独重写 ~/.codex"入口
  - 累计统计起算时间 = v1.1.0 升级当天，UI 文案 `自 YYYY-MM-DD 起累计`
  - 自动恢复 3 次 / 1s-3s-9s 退避，**不**给用户"禁用自动重启"开关
  - **不做 telemetry**：本期不开发服务端，不预埋客户端上报代码
- **PR 顺序**：PR1=§7 控制可靠性+§5 单实例（最高优先级）→ PR2=§2 端口弹窗 → PR3=§3 保存合并+§6 主面板累计 → PR4=§4 日志持久化 → 合并发 v1.1.0
- **注意事项**：
  1. 实现时 §7 自动恢复仅在"已成功 listen 过、运行期 crash"时触发；EADDRINUSE 一律走 §2 弹窗
  2. lifetime 写盘 + setPreferences 并发需 mutex 串行化
  3. 50 MB ndjson 启动时 `loadTail` 只读尾部 1 MB，不全量加载

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

### [TASK-011] 修复 v1.0.0 发布流水线：Release 资产被并行任务互相清空
- **日期**：2026-05-30
- **类型**：fix / ci
- **摘要**：v1.0.0 已成功打 tag、CI Release run 4 显示"completed successfully"，但 GitHub Release v1.0.0 真实状态为「存在 release 对象但 0 个 asset」（atom feed 看得见、anonymous API 返回 draft-like 空字段、所有 dmg/exe/yml 直接 URL 全部 404）。根因：原 `release.yml` 让 mac/win 两个 matrix 任务各自跑 `electron-builder --publish always`，每个任务在上传前会"列出 release 现有 assets → 删除属于自己输出的同名资产 → 上传"，并行/串行都会互相覆盖；曾尝试 `max-parallel: 1` 仍未解决（最终态为最后一个任务执行清理却没正确补回）。改为「构建-发布」两段式：build 矩阵只产出 dmg/exe/yml/blockmap 并 `actions/upload-artifact`（`--publish never`）；新增 `publish` job 在 ubuntu 上 download-artifact 全部产物，扁平化到 `release/` 后用 `softprops/action-gh-release@v2` 一次性把所有文件附加到 v1.0.0 release（draft:false, prerelease:false, generate_release_notes:true）。同时把 `ci.yml` 的 `PNPM_VERSION` 从裸 "9" 升到 "9.4.0"（pnpm/action-setup@v4 解析裸 "9" 在 Run 5/6 失败）。删除并重新推送 v1.0.0 tag 触发新 run。
- **变更文件**：
  - `.github/workflows/release.yml`（重写：build job → upload-artifact；新增 publish job 用 softprops/action-gh-release）
  - `.github/workflows/ci.yml`（PNPM_VERSION "9" → "9.4.0"）
- **关键决策（ADR-007）**：彻底放弃让 electron-builder 直接 publish 到 GitHub Release；改为 CI 收集 artifacts 后由独立 publish job 用 softprops/action-gh-release 一次性附加。理由：electron-builder GitHub publisher 的 "delete-then-upload" 行为对多平台/多架构并行/串行都不安全；softprops 单点上传是唯一稳定路径；副作用是 release notes 由 GitHub auto-generated 替代 electron-builder（可接受，且仍可读取 CHANGELOG）。
- **验证**：本地 git push tag v1.0.0 后 Run 5 of Release 进入 currently running；待 build job (mac+win) 完成 → publish job 下载 artifact → 创建/更新 release v1.0.0 含 6+ 个 asset（mac arm64 dmg + mac x64 dmg + win x64 exe + win arm64 exe + latest-mac.yml + latest.yml + blockmaps）。
- **注意事项**：
  1. 之前 broken 的 v1.0.0 release 对象会被 softprops 接管；如果新 run 失败需要手动到 GitHub UI 删除该 release。
  2. anonymous GitHub API rate-limit 严重（曾被 IP 85.237.207.179 限流），调试时优先用 atom feed `/releases.atom` 与 `curl -I /releases/download/...` 直探 asset URL 判断状态。
  3. 后续验证 auto-update 链路需要再发 v1.0.1（bump package.json + tag）。

### [TASK-012] 修复 macOS dmg 构建 hdiutil 偶发失败 + macos-13 队列阻塞
- **日期**：2026-05-30
- **类型**：fix / ci
- **摘要**：TASK-011 推完后 Run 5 mac job 在 `electron-builder` dmg 阶段挂掉："Detected arm64 process, HFS+ is unavailable. Creating dmg with APFS" → "hdiutil: attach failed - no mountable file systems"（重试 6 次后死），是 electron-builder 在 macos-latest（arm64 Apple Silicon runner）上的已知偶发问题。先尝试切到 `os: macos-13`（Intel x64）并在 `electron-builder.yml` 把 dmg 显式设为 `format: UDZO, sign: false`；但 macos-13 runner 池排队 25 分钟仍未启动。最终方案：换回 `os: macos-latest`（队列快），保留 dmg `format: UDZO + sign: false`，并把 mac 构建步骤包成 3 次重试 bash 循环（每次失败清 release/ + sleep 10）。Run 7 (commit 3400273) 一次成功：version-check + build mac + build win + publish 全 ✓，v1.0.0 release 现含 23 个 asset（mac x64/arm64 dmg + win x64/arm64/combined nsis exe + 全部 blockmap + latest-mac.yml + latest.yml + builder-debug.yml）。
- **变更文件**：
  - `.github/workflows/release.yml`（matrix mac runner: macos-13 → macos-latest；mac build step 包 3 次 retry 循环）
  - `electron-builder.yml`（dmg.format: UDZO + dmg.sign: false 显式声明）
- **关键决策（ADR-008）**：CI 上 `electron-builder` 的 dmg 步骤必须包重试；macos-latest（arm64）队列性价比 > macos-13（Intel）队列速度。
- **验证**：
  - Release run 26676052084 全 ✓
  - `GET /repos/Mark7766/codex-switch/releases/tags/v1.0.0` → 23 assets，含 `Codex-Switch-1.0.0-mac-{x64,arm64}.dmg`、`Codex-Switch-Setup-1.0.0-win-{x64,arm64}.exe`、`latest-mac.yml`、`latest.yml`
  - 可下载：`https://github.com/Mark7766/codex-switch/releases/tag/v1.0.0`
- **注意事项**：
  1. release 内有重复文件名（`Codex-Switch-` 与 `Codex.Switch-` 各一份），是 TASK-011/TASK-012 早期 run 残留 + softprops 默认不覆盖的副产品；不影响下载与 auto-update（latest-mac.yml / latest.yml 引用的是 `Codex-Switch-` 系列）；如要洁净化可在 GitHub UI 手动删除 `Codex.Switch-*` 同义重复 asset。
  2. `ci.yml`（PR/main matrix）目前在 commit 3400273 仍 failure，与 release 流水线无关，需后续单独排查。
  3. PAT（osxkeychain 提取）拿不到 admin 权限，无法 cancel/重跑队列阻塞的 run；遇到 macos-13 这种长队列阻塞只能靠 push 新 commit 触发新 run。

### [TASK-016] macOS 弃用 Squirrel.Mac 自动升级，改为浏览器手动下载（v1.0.5）
- **日期**：2026-05-30
- **类型**：fix / release / 架构调整
- **摘要**：v1.0.4 客户端升级仍报相同错误 `代码不含资源，但签名指示这些资源必须存在`，证伪 TASK-015 / ADR-012。**真因**：Squirrel.Mac 在解压新版 .app 后会调用 `SecRequirementForLaunchedApp()` 取出当前运行 app 的 designated requirement，再用它校验新版 .app；对未签名 / ad-hoc 签名的 app，该 requirement 是 `cdhash == <某固定哈希>`——跨版本天然不可能成立。这是 Apple 平台对未签名 app 的硬性限制，任何 `identity` / `hardenedRuntime` / `zip target` 调参都绕不过去。**Plan B 落地**：`UpdaterManager.download()` 在 `process.platform === 'darwin'` 时跳过 `autoUpdater.downloadUpdate()`，改为 `shell.openExternal('https://github.com/Mark7766/codex-switch/releases/latest')` 并向渲染层 emit 新事件 `manual-download`，UI（UpdateBadge / Settings）提示「已在浏览器打开下载页，请下载 dmg 拖入 /Applications 替换」；Windows 路径完全不变。bump 1.0.5，commit eecdb22，tag v1.0.5 已推。
- **变更文件**：
  - `electron/updater/index.ts`（import shell；UpdateEvent 增加 `'manual-download'`；download() darwin 分支 → 浏览器打开 + 自定义事件）
  - `src/types/global.d.ts`（UpdateEvent kind 联合类型同步）
  - `src/components/UpdateBadge.tsx`（mac 用户提示按钮 title 改为「前往下载页」；新增 `manual-download` 状态展示）
  - `src/pages/Settings.tsx`（新增 `manual-download` 提示文案）
  - `package.json`（1.0.4 → 1.0.5）
  - `CHANGELOG.md`（[1.0.5] 条目，详细解释 Squirrel.Mac/CDHash 限制）
- **关联 ADR**：ADR-013（macOS 未签名分发禁用 Squirrel.Mac 自动升级路径，回退浏览器手动下载）；ADR-012 标记 SUPERSEDED。
- **注意事项**：
  1. v1.0.0..v1.0.4 已安装的 mac 客户端跑的是旧代码，点「下载更新」依然会触发 Squirrel.Mac 校验失败；这些用户必须**手动**访问 Releases 页面一次性升到 v1.0.5，之后才会走 Plan B。
  2. 等待 v1.0.5 release run 完成后向用户告知一次性手动升级路径。
  3. 长期解决：申请 Apple Developer ID（$99/年），重新启用原生 auto-update。

### [TASK-015] 修复 macOS auto-update Squirrel.Mac 代码签名校验失败（v1.0.4）⛔ SUPERSEDED by TASK-016
- **日期**：2026-05-30
- **类型**：fix / release
- **摘要**：v1.0.3 客户端拉到 zip 后 Squirrel.Mac 安装报 `Code signature at URL ... did not pass validation: 代码不含资源，但签名指示这些资源必须存在`。根因：`electron-builder.yml` `mac.hardenedRuntime: true` 与 `CSC_IDENTITY_AUTO_DISCOVERY=false`（无签名身份）共存时，electron-builder 仍会在 .app 内写入 `_CodeSignature/CodeResources` 清单，但 zip 化过程中清单与实际 bundle 资源不一致，Squirrel.Mac 严格校验时直接拒绝。修复：在 mac 块下显式 `identity: null` + 把 `hardenedRuntime` 从 `true` 改为 `false`，告诉 electron-builder「本构建完全不走签名」，.app 不再写这份不一致的签名清单。bump v1.0.4，release run bf6b2b7 ✓，17 个 asset 齐全，等待用户客户端二次验证升级。
- **变更文件**：
  - `electron-builder.yml`（mac 增加 `identity: null`，`hardenedRuntime: true → false`）
  - `package.json`（1.0.3 → 1.0.4）
  - `CHANGELOG.md`（[1.0.4] 条目）
- **关联 ADR**：ADR-012（未签名 mac 分发**必须** `mac.identity: null` + `mac.hardenedRuntime: false`，否则 .app 内的 _CodeSignature 清单会与 zip 化后的实际资源不一致）。
- **注意事项**：若 v1.0.0 客户端升级到 v1.0.4 仍失败，下一步候选方案是用 `mac.identity: '-'` 做一致 ad-hoc 签名（强制 codesign --sign -），避免 OLD/NEW 签名机制错位。

### [TASK-014] 修复 macOS auto-update "ZIP file not provided"（mac 漏发 zip 产物）
- **日期**：2026-05-30
- **类型**：fix / release
- **摘要**：v1.0.2 客户端在 macOS 调用"检查更新"报 `ZIP file not provided: [{ url: ...mac-arm64.dmg, ... }]`，根因是 electron-updater 在 macOS 上由 Squirrel.Mac 实施原子升级，**只能从 zip 应用补丁**，dmg 仅服务于人工首次安装；而我们 v1.0.0/v1.0.1/v1.0.2 全程只产出 dmg。修复双管齐下：(a) `electron-builder.yml` mac.target 增加 `zip` (x64 + arm64)；(b) `release.yml` 的 `actions/upload-artifact` `path:`、flatten `find` 命令、`softprops` `files:` 三处 glob 全部从 `*.{dmg,exe,yml,blockmap}` 扩展到 `*.{dmg,exe,zip,yml,blockmap}`，否则 zip 在 runner 上构建出来但永远到不了 GitHub Release。bump 到 v1.0.3 + 重发 tag（中途首次推送时第二个 fix 还没合并，强制删除远程 tag 再推到正确 commit），release run 6c35dce ✓，v1.0.3 现含 17 个 asset：dmg/zip 各 2 + blockmap × 4 + win exe × 3 + blockmap × 3 + 2 个 yml + builder-debug；`latest-mac.yml` 头四条文件按 zip(arm64), zip(x64), dmg(arm64), dmg(x64) 排列，`path:` 指向 zip，Squirrel 会优先取 zip。
- **变更文件**：
  - `electron-builder.yml`（mac.target 增加 `- target: zip` arch [x64,arm64]）
  - `.github/workflows/release.yml`（3 处 glob 加 `*.zip`）
  - `package.json`（1.0.2 → 1.0.3）
  - `CHANGELOG.md`（[1.0.3] 条目）
- **关联 ADR**：ADR-011（凡 mac 启用 auto-update 必须同时构建 zip target；release.yml 上传/发布 glob 必须包含 zip）。
- **注意事项**：v1.0.0..v1.0.2 客户端可通过 v1.0.3 升级；通知用户在客户端再点一次"检查更新"。

### [TASK-013] 修复 CI（prettier 参数解析 + 缺 coverage 依赖） + 修复 auto-update 致命 404（artifactName 与 yml 引用不一致）
- **日期**：2026-05-30
- **类型**：fix / ci / release
- **摘要**：用户要求"清理重复资产、排查 ci.yml 失败、发 v1.0.1 测自动升级"。三件事并发处理：
  1. **清理重复资产**：osxkeychain PAT 在仓库 `permissions` 中 `admin/push/maintain` 全 false（git push 走 SSH，与 HTTPS API 是两套 token），DELETE release asset 需要 push，权限不足返回 404；让用户去 UI 删除即可。
  2. **CI 修复**：先发现 `pnpm format -- --check` 在 CI 把 `--check` 当成 prettier 文件 glob，报 "No files matching the pattern"；新增 `format:check` 脚本（`prettier --check .`），`.prettierignore` 排除 lockfile / 自动生成文档 / memory 目录，并对 43 个文件 `pnpm format` 修风格；此后 Lint 通过但 Unit Tests 全 OS 失败：`Cannot find dependency '@vitest/coverage-v8'`，CI 跑 `pnpm test:coverage`；补 `@vitest/coverage-v8@^1.6.0` 到 devDeps。
  3. **auto-update 致命 404**：bump 到 v1.0.1 触发 release 后发现 `latest-mac.yml` 引用 `Codex-Switch-1.0.1-mac-x64.dmg`（连字符），但实际上传的产物是 `Codex.Switch-1.0.1-mac-x64.dmg`（点号）。根因：`electron-builder.yml` 的 `artifactName: ${productName}-${version}-...`，而 `productName: "Codex Switch"`（含空格）在 yml 内部引用时被替换为 `Codex-Switch-`、在文件名渲染时被替换为 `Codex.Switch-`，两边转义规则不一致 → 已发布客户端调用 auto-update 拉 dmg/exe 必 404。修复：把 `artifactName` 中的 `${productName}` 替换为字面量 `Codex-Switch`。bump 到 v1.0.2，release run 全 ✓，13 个 asset 全部统一为 `Codex-Switch-*`，yml 与文件名 100% 一致。
- **变更文件**：
  - `package.json`（新增 `format:check` 脚本，加 `@vitest/coverage-v8` devDep，bump 1.0.0 → 1.0.1 → 1.0.2）
  - `.github/workflows/ci.yml`（`pnpm format -- --check` → `pnpm format:check`）
  - `.prettierignore`（新建：dist/release/node_modules/coverage/pnpm-lock.yaml/CHANGELOG.md/docs/help/*.json/.github/agent/memory/）
  - `electron-builder.yml`（mac/win 的 artifactName: `${productName}-…` → `Codex-Switch-…` / `Codex-Switch-Setup-…`）
  - `pnpm-lock.yaml`
  - `CHANGELOG.md`（[1.0.1]、[1.0.2] 条目）
  - 43 个被 prettier 重排的源文件
- **关键决策（ADR-009）**：electron-builder `artifactName` 中**禁用** `${productName}` 变量，强制用 ASCII 字面量。理由：当 productName 含空格/中文/特殊字符时，electron-builder 在 yml 内部引用与文件名渲染时使用不同转义（空格 → `-` vs 空格 → `.`），导致 auto-update 100% 404，此 bug 隐藏 release 全绿后才能在客户端复现。
- **关键决策（ADR-010）**：项目脚本中 `--check`、`--coverage` 等"模式开关"应有独立脚本（`format:check`、`test:coverage`），而非靠 `pnpm xxx -- --flag` 透传，避免被基础脚本里的位置参数（如 `prettier --write .` 末尾的 `.`）吞掉或误解析。
- **验证**：
  - Local: `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm exec prettier --check .` 全绿
  - Release run 26676429570（v1.0.2）四 job 全 ✓
  - `latest-mac.yml` 引用 `Codex-Switch-1.0.2-mac-{x64,arm64}.dmg` ↔ release 中 asset 名一致；`latest.yml` 同
  - `curl -I https://.../v1.0.2/Codex-Switch-1.0.2-mac-arm64.dmg` → HTTP 302（GitHub CDN 重定向，OK）
- **注意事项**：
  1. v1.0.0 / v1.0.1 release 中的 `Codex.Switch-*` 文件不可被任何已安装客户端通过 auto-update 拉到，但 v1.0.2 客户端起所有命名规范一致，未来都安全。
  2. 用户需手动到 https://github.com/Mark7766/codex-switch/releases/tag/v1.0.0 删除残留的 `Codex.Switch-*` 与 `builder-debug.yml`（11 个文件，本 token 权限不够）。
  3. 已安装的 v1.0.0 客户端因为 yml/文件名不一致**无法自升级到 v1.0.0/v1.0.1**，但**可以自升级到 v1.0.2**，因为 v1.0.2 的 yml/文件名都对。后续 v1.0.x 的 auto-update 链路稳定。
  4. Release Run 在 commit c6738b4 触发，`build (macos-latest)` 跳过 hdiutil 重试一次成功；TASK-012 加的 retry loop 是有效的兜底。


---

## TASK-019：v1.1.1 — 修复 stop() 不真停（已建立连接残留）

- **日期**：2026-06-02
- **类型**：紧急 bug 修复 + patch 发版
- **触发**：v1.1.0 发布后用户反馈："我把代理都停止了，可是 codex 依然可以正常问答，端口依然监听"。`lsof -i:11436` 显示无 LISTEN，但有多条 `Codex Switch` ↔ `codex` 之间的 ESTABLISHED TCP socket。
- **根因**：
  - `http.Server.close()` 默认 graceful——只停止 accept，新连接进不来，已存在的 keep-alive socket 等客户端主动断；
  - `WebSocketServer.close()` 同理，不会主动 `terminate()` 已连接的 ws.clients；
  - 因此 codex CLI 的长连接在 stop 之后还活着；3s 兜底 `closeAllConnections()` 触发太晚且未处理 ws；用户感知是"停止无效"。
- **修复**（`electron/proxy/server.ts` `stopInternal`）：
  - 进入 stopping 状态后**立即**：① 遍历 `wss.clients` 调 `client.terminate()`；② 对 server 调 `closeIdleConnections()` 与 `closeAllConnections()`；
  - 然后再 `Promise.allSettled([wss.close, server.close])` 收尾；3s race 作为最坏兜底；
  - 最后 `removeAllListeners()` 清理；
  - 实测 stop() 用时从最长 3s 降到几十毫秒。
- **测试**：新增 `tests/unit/server.lifecycle.test.ts` 用例 `stop() forcibly terminates established keep-alive connections`：建立 keep-alive 连接 → stop → 断言 `< 1500ms` + 端口不可访问。`pnpm vitest run` 8 文件 70/70 全绿。
- **澄清用户疑问**：`~/.codex/config.toml` 只是把 `base_url` 指向 `127.0.0.1:11435`；codex CLI 自身不会启动任何代理进程。lsof 中的 `Codex\x20` PID 即 Codex Switch 主进程本身——它是端口的唯一持有者。
- **发版**：bump 1.1.0 → 1.1.1；CHANGELOG 1.1.1 段；ADR-016；commit + tag v1.1.1 + push 触发 release CI。

---

## TASK-020：v1.1.2 — UX 反馈补丁（保存按钮点了没反应）

- **日期**：2026-06-02
- **类型**：UX 优化 + patch 发版
- **触发**：用户反馈"保存并应用，点击一点反应都没有"。Settings 页 savePrefs 只把结果写到页面底部一行小字 `msg`，而且按钮没有 loading 态，用户感知是"点了没反应"。
- **修复**：
  - `src/pages/Settings.tsx`：savingKey/savingPrefs 双 loading 态；按钮变 spinner + 文案"正在应用…"+ disabled；接入全局 `pushToast` 三色 Toast（info → success/error）；按钮旁加小字说明会写入 `~/.codex/config.toml`。
  - `src/pages/Dashboard.tsx`：启动/停止代理按钮同款待遇 — spinner + "正在启动…/正在停止…" + 全局 Toast；按钮 `min-w-[110px]` 防抖动。
- **发版**：1.1.1 → 1.1.2；CHANGELOG 1.1.2 段；commit + tag v1.1.2 + push。

## TASK-021：v1.1.3 — CI 修复（Win 重试 + prettier）

- **日期**：2026-06-02
- **类型**：chore / CI
- **摘要**：v1.1.2 流水线 Win build 因 GitHub 镜像 502 抓 nsis-resources 失败；format:check 检出 7 个未走 prettier 的文件。给 release.yml 的 Win build 加 3 次重试（与 mac 一致），跑 `pnpm format`，发版 v1.1.3。

## TASK-022：v1.1.4 — response.completed 字段补全（必要但不充分）

- **日期**：2026-06-02
- **类型**：fix
- **摘要**：用户反馈 codex CLI 一直 "Reconnecting…" 但 proxy 端全 200。补 `response.created`/`response.completed` 的 `created_at / error / incomplete_details / usage` 字段，并给 ws 加 20s 服务端 ping。**事后证明 root cause 不是这些字段**——见 TASK-023。

## TASK-023：v1.1.5 — 真正修复 codex agent 自循环（end_turn 字段）

- **日期**：2026-06-03
- **类型**：fix（关键 bug）
- **触发**：用户反馈 v1.1.4 仍然报错，"问一句话被打 5 次"的 bug 没解决，要求"自己修复、自己测试，保障这次能彻底修复"。
- **诊断**（基于上游 codex 源码 + 本机日志双重佐证）：
  1. 拉 `openai/codex` 仓库源码：`codex-rs/codex-api/src/sse/responses.rs` 的 `ResponseCompleted` 把 `end_turn` 解析为 `Option<bool>`；`codex-rs/core/src/client.rs` 的 agent loop 拿 `ResponseEvent::Completed { end_turn, .. }` 决定是否结束本轮。
  2. 本机 `proxy.ndjson` 显示：单个 WS 连接里出现 5 个连续 `req_xxx → start → success` 周期（间隔仅 ~70ms），最后 1006 断连——典型 agent 自循环。
  3. v1.1.4 的字段只是让响应"长得像"OpenAI Responses，但 codex 真正用来终止 agent loop 的关键字段 `end_turn` 我们没发，被解析为 `None` 后 codex 误判"对话还没结束"，自动同 WS 再发 response.create。
- **修复**：`electron/proxy/stream.ts` 的 `response.completed` 中加入 `end_turn: !hasPendingToolCalls`：没挂起 function_call 就 `true`；有 tool_calls 待执行就 `false`，等 codex 回 function_call_output 后再下一轮。
- **新增**：
  - `tests/unit/stream.endTurn.test.ts`（2 cases）：vi.mock node:https 后注入伪 SSE，断言纯文本 → `end_turn: true`，含 tool_call → `end_turn: false`。72/72 全绿。
  - `electron/proxy/server.ts` 加 `PROXY_DEBUG_WS=1` 开关：开启后 stdout 打印每条 WS 入/出消息原文（截断 600 字符），便于线下排查协议层。
  - `scripts/dev-proxy.cjs`：本地直接跑 dist/electron/proxy/server.js，不用启 Electron 壳，方便用 codex CLI 端到端验证。
- **端到端验证**（用户明确要求"自己测试"）：
  - 关掉用户已运行的 Codex Switch.app，从 keychain 读出 DEEPSEEK_API_KEY，编译电源代码到 dist/，跑 `node scripts/dev-proxy.cjs` + `PROXY_DEBUG_WS=1`。
  - 真实 `codex exec --skip-git-repo-check "Reply with exactly the word PONG..."`，输出仅一句 "PONG"，无 Reconnecting、无重发。
  - WS 抓包：单个 WS 连接里只出现一对 `response.create`/`response.completed`（外加一次 codex 启动时的 warm-up），`end_turn: true` 字段就位；对比修复前 5 次重发，行为符合预期。
- **变更文件**：
  - `electron/proxy/stream.ts`（核心修复，+`end_turn` 字段，+注释解释根因）
  - `electron/proxy/server.ts`（+`PROXY_DEBUG_WS` 开关）
  - `tests/unit/stream.endTurn.test.ts`（new）
  - `scripts/dev-proxy.cjs`（new，dev 工具）
  - `package.json` 1.1.4 → 1.1.5
  - `CHANGELOG.md` v1.1.5 段
- **注意事项**：
  - 参考工程 `codex-deepseek-installer/proxy/deepseek-proxy.mjs` 同样缺 `end_turn`，对老版 codex CLI（不要求该字段）可能没事，但对 v0.135+ 也是潜在 bug，可考虑反哺 PR。
  - 1.1.4 的字段补全（usage/created_at 等）是必要前置：缺这些 codex 会更早判残；只补 end_turn 而忽略它们可能仍出问题。两者一起才完整。
