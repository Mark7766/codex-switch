<!-- ai-coding-ok: v2.2.0 -->
# 🔄 Codex Switch — Agent 工作流指南

> 定义 AI Agent 在不同场景下的标准工作流程。

---

## 场景 1：实现新功能（Feature）

```
Step 1: 理解需求
  ├── 阅读 Issue 描述和验收标准
  ├── 阅读 project-memory.md 获取上下文
  ├── 确认功能是否符合"零门槛、图形化"原则
  └── 如有不明确之处，列出假设并确认

Step 2: 设计方案
  ├── 区分主进程 / 渲染进程 / preload 各自职责
  ├── 设计 IPC 通道与类型（写入 electron/ipc/channels.ts）
  ├── 设计配置/数据结构（如需新字段，考虑迁移）
  ├── 选择最简实现方案（能 Node 内建就别引入第三方）
  └── 评估对 macOS 和 Windows 两端的影响

Step 3: 实现
  ├── 主进程逻辑（electron/）
  ├── preload 桥接（如需新接口）
  ├── 渲染层 UI（src/pages 或 components）
  ├── UI 文案使用人话，提供加载/成功/失败状态
  └── 涉及 ~/.codex 改动 → 先备份再写入

Step 4: 测试
  ├── 单元测试（Vitest）：协议转换、配置注入、工具函数
  ├── E2E 测试（Playwright）：UI 流程
  └── 跨平台手测：至少 macOS + Windows 各一次

Step 5: 收尾 ⚠️ 不可跳过
  ├── 更新 task-history.md ← 必须
  ├── 如有架构决策 → 更新 decisions-log.md
  ├── 如有项目事实变化 → 更新 project-memory.md
  └── 提交代码（Conventional Commits 格式）
```

---

## 场景 2：修复 Bug（Fix）

```
Step 1: 复现
  ├── 理解 Bug 描述和复现步骤
  ├── 确认平台（macOS / Windows / 版本号）
  └── 编写一个失败的测试用例来复现 Bug

Step 2: 定位
  ├── 分析 electron-log 日志（app.getPath('logs')）
  ├── 区分发生在主进程还是渲染进程
  ├── 追踪代码调用链
  └── 确定根因（root cause）

Step 3: 修复
  ├── 修复代码（最小改动）
  ├── 确保之前失败的测试通过
  └── 检查是否有类似问题需一并修复

Step 4: 验证
  ├── 运行全部测试（pnpm test && pnpm test:e2e）
  ├── 在受影响平台手动复跑一次
  └── 确认无副作用（特别是 IPC 协议向后兼容）

Step 5: 收尾 ⚠️ 不可跳过
  ├── 更新 task-history.md ← 必须
  └── 如果是常见坑 → 更新 project-memory.md "已知问题"表
```

---

## 场景 3：代码重构（Refactor）

```
Step 1: 明确目标
  ├── 为什么要重构？（可读性 / 减少依赖 / 简化打包）
  ├── 重构范围有多大？
  └── 确保有充足的测试覆盖（重构前补齐）

Step 2: 小步重构
  ├── 每次只改一件事
  ├── 每步改完跑测试
  └── 保持行为等价（功能/IPC 协议/配置兼容）

Step 3: 验证
  ├── 全部测试通过
  ├── 打包验证（pnpm package:mac / package:win）
  └── 代码可读性确实提升

Step 4: 收尾 ⚠️ 不可跳过
  ├── 更新 task-history.md ← 必须
  ├── 如重构改变模块结构 → 更新 project-memory.md
  └── 如有技术决策 → 更新 decisions-log.md
```

---

## 场景 4：产品需求分析（Product / UX）

```
Step 1: 切换到产品 + UX 模式
  ├── 想象目标用户：完全不懂命令行的朋友
  ├── 走查现有 Setup / Dashboard / Settings 流程
  ├── 考虑边界（无网、端口被占、Codex 没装、API Key 错误）
  └── 牢记"零门槛"设计原则

Step 2: 输出
  ├── 用户故事（User Story）
  ├── 验收标准（含"小白能在 N 分钟内完成"）
  ├── 文案草案（一律说人话）
  └── 优先级建议（P0/P1/P2）

Step 3: 确认
  └── 与用户确认理解是否正确
```

---

## 场景 5：跨平台打包与发布

```
Step 1: 本地构建验证
  ├── pnpm build （主进程 + 渲染层）
  ├── pnpm package:mac && pnpm package:win
  ├── 在 dist/ 下找产物，确认大小合理
  └── 在干净 VM 或另一台机器上双击安装、走一遍 Setup 向导

Step 2: 签名 & 公证（仅发布）
  ├── macOS：Developer ID 签名 + notarize（Apple 公证）
  ├── Windows：EV/OV 证书签名（无证书时降级未签名 + Release 说明书写明）
  └── 凭据通过 GitHub Actions Secrets 注入，绝不提交到仓库

Step 3: 发布
  ├── 打 tag：vX.Y.Z（遵循 SemVer）
  ├── Release workflow 自动构建并上传 .dmg / .exe 到 GitHub Releases
  ├── Release notes：用人话写，附小白安装截图链接
  └── 校验自动更新（如启用 electron-updater）

Step 4: 收尾 ⚠️ 不可跳过
  ├── 更新 task-history.md
  ├── 如打包配置或签名流程有变 → 更新 decisions-log.md / project-memory.md
  └── 提交 release 标签和发布说明
```

---

## 场景 6：升级 Electron / Node / 依赖

```
Step 1: 评估
  ├── 查看 Electron release notes（重点：安全更新、Chromium 版本、breaking changes）
  └── 评估对现有代码的影响（contextBridge / sandbox / 自动更新 API）

Step 2: 升级
  ├── 单独 PR 只做升级，不混业务改动
  ├── 同步检查 vite / electron-builder / playwright 兼容版本
  └── 解决类型/API 变更

Step 3: 全平台回归
  ├── macOS（Intel + Apple Silicon 各试）
  ├── Windows（10/11）
  ├── 跑完整 E2E
  └── 打包 + 安装实测

Step 4: 收尾 ⚠️ 不可跳过
  ├── 更新 task-history.md（注明版本号）
  └── 更新 project-memory.md 的"技术栈版本"段
```
