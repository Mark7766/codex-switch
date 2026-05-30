# 更新记录

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
