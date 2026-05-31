# 更新记录

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.1.1] - 2026-06-XX

紧急修复：用户点击"停止代理"后，已建立的 keep-alive / WebSocket 连接仍存活，导致 Codex CLI 还能继续问答。

### 修复
- `stop()` 现在会**立即**强制终止所有 WebSocket 客户端（`ws.terminate()`）与 HTTP 已连接 socket（`server.closeAllConnections()` + `closeIdleConnections()`），不再等到 3 秒超时兜底。
  - 旧实现仅依靠 `server.close()` / `wss.close()`，但二者都只是"停止接受新连接"，对已 `ESTABLISHED` 的 socket 不主动断开；codex CLI 的长连接因此可以在 stop 之后继续穿透。
  - 新增回归测试 `stop() forcibly terminates established keep-alive connections`，断言 stop 用时 < 1.5s 且端口已不可访问。
- 说明：`~/.codex/config.toml` 只是把 `base_url` 指向本地代理；codex CLI 不会自启动任何代理进程。Codex Switch 是端口 11435 的唯一持有者。

## [1.1.0] - 2026-06-XX

稳定性专项：修复"改端口后启动用旧端口"的 P0 bug，并配套上线代理生命周期状态机、端口冲突可视化处置、持久化日志、累计统计、单实例锁、自动恢复（仅运行期 crash）、设置事务化"保存并应用"。详见 `docs/PROPOSAL-v1.1.0-stability.md`。

### 修复
- 修改设置中的本地端口后，停用→启动代理时端口与设置不一致的问题（同时同步写 `~/.codex/config.toml`，并重启代理）。
- `start()` 不再静默把端口 +1 占用其它端口；端口冲突会显式报错并交给用户处置。
- `stop()` 增加 3 秒硬超时与 `closeAllConnections()` 兜底，挂起的 SSE / WebSocket 不会再阻塞退出。

### 新增
- 端口冲突弹窗：识别占用方 PID/进程名，提供"关闭进程并重试 / 打开设置改端口 / 取消"三种操作。
- ndjson 持久化日志：单文件 10 MB 滚动、保留 4 个历史，启动时按 50 MB 上限 prune；日志页支持加载、清空、打开目录。
- 主面板新增累计统计：累计请求数、累计运行时长，自首次升级日起。
- 运行期崩溃自动恢复：3 次退避（1s / 3s / 9s），仍失败则停留在错误态并提示。
- 单实例锁：双击图标弹出"已经在运行"提示并聚焦已存在的窗口。

### 变更
- 设置页将"保存偏好 + 重新写入 ~/.codex"合并为单按钮"保存并应用"（事务化、失败回滚）。
- 状态以 `server.listening` 为准，对外暴露 `stopped/starting/running/stopping/error`。

## [1.0.6] - 2026-05-30

验证 v1.0.5 引入的 macOS “检查更新 → 浏览器手动下载”回退路径，以及 Windows NSIS 原生 auto-update 在发布新版本后仍可正常检测/下载/安装。本版本仅用于升级流程验证，不包含功能变更。

## [1.0.5] - 2026-05-30

根本性修复 macOS 自动升级 “代码不含资源”错误。

### 原因

electron-updater 在 macOS 上由 Squirrel.Mac 实施升级，它会调用系统 API
`SecRequirementForLaunchedApp()` 取出当前运行 app 的 designated requirement，
再用该 requirement 验证 zip 里的新 .app。对于**未使用 Apple Developer ID 证书**
签名的 app，requirement 会退化为「新版本 CDHash 必须 == 旧版本 CDHash」——
这在跨版本升级时不可能成立。这是 Apple/Squirrel 的硬性限制，不是可调项。
v1.0.0..v1.0.4 里所有的 「`identity` / `hardenedRuntime` / `zip target`」 调整都不能绕过这一点。

### 修复

- **macOS 改为“提示 + 手动下载”模式**：检查到新版本后，
  点击「下载」会在默认浏览器打开 GitHub Releases 页面，
  用户下载 dmg 后拖拽到 “应用程序” 文件夹覆盖即可。
- **Windows 不受影响**：NSIS 仍然是完整的一键 auto-update。

### 重要提示

已安装 v1.0.0..v1.0.4 的 macOS 用户点击「检查更新」还会看到上述错误（他们跑的是旧代码）。
请手动访问 下载页面 一次性升级到 v1.0.5；
之后从 v1.0.5 开始再点「检查更新」会直接跳转浏览器，不会再报错。

## [1.0.4] - 2026-05-30

紧急修复 auto-update：v1.0.3 客户端拉到 zip 后 Squirrel.Mac
安装报错：

```
Code signature at URL ... did not pass validation:
代码不含资源，但签名指示这些资源必须存在
```

### 修复

- **明确未签名分发配置**：`electron-builder.yml` 的 `mac` 下
  增加 `identity: null` 并将 `hardenedRuntime` 从 `true` 改为 `false`。
  根因：之前设了 `hardenedRuntime: true` 但未提供签名证书，electron-builder
  仍在 .app 里写入了 `_CodeSignature/CodeResources` 清单，但 zip 化过程中
  清单与实际资源不一致，Squirrel.Mac 严格校验时报 “代码不含资源”。
  明确告诉 electron-builder “本构建不走签名”后，.app 不再写入这份
  不一致的签名清单，Squirrel.Mac 才能顺利应用更新。

## [1.0.3] - 2026-05-30

再次紧急修复 auto-update：v1.0.2 客户端报 `ZIP file not provided`。

### 修复

- **macOS 增加 zip 产物**：electron-updater 在 macOS 上由 Squirrel.Mac 实施
  原子升级，**必须**通过 zip 应用补丁，dmg 只用于首次手动安装。`electron-builder.yml`
  的 mac target 此前只有 `dmg`，导致 `latest-mac.yml` 缺 zip 条目；现补上
  `zip (x64+arm64)`，auto-update 链路完整。

## [1.0.2] - 2026-05-30

紧急修复 auto-update 的关键 404：v1.0.1 的 `latest-mac.yml` / `latest.yml`
引用了 `Codex-Switch-1.0.1-*` 文件名，但 electron-builder 实际生成并上传的
是 `Codex.Switch-1.0.1-*`（productName 含空格时 yml 与文件名转义不一致），
导致已安装客户端调用 auto-update 拉取 dmg/exe 时 404。

### 修复

- **统一安装器命名为 `Codex-Switch-*`**：在 `electron-builder.yml` 把
  `artifactName` 中的 `${productName}` 替换成字面量 `Codex-Switch`，使
  yml 内引用与实际产物名 100% 一致。

## [1.0.1] - 2026-05-30

端到端验证自动升级链路的小版本。无功能变化，仅用于让已安装 v1.0.0 的客户端
拉取并应用一次完整的自动更新流程。

### 修复

- **CI 格式检查**：`pnpm format -- --check` 在 CI 上被解析成
  `prettier --write . --check`，导致 prettier 把 `--check` 当成文件 glob 报
  `No files matching the pattern were found`。新增独立 `format:check` 脚本，
  CI 改用 `pnpm format:check`，并补 `.prettierignore` 排除 lockfile / 自动生成
  文档 / 记忆文件。

### 内部

- 重新格式化 43 个被 prettier 标记的源文件，使 CI 全绿。

## [1.0.0] - 2025-11-18

首个公开稳定版。本次升级聚焦"小白用户能用、有问题看得懂、有问题能反馈"。

### 新增

- **自动检查新版本**：启动时静默检查 GitHub Release，发现新版可一键下载安装；支持 ghproxy 镜像加速国内下载，sha512 校验保留。
- **应用内帮助中心**：每个页面右上角 `?` 按钮，包含「常见问题」「使用入门」「报告问题」「交流群」四块；FAQ 面向"配置不生效 / 401 / 限流 / 备份还原 / 离线使用"等高频场景。
- **更新日志弹窗**：升级到新版后首次启动自动弹出本次更新内容；「设置」中可随时查看历史版本。
- **错误就地修复**：DeepSeek 返回的错误自动翻译为中文友好原因（API Key 失效 / 额度不足 / 限流 / 模型名不被接受 …），并附"打开设置"等一键跳转。
- **请求生命周期日志**：每次请求都有唯一 `req_xxxxx` 编号，开始 / 成功 / 失败三阶段日志带耗时、状态码、模型，「日志」页可按编号折叠分组。
- **主面板 5 分钟统计**：实时显示成功率、平均耗时、最近一次错误，一眼看出健康度。
- **备份治理 GUI**：「设置 → 备份管理」可列出所有 `.codex` 备份，一键还原 / 删除单个 / 清理全部。
- **首次启动小贴士**：完成向导后弹出 5 步 Codex 入门图文，告诉新用户如何打开 Codex CLI 并验证连通性。

### 改进

- **模型映射更稳健**：未识别的模型（如 `gpt-5.4-mini`）不再透传到 DeepSeek 触发 400，先按前缀规则智能回退（如 `gpt-*` → `deepseek-v4-flash`），日志同步给出 WARN 提示。
- **默认映射表内置 v4**：包含 `deepseek-v4-flash`、`deepseek-v4-pro`，并通过 `modelMappingVersion` 实现旧用户自动迁移（用户自定义键不丢失）。
- **备份不再无限增长**：对 `config.toml` 与 `auth.json` 默认各保留最新 5 份；写入内容与上次完全一致时跳过备份和写入。
- **`auth.json` 权限始终 0o600**：写入和还原都强制设权，避免 macOS / Linux 上被其他用户读取。
- **日志全链路脱敏**：`Authorization: Bearer …`、`sk-…`、`OPENAI_API_KEY` 在写入磁盘和发往渲染层之前一律替换为 `***`。
- **极简风格扫荡**：四种主色 / 三种字号 / 8px 栅格，主操作只一个，配合 Claude Desktop 的克制感。

### 修复

- 修复 `restoreCodexConfig` 还原备份时未给 `auth.json` 重新设权 `0o600`。
- 修复同名备份时间戳冲突可能丢失旧备份的边角问题。

### 新增依赖

- `electron-updater`：自动更新核心。

## [0.1.0] - 2025-10-31

- 项目骨架，HTTP + WebSocket 代理可用，Codex 配置可写入与备份。
