<!-- ai-coding-ok: v2.2.0 -->
# 🧩 Codex Switch — Prompt 模板库

> AI Agent 在不同场景下使用的标准 Prompt 模板。
> 人类也可以复制这些模板与 Copilot Chat 高效交流。

---

## 📋 需求分析模板

```
请以产品经理 + UX 设计师的角色分析以下需求：

需求描述：{需求描述}
业务背景：Codex Switch 是给"完全不懂命令行的朋友"用的桌面工具，
        让他们能在 macOS / Windows 上图形化地把 Codex CLI / Desktop
        接到 DeepSeek。一切以"零门槛"为最高优先级。

请输出：
1. 用户故事（作为<非技术用户>，我想要...以便...）
2. 验收标准（Acceptance Criteria，用 checkbox 列表；包含"小白能否在 N 分钟内独立完成"）
3. 边界情况（无网、端口被占、API Key 错误、~/.codex 不存在、Codex Desktop 未安装……）
4. UI 文案草案（一律说人话，不出现技术术语）
5. 优先级建议（P0/P1/P2）
6. 是否符合"零门槛、极简实用"原则？如不符合，如何简化
```

---

## 🏛️ 架构设计模板

```
请以架构师的角色设计以下功能的技术方案：

功能描述：{功能描述}

约束条件：
- 必须在 Electron 主进程 / 渲染进程 / preload 之间划清边界
- 渲染进程禁止开 nodeIntegration、必须开 contextIsolation
- 代理只能监听 127.0.0.1
- DeepSeek API Key 必须走 OS keychain（keytar）
- 优先 Node 内建模块，避免引入新依赖
- 跨平台：macOS + Windows 必须同时可用

请先阅读以下上下文文件：
- .github/agent/memory/project-memory.md
- .github/agent/memory/decisions-log.md
- AGENTS.md

请输出：
1. 主进程 / 渲染进程 / preload 各自承担什么
2. 新增/修改的 IPC 通道（在 electron/ipc/channels.ts 中的类型定义）
3. 数据结构 / 持久化方案（electron-store 字段 or keychain 项）
4. UI 改动点（路由、组件层级）
5. 与现有模块的关系
6. 跨平台风险与对策
7. 打包/安装包大小影响评估
```

---

## 💻 编码实现模板

```
请实现以下功能：

功能描述：{功能描述}
相关文件：{已有的相关文件路径}

要求：
1. 遵循 .github/agent/coding-standards.md（TypeScript strict，禁止 any）
2. 主进程代码放 electron/，渲染层放 src/，IPC 通道集中在 electron/ipc/channels.ts
3. 包含完整的类型注解和 TSDoc（公共 API）
4. 附带 Vitest 单元测试；UI 流程附带 Playwright E2E
5. 涉及 ~/.codex/* 写入必须先备份
6. 不在日志/IPC/UI 文案中泄露 API Key
7. 完成后更新 .github/agent/memory/task-history.md
```

---

## 🐛 Bug 修复模板

```
请修复以下 Bug：

Bug 描述：{Bug 描述}
平台 / 版本：{macOS xx.x / Windows 11 / Codex Switch vX.Y.Z}
复现步骤：{复现步骤}
期望行为：{期望行为}
实际行为：{实际行为}
日志摘要：{electron-log main.log 关键片段}

请按以下步骤处理：
1. 先写一个失败的 Vitest（或 Playwright E2E）测试用例来复现 Bug
2. 区分是主进程问题还是渲染层问题，分析根因
3. 修复代码（最小改动，避免顺手重构）
4. 确保失败的测试通过、其他测试不回归
5. 检查是否有类似问题需一并修复
6. 更新 task-history.md；如是常见坑 → 同步更新 project-memory.md
```

---

## 🔍 Code Review 模板

```
请对以下代码/变更进行 Code Review：

文件 / PR：{文件路径或 PR 描述}

请从以下维度评审：
1. 正确性：逻辑是否正确？边界（端口冲突、断网、Codex 未安装、磁盘只读）是否处理？
2. 安全性：
   - 是否泄露 API Key / Authorization？
   - IPC 入参是否校验？
   - 代理是否仍只听 127.0.0.1？
   - contextIsolation / nodeIntegration 设置是否正确？
3. 简洁性：是否过度设计？能否更简单？是否引入了不必要的依赖？
4. 可读性：命名、结构是否清晰？文件大小是否超 400 行、函数是否超 50 行？
5. 可测试性：是否便于单测？mock 边界是否清晰？
6. 跨平台：macOS 与 Windows 是否都能工作？路径/shell/图标是否处理？
7. 用户体验：UI 文案是否"说人话"？错误提示是否给出下一步操作？
8. 规范符合度：是否符合 coding-standards.md？

请给出具体的改进建议（含具体的代码片段）。
```

---

## 📊 测试编写模板

```
请为以下功能编写测试：

被测模块：{模块路径}
被测功能：{功能描述}

要求：
1. 单元测试用 Vitest，E2E 用 Playwright for Electron
2. 测试命名：<被测对象> <场景> <期望>（describe + it）
3. 使用 AAA 模式（Arrange-Act-Assert）
4. 覆盖：正常流程 / 边界值 / 异常输入 / 错误处理
5. 涉及时间用 vi.useFakeTimers() 或 Playwright clock
6. 涉及文件系统用 os.tmpdir() + 随机后缀
7. 涉及 Electron API 在 tests/setup.ts 中 vi.mock('electron')
8. 核心模块（proxy、translate、codex 配置注入）覆盖率目标 ≥ 90%
```

---

## 📦 打包/发布检查模板

```
请帮我做一次发布前检查：

版本号：{vX.Y.Z}
变更摘要：{这版改了什么}

请完成：
1. 走读 CHANGELOG，确认覆盖了本次所有 PR
2. 运行 pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e
3. pnpm package:mac && pnpm package:win，确认产物大小、文件名规范
4. 在干净环境（VM / 另一台机器）双击安装，走一遍 Setup 向导，确认：
   - API Key 能保存进 keychain（重启应用后仍存在）
   - 代理能启动 / 停止
   - ~/.codex/config.toml 被正确写入，原文件已备份
   - Codex CLI / Desktop 能成功调用
   - "一键还原"能恢复原 ~/.codex 配置
5. 输出 GitHub Release 文案草稿（中文，给小白用户看）
```
