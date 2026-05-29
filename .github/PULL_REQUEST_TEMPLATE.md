## 变更描述

<!-- 一句话说明这个 PR 做了什么以及为什么要做 -->

### 变更类型

- [ ] ✨ 新功能 (feat)
- [ ] 🐛 Bug 修复 (fix)
- [ ] ♻️ 重构 (refactor)
- [ ] 📚 文档 (docs)
- [ ] 🎨 代码风格 (style)
- [ ] ✅ 测试 (test)
- [ ] 🔧 工具/配置 (chore)
- [ ] ⚡ 性能优化 (perf)
- [ ] 🏗️ 构建/打包 (build)
- [ ] 🤖 CI (ci)

### 影响的端

- [ ] 主进程 (electron/)
- [ ] 渲染进程 / UI (src/)
- [ ] 代理与协议转换 (electron/proxy/)
- [ ] Codex 配置注入 (electron/codex/)
- [ ] 安装器 / 打包流程 (electron-builder.yml, build/)
- [ ] CI / 发布流水线 (.github/workflows/)
- [ ] 文档 (docs/)

### 关联 Issue

<!-- Closes #123 -->

---

## 实现方案

<!-- 描述实现思路、关键设计取舍、为什么不用其他方案 -->

## 影响范围

<!-- 列出受影响的模块/文件、对用户的可见影响、对已有配置的兼容性 -->

## 测试说明

- [ ] 已添加/更新 Vitest 单元测试
- [ ] 已添加/更新 Playwright E2E 测试（如涉及 UI 流程）
- [ ] 已在本机手动验证：
  - [ ] macOS（Intel 或 Apple Silicon，请注明）
  - [ ] Windows 10/11
- [ ] 已手动测试以下场景：
  - ...

## 安装/升级影响

- [ ] 不影响已安装用户
- [ ] 涉及 `~/.codex/*` 配置改动（已确认备份/还原逻辑工作正常）
- [ ] 需要用户重新填写配置 / API Key
- [ ] 需要新的 OS 权限（如 keychain 访问、自启动等）

## 检查清单

- [ ] 代码通过 ESLint
- [ ] 代码通过 `tsc --noEmit` 类型检查
- [ ] Prettier 已格式化
- [ ] 所有测试通过（`pnpm test` 和 `pnpm test:e2e`）
- [ ] 已更新相关文档（README / docs/）
- [ ] Commit message 遵循 Conventional Commits
- [ ] 没有硬编码密钥/API Key
- [ ] 日志、IPC 消息、错误提示中没有泄露 Authorization 头或 API Key
- [ ] 渲染进程未开启 `nodeIntegration`，`contextIsolation` 仍为 true
- [ ] 代理仅监听 `127.0.0.1`

## 记忆更新

<!-- 如涉及架构或项目事实变更，请更新记忆文件 -->

- [ ] 不需要更新记忆文件
- [ ] 已更新 `.github/agent/memory/project-memory.md`
- [ ] 已更新 `.github/agent/memory/decisions-log.md`
- [ ] 已更新 `.github/agent/memory/task-history.md`
