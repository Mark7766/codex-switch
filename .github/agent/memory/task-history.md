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

### [TASK-053] v1.6.0 — Claude Desktop 直连 DeepSeek（实施）
- **日期**：2026-06-11
- **类型**：feat / refactor
- **摘要**：按 `docs/DESIGN-claude-desktop-direct-deepseek.md` 方案完整实施。Claude Desktop 不再走 Codex Switch 本地代理，改为直连 `https://api.deepseek.com/anthropic`。核心变更：① `desktop-writer.ts` 重写 — profile gateway URL 指向 DeepSeek + 真实 API Key + `__codexSwitch:"managed"` 标记；② `anthropic-relay.ts` 整体删除（~400 行）；③ `server.ts` 移除 3 条 `/anthropic/v1/*` 路由和 `claudeDesktop` 选项；④ `main.ts` 移除 Claude Desktop 代理 wiring（4 处 claudeDesktop 入参/回滚/sync 删除）；⑤ `store.ts` 移除 `ClaudeDesktopPrefs.modelMap`；⑥ `ClaudeSettingsSection.tsx` 简化 Desktop 配置 UI（去掉模型下拉框，改为只读表）；⑦ 新增 `runV160ClaudeDesktopMigration` 迁移存量用户 profile；⑧ `detect.ts` 检测条件从 `127.0.0.1` 改为 `deepseek.com`。代码净减少 ~380 行。typecheck ✅ / lint ✅ / 134 tests ✅。
- **变更文件**：
  - `electron/claude/desktop-writer.ts`（重写：URL→api.deepseek.com, apiKey 换真实 Key, PROFILE_NAME→DeepSeek, +3 条 inferenceModels, +__codexSwitch 标记）
  - `electron/proxy/anthropic-relay.ts`（删除）
  - `electron/proxy/server.ts`（-3 anthropic 路由, -claudeDesktop 选项, -anthropicRelayOpts 方法, -'claude-desktop' LogSource）
  - `electron/main.ts`（-4 处 claudeDesktop wiring, +runV160ClaudeDesktopMigration 调用, writeClaudeDesktopConfig(port)→(apiKey)）
  - `electron/config/store.ts`（-ClaudeDesktopPrefs.modelMap, +MigrationFlags.v160_claudeDesktopDirect, -anthropic-relay import）
  - `electron/config/migrations.ts`（+runV160ClaudeDesktopMigration, startupApplyClaude port→apiKey, runV130ClaudeMigration port→apiKey, -getApiKey import）
  - `electron/claude/detect.ts`（isClaudeDesktopConfigured: 127.0.0.1→deepseek.com）
  - `src/components/ClaudeSettingsSection.tsx`（-DESKTOP_ROLES/ROLE_LABEL/RoleEntry 常量, -roleMap state, -model mapping 下拉框, +只读 INFERENCE_MODEL_ROWS 表, 文案直连）
  - `src/types/global.d.ts`（-claudeDesktop.modelMap 类型）
  - `tests/unit/anthropic-relay.test.ts`（删除）
  - `tests/unit/desktop-writer.test.ts`（重写断言：apiKey 签名, deepseek.com URL, 3 条 models, __codexSwitch 标记, -PLACEHOLDER_KEY）
  - `package.json`（1.5.4→1.6.0）
  - `CHANGELOG.md`（v1.6.0 条目）
- **关联 ADR**：待写入 ADR-020
- **注意事项**：
  1. 存量用户升级时 `runV160ClaudeDesktopMigration` 自动将 profile 从 localhost 改写为 api.deepseek.com
  2. 卸载逻辑改为检查 `__codexSwitch: "managed"` 标记，不再依赖 PLACEHOLDER_KEY
  3. DeepSeek Anthropic 端点按 model 前缀路由（opus→v4-pro, sonnet/haiku→v4-flash）
  4. TASK-051 修复的 max_tokens 穿透问题此版本自然消除

### [TASK-052] 编写 Claude Desktop 直连 DeepSeek 整改方案
- **日期**：2026-06-11
- **类型**：docs / design
- **摘要**：用户决定 Claude Desktop 不再走本地代理，改为和 Claude Code CLI 一样直连 DeepSeek Anthropic 端点。撰写了 `docs/DESIGN-claude-desktop-direct-deepseek.md`，核心变更：desktop-writer.ts 的 3P gateway profile 从 `http://127.0.0.1:{port}/anthropic`（占位 API Key）改为 `https://api.deepseek.com/anthropic`（真实 API Key）；anthropic-relay.ts 整体删除（~400 行）；server.ts 移除 `/anthropic/v1/*` 路由；main.ts 移除 Claude Desktop 代理 wiring；store.ts 移除 ClaudeDesktopPrefs.modelMap；新增迁移更新存量用户 profile。代码净减少 ~400 行。本次任务未写代码。
- **变更文件**：
  - `docs/DESIGN-claude-desktop-direct-deepseek.md`（新建）
- **关联**：TASK-051（max_tokens 修复 — 直连后该问题自然消除）、TASK-026（初版 Claude 接入）、ADR-006（cc-switch 3P 方案 — 现简化为直连）

### [TASK-051] v1.5.5 — 修复 Claude Desktop 代理 max_tokens 穿透导致回复截断
- **日期**：2026-06-11
- **类型**：fix
- **摘要**：用户报告 Claude Desktop 通过代理对话时"一句话没说完"（回复被截断）。日志分析发现 `req_d59661` 请求 `finishReason=max_tokens ↑5↓1`——Claude Desktop 在 warmup/probe 请求中发送 `max_tokens=1`（或极小值），`anthropic-relay.ts` 原样透传给 DeepSeek 导致真实回复只返回 1 个 token。修复：在转发前 clamp `max_tokens` 到 [256, 16384] 区间。日志中还有 `req_1119e3`（↑15606↓55，tools strip 后 DeepSeek 回复偏短）但那是另一类问题（tools 去掉后上下文让模型迷惑），非本次范围。
- **变更文件**：
  - `electron/proxy/anthropic-relay.ts`（新增 MAX_TOKENS_MIN=256 / MAX_TOKENS_MAX=16384 常量；tools strip 后 clamp body.max_tokens）
- **关联**：TASK-026（Anthropic relay 初版实现）
- **注意事项**：
  1. clamp 只对 `typeof === 'number'` 生效，未传 `max_tokens` 时不干预
  2. 对真实对话场景（max_tokens 通常 4096–8192），clamp 值在区间内，零影响
  3. 修复后 Claude Desktop 需重启才能看到效果

### [TASK-050] v1.5.4 — 修复 WS `compaction_trigger` 导致 Codex Desktop compaction 报错
- **日期**：2026-06-11
- **类型**：fix
- **摘要**：Codex Desktop 在 `response.create` WS 消息的 input items 中发送 `compaction_trigger` 项目（413 items 中有 1 个），期望代理返回 `type: "compaction"` 输出项目。Codex Switch 之前：(1) `itemsToMessages()` 静默丢弃该类型、(2) 响应输出无 compaction item、(3) Codex Desktop 内部 "remote compaction v2" 扫描输出期望 1 个 compaction 结果报错 "expected exactly one compaction output item, got 0 from 2 output items"。修复：① `compact.ts` 新增 4 个辅助函数（extractCompactionTriggers / extractCompactionInputItems / buildCompactionOutputItem / decodeCompactionPayload）② `stream.ts` 新增 `extraOutputItems` 可选参数支持注入任意输出项目 ③ `server.ts` WS handler 检测 trigger → 调 compactAndStore → 生成 compaction output item → 传 streamDeepSeek → 注入 response.completed.output ④ `translate.ts` itemsToMessages 显式跳过 compaction/compaction_trigger 类型 ⑤ 支持入站 compaction item 解码恢复历史。新增 18 个测试（compact 15 + stream 3），全量 141/141 通过，typecheck + lint 零报错。
- **变更文件**：
  - `electron/proxy/compact.ts`（新增 4 函数 + crypto import，+~70 行）
  - `electron/proxy/stream.ts`（新增 extraOutputItems 参数 + 发射/追加逻辑，+~20 行）
  - `electron/proxy/server.ts`（WS handler: 提取 trigger→compactAndStore→传 stream；入站 compaction item 解码；ws.on('message') 改为 async；+~30 行）
  - `electron/proxy/translate.ts`（显式跳过 compaction/compaction_trigger 类型，+3 行）
  - `tests/unit/compact.test.ts`（新增 15 个测试：extractCompactionTriggers 5 + buildCompactionOutputItem 2 + extractCompactionInputItems 8）
  - `tests/unit/stream.compaction.test.ts`（新建，3 个测试）
- **关联 ADR**：扩展 ADR-019（v1.5.0 LLM 摘要压缩）
- **注意事项**：
  1. `server.ts` 仍超 400 行约束（~1550 行，历史遗留，TASK-018 / TASK-045 已有记录）
  2. 入站 compaction item 解码使用 base64 JSON，payload 结构 `{ compactedId, messages, timestamp }`
  3. compaction 失败是非致命的——降级为正常请求、不注入 compaction output item
  4. 非流式 HTTP 路径未注入 compaction output item（仅过滤 trigger items）

### [TASK-049] v1.5.2/v1.5.3 — 修复 config.toml 模板对齐 cc-switch 方案，解决 compact 502
- **日期**：2026-06-11
- **类型**：fix
- **摘要**：排查发现 Codex Desktop compact 502 根因是 `~/.codex/config.toml` 格式问题。旧格式 `openai_base_url` 缺少三个关键字段：`wire_api = "responses"`、`requires_openai_auth = true`、`disable_response_storage = true`。v1.5.2 尝试改用 Provider 块格式但 `model_provider = "codex-switch"` 不生效。阅读 cc-switch 源码（`src-tauri/src/provider.rs`）发现必须用固定 ID `model_provider = "custom"`（Codex 识别的标准非保留 provider ID），同步增加 `model_reasoning_effort = "xhigh"`。v1.5.3 将 `writer.ts` 模板完全对齐 cc-switch 方案。用户 config.toml 已手动更新为新格式测试。
- **变更文件**：
  - `electron/codex/writer.ts`（TEMPLATE 改为 Provider 块格式，provider ID 改为 "custom"）
  - `electron/proxy/server.ts`（v1.5.1: WS 调试日志）
  - `package.json`（1.5.0 → 1.5.3）

### [TASK-048] v1.5.1 — 增加 WS 调试日志排查 compact 502 问题
- **日期**：2026-06-11
- **类型**：fix / debug
- **摘要**：用户设置 `model_auto_compact_token_limit=500` 测试 compact 端点，Codex Desktop 持续报 502 但代理日志无任何 compact HTTP 请求。经排查发现 Codex Desktop 全程通过 WebSocket 通信（HTTP 日志仅 3 条 curl 测试），推测 compact 请求以 WS 消息形式发送但 type 不被识别而被静默丢弃。在 server.ts WS 消息循环的 `if (msg.type !== 'response.create') return;` 之前增加 warn 级日志 `⚠ 未识别的 WS 消息 type="xxx" (已丢弃)`，输出到 ndjson 日志供诊断。bump 1.5.0 → 1.5.1，123 测试全过，已构建 DMG 等待用户安装测试。
- **变更文件**：
  - `electron/proxy/server.ts`（WS 消息循环增加调试日志）
  - `package.json`（1.5.0 → 1.5.1）

### [TASK-047] 编写 codex-switch 客户端接入 codex-switch-server 方案（v1.6.0）
- **日期**：2026-06-11
- **类型**：docs / design
- **摘要**：在 Server 适配文档之外，补充客户端侧的完整接入方案。撰写了 `docs/DESIGN-server-integration-v1.6.0.md`，覆盖 3 大维度：① 更新检查：MirrorMode 新增 `'server'`，electron-updater feed URL 指向 Server，pickAuto 优先级调整为 server→github→ghproxy；② 遥测客户端：新建 `electron/server-client/` 模块（config + client + telemetry），TelemetryClient 实现 buffer→定时批量 POST，12 种事件类型（app_start/close、proxy_start/stop/error、model_call、config_write、tool_install/fail、update_check/download、error），明确排除消息内容/API Key/文件路径/IP；③ Settings UI：更新镜像新增"官方服务器（推荐）"、新增「数据与隐私」区块（遥测开关 + 服务器地址 + 隐私说明）、Setup 向导增加遥测 opt-out。本次任务未写代码。
- **变更文件**：
  - `docs/DESIGN-server-integration-v1.6.0.md`（新建）
- **关联**：`docs/SERVER-REQUIREMENTS-for-electron-updater.md`（TASK-046）
- **注意事项**：依赖 Server 端先完成 `/api/v1/updates/*` 端点适配；遥测默认开启可在 Setup 向导取消；macOS 签名限制（ADR-013）不变

### [TASK-046] 编写 Server 适配 electron-updater 需求文档
- **日期**：2026-06-11
- **类型**：docs / design
- **摘要**：用户选择方案 C（Server 适配层），让 codex-switch-server 提供兼容 electron-updater generic provider 的静态文件接口，客户端改动最小（仅新增 `server` mirror 模式）。撰写了 `docs/SERVER-REQUIREMENTS-for-electron-updater.md`，覆盖：electron-updater generic provider 协议详解（latest-mac.yml/latest.yml 格式、文件列表、差分更新机制）、Server 端需要的 3 个新端点（`GET /api/v1/updates/latest-mac.yml` / `latest.yml` / `{filename}`）、数据同步策略（GitHub Release → COS + 缓存）、yml 生成方式（推荐直接提供 GitHub 原文件）、与现有 update 端点的共存关系、客户端侧配置变更（feedUrl 指向 server）、macOS Squirrel.Mac 签名限制说明。本次任务未写代码，仅输出需求文档供 Server 端开发者执行。
- **变更文件**：
  - `docs/SERVER-REQUIREMENTS-for-electron-updater.md`（新建）
- **注意事项**：
  1. Server 端只需新增 1 个路由组（3 个 GET 端点）+ 定时同步任务，不需要改动现有 API
  2. 客户端接入方案在文档 §4 中已说明（新增 `server` mirror 模式），留待 Server 适配完成后实现
  3. macOS 非签名限制（ADR-013）仍然存在，server 更新对 macOS 仅限于"通知+手动下载"

### [TASK-045] 实施 v1.5.0 compact 上下文压缩完整重构（代码实现）
- **日期**：2026-06-11
- **类型**：feat
- **摘要**：按 TASK-044 设计文档 `docs/DESIGN-compact-context-compression-v1.5.0.md` 完成代码实现。① 新建 `electron/proxy/conversation-store.ts`（239 行）：ndjson 持久化 Map 包装器，支持原子写入（tmp→rename）、debounce 5s 刷盘、启动 restore、24h/50 条自动清理；② 新建 `electron/proxy/compact.ts`（217 行）：LLM 摘要核心逻辑，复用 `callDeepSeekSync`，>20 条消息触发摘要（保留最近 10 条不动），失败回退截断 30 条，Promise.race 超时控制；③ 重写 `server.ts` compact 路径：HTTP handler 全加固（30s 超时 / 1MB 大小限制 / req.on('error') / 400/408/413/500 分级错误响应），WS 新增 `response.compact` 事件异步处理（不阻塞消息循环），compactAndStore 幂等缓存 + 强制刷盘，replaceAll 旧 CONV_STORE_MAX/keys() 引用为 ConversationStore.markDirty()；④ 新建 19 个测试用例（compact 11 + conversation-store 8），全量测试 123/123 通过；⑤ bump 版本 1.4.0 → 1.5.0，更新 CHANGELOG。typecheck + lint 零报错。
- **变更文件**：
  - `electron/proxy/conversation-store.ts`（新建，239 行）
  - `electron/proxy/compact.ts`（新建，217 行）
  - `tests/unit/conversation-store.test.ts`（新建，8 用例）
  - `tests/unit/compact.test.ts`（新建，11 用例）
  - `electron/proxy/server.ts`（重写 compact HTTP handler + 新增 WS compact + 集成 ConversationStore + replaceAll 旧 Map 引用；+~170 行）
  - `package.json`（1.4.0 → 1.5.0）
  - `CHANGELOG.md`（新增 v1.5.0 条目）
- **关联 ADR**：待写入 ADR-019
- **注意事项**：
  1. `electron/proxy/server.ts` 现 1520 行，超出 400 行约束（此前已 ~1350 行，增量 ~170 行主要来自新增 compact 方法；历史遗留问题，TASK-018 已有记录）
  2. LLM 摘要将完整对话历史发送到 DeepSeek API。用户在设计阶段已明确选择 LLM 摘要方案（而非简单截断），此为功能设计意图
  3. `conversation-store.ndjson` 文件路径由 `main.ts` 通过 `ProxyOptions.storePath` 传入（`<userData>/logs/conversation-store.ndjson`）
  4. 摘要失败时自动回退截断，保证 core flow 不中断

### [TASK-044] 编写 v1.5.0 compact 上下文压缩完整重构方案
- **日期**：2026-06-11
- **类型**：docs / design
- **摘要**：用户报告 Codex Desktop 在长对话后报 502 错误（`/v1/responses/compact`），根因为当前 compact 端点：① 无 `req.on('error')` 处理导致流错误时连接裸断；② 无请求体大小限制和超时机制；③ LLM 摘要压缩完全缺失（仅做 ID 克隆）；④ WebSocket compact 事件未处理；⑤ conversationStore 纯内存、重启即丢失。撰写了 `docs/DESIGN-compact-context-compression-v1.5.0.md` 综合方案，覆盖三大维度：**健壮性**（HTTP handler 加 error/timeout/size-limit 全加固 + WS compact 事件分支）、**LLM 摘要压缩**（>20 条消息时调 DeepSeek 摘要 + 失败回退截断 + 幂等控制）、**持久化**（ndjson 文件存储 + debounce 刷盘 + 启动恢复 + 24h/50条/500消息三层清理）。方案包含完整数据流、14 个边界情况矩阵、17 个测试用例清单、风险缓解表。本次任务未写代码，仅输出设计文档。
- **变更文件**：
  - `docs/DESIGN-compact-context-compression-v1.5.0.md`（新建）
- **关联方案**：待实现后写 ADR-019
- **注意事项**：
  1. 方案中所有参数阈值（COMPACT_THRESHOLD=20, RECENT_KEEP=10, FALLBACK_KEEP=30 等）为初始建议值，实施时可调整
  2. 新增模块 `electron/proxy/compact.ts` 和 `electron/proxy/conversation-store.ts`，需注意单文件 ≤400 行约束
  3. WS compact 处理必须在消息回调中异步执行（不 await），防止阻塞 WebSocket 事件循环
  4. 持久化文件与现有 persistentLog.ts 的 10MB 滚动逻辑独立，为不同的 ndjson 文件
  5. 版本从 1.4.0 升到 1.5.0

### [TASK-043] 执行 Copilot → Claude Code 迁移改造（按方案逐项落地）
- **日期**：2026-06-08
- **类型**：chore
- **摘要**：按 `docs/MIGRATION-copilot-to-claude-code.md` 方案，实际执行 3 项核心改造：① 强化 CLAUDE.md（改为全大写 STOP + 直接 Skill 调用指令）；② 扩展 AGENTS.md Plan 阶段从 3 文件到 7 文件（新增 AGENTS.md / system-prompt.md / workflows.md / coding-standards.md），Act 阶段新增第 4 条 agent 文档同步更新规则；③ 创建 `.claude/settings.local.json` 完整 hook 配置（SessionStart/UserPromptSubmit 提醒 + PreToolUse Edit|Write 提醒 + git push/gh release/SSH 阻断器 + Stop asyncRewake 强制 PDCA Act 阻断）。system-prompt.md 和 workflows.md 审查后确认已达标，无需改动。
- **变更文件**：
  - `CLAUDE.md`（全大写 STOP 指令）
  - `AGENTS.md`（Plan 7 文件 + Act 4 条）
  - `.claude/settings.local.json`（17 权限 + 6 hook 规则）
- **注意事项**：
  1. hooks 需要重启 Claude Code 会话或打开 `/hooks` 菜单后才能生效
  2. codex-switch-server 的 ADR-008（Stop hook asyncRewake）是本配置的核心理论依据
  3. Stop hook 仅在 `git diff` 检测到 `src/`/`electron/`/`tests/` 有改动时阻断
  4. settings.local.json 在 .gitignore 中，不会被提交到仓库

### [TASK-042] 编写 Copilot 迁移到 Claude Code 开发方案文档
- **日期**：2026-06-08
- **类型**：docs
- **摘要**：撰写 `docs/MIGRATION-copilot-to-claude-code.md`，完整覆盖从 GitHub Copilot 迁移到 Claude Code 开发的 6 步方案：强化 CLAUDE.md（从温和 @AGENTS.md 到全大写 STOP）、扩展 AGENTS.md Plan 阶段（从 3 文件到 7 文件）、配置 4 层 Hook 强制 PDCA 闭环（SessionStart/UserPromptSubmit/PreToolUse/Stop + asyncRewake）、扩充 system-prompt.md（人格+业务上下文+角色切换+行为边界）、扩充 workflows.md（5 场景预设）、兼容双工具。方案以 codex-switch-server 的实际生产配置为参考范本，包含验证清单和 FAQ。
- **变更文件**：
  - `docs/MIGRATION-copilot-to-claude-code.md`（新建）
- **注意事项**：
  1. 本任务未改动任何代码，仅输出文档
  2. 方案中的 6 个步骤均未实际执行（仅写了"怎么做"），codex-switch 需要逐项落地
  3. 最关键的落地项：`.claude/settings.local.json`（hook 强制阻断）和 `CLAUDE.md`（硬性指令）
  4. codex-switch-server 的 ADR-008（Stop hook asyncRewake 强制 PDCA Act）是本方案的核心理论依据

### [TASK-041] 修复 /v1/responses/compact 上下文丢失问题
- **日期**：2026-06-04
- **类型**：fix
- **摘要**：原 no-op stub 返回新 compactId 但不在 conversationStore 存历史，导致 Codex Desktop compact 后下一轮对话上下文全丢。改为读取请求体中的 `previous_response_id`，把对应历史克隆到新 compactId 下，实现"零损耗克隆压缩"（DeepSeek 有 64K–128K context 无需真正截断）。
- **变更文件**：`electron/proxy/server.ts`（compact 路由由 no-op 改为读体→克隆历史）
- **测试**：104/104 通过，typecheck 无误

### [TASK-040] 修复 Windows 打包权限与依赖缺失问题
- **日期**：2026-06-03
- **类型**：fix
- **摘要**：解决了 `pnpm package:win` 过程中的两个阻碍：① PowerShell 脚本执行策略限制（已用 `Set-ExecutionPolicy` 修复）；② `electron/updater/index.ts` 因缺失 `electron-updater` 导致的编译错误（已通过 `pnpm install` 修复）。最终成功产出 v1.3.1 Windows 安装包。
- **变更文件**：
  - N/A（主要是环境与依赖修复）

### [TASK-039] 修复 HTTP 代理下工具调用顺序导致的 DeepSeek 400 错误
- **日期**：2026-06-03
- **类型**：fix
- **摘要**：修复了 `handleResponses` (HTTP) 未调用 `fixToolMessageOrder` 的问题，该缺失会导致 Codex CLI/Desktop 在特定场景下发送的工具调用序列被 DeepSeek 拒绝并报 400 错误。同时同步了 WebSocket 的鲁棒逻辑：支持 `previous_response_id` 状态管理、自动保存对话历史、补全空 user 消息等。
- **变更文件**：
  - `electron/proxy/server.ts` (重构 `handleResponses` 逻辑)
- **测试**：已通过静态检查，逻辑对齐已验证的 WS 实现。

### [TASK-038] 发布 v1.3.0
- **日期**：2026-06-03
- **类型**：chore（release）
- **摘要**：将 TASK-034 ~ TASK-037 所有变更打包为 v1.3.0，推送远程并创建 GitHub Release。
- **操作步骤**：
  1. `npm version 1.3.0 --no-git-tag-version` 更新 package.json
  2. `git add` 所有新增/修改文件（30 个），`git commit`
  3. `git tag v1.3.0`
  4. `pnpm package:mac` 构建 4 个产物：arm64/x64 DMG + zip
  5. `git push origin main --tags`
  6. `gh release create v1.3.0` 附带 4 个安装包
- **Release URL**：https://github.com/Mark7766/codex-switch/releases/tag/v1.3.0
- **测试**：99/99 通过（发布前验证）

### [TASK-037] Claude Desktop 续写拦截 + token 显示
- **日期**：2026-06-03
- **类型**：fix + feat
- **问题**：用户提 3 个问题仍产生大量请求；日志里 token 输入输出全空。
- **根因**：
  1. 续写请求：Claude Desktop 收到 DeepSeek 回复后，会再发 `lastRole=assistant` 的"续写请求"（认为上次回复被截断）。每次主对话都触发一次额外的续写调用。
  2. token 缺失：之前用 `upstreamRes.pipe(res)` 直接管道转发，没解析 SSE 流，无法提取 `message_start.message.usage` 和 `message_delta.usage`。
- **修复**：
  1. 在 stub 检测里新增 `isContinuation = msgs.length > 0 && lastRole === 'assistant'`，命中即返回空 `end_turn` stub，不调用 DeepSeek。
  2. 把 `pipe()` 改成手工 chunk 转发：监听 `data` 事件同时把字节 `res.write(chunk)` + 累积 SSE 缓冲，按行解析 `data:` 行，提取 `input_tokens` / `output_tokens` / `stop_reason`，最后写入 success 日志的 `inputTokens`/`outputTokens`/`finishReason` 字段。Logs UI 因此能显示 `↑XXX ↓YYY tokens`。
- **变更文件**：
  - `electron/proxy/anthropic-relay.ts`（`AnthropicLogEntry` 加 inputTokens/outputTokens/finishReason；新增续写 stub；改写响应转发为 chunk + SSE 解析）
- **测试**：99/99 通过

### [TASK-036] 修复 Claude Desktop 工具调用死循环
- **日期**：2026-06-03
- **类型**：fix
- **根因**：TASK-035 修复了子代理并行问题（已被 stub 拦截），但仍有大量真实请求循环。日志显示 `msgs=53→55→57→...→69` 持续递增，每次 +2，全带 `tools=[Agent,Bash,Edit,mcp__*]`。这是 **tool-use 循环**：Claude Desktop 把 44 个 Claude 专属工具定义传给 DeepSeek，DeepSeek 不认识这些工具但兼容协议会回 `tool_use` stop_reason；Claude Desktop "执行"工具→把 tool_result 作为 user 消息回传→DeepSeek 又回 tool_use……每次用户提一个问题就触发 30+ 轮自动续轮。
- **修复**：在 `handleAnthropicMessages` 转发到 DeepSeek 之前，删除请求 body 中的 `tools` 和 `tool_choice` 字段。DeepSeek 不会再回 tool_use，stop_reason 变成 end_turn，对话正常结束。Claude Desktop 的内置工具本来就执行不了，转发它们没意义。
- **变更文件**：`electron/proxy/anthropic-relay.ts`（在 onLog start 之后、构造 bodyStr 之前 delete body['tools'] / body['tool_choice']）
- **测试**：99/99 通过

### [TASK-035] 修复 Claude Desktop 子代理并行请求过多
- **日期**：2026-06-03
- **类型**：fix
- **根因**：Claude Desktop 有多代理路由机制——用户每发一条消息，Claude Desktop 会把该消息同时分发给多个专属子代理（Chrome 代理、Claude Code 代理、技能分发器、调度代理等），每个子代理携带各自的 tools 列表，msgs=1。这些子代理对 DeepSeek 毫无意义（DeepSeek 无法执行 Claude 的专用工具），但每个都会消耗一次 DeepSeek API 调用。
- **修复**：在 `handleAnthropicMessages` 中检测子代理分发请求（`msgs.length === 1 AND tools.length > 0 AND lastRole === 'user'`），直接返回空 `end_turn` stub，不转发到 DeepSeek。日志 phase 设为 `'stub'`，Logs UI 显示"子代理拦截 · 未消耗 DeepSeek token"。
- **变更文件**：
  - `electron/proxy/anthropic-relay.ts`（新增 sub-agent dispatch 检测 + stub 响应）
  - `electron/proxy/server.ts`（`LogPhase` 加 `'stub'`）
  - `src/pages/Logs.tsx`（`phase === 'stub'` 时设 outcome = 'blocked'，UI 显示子代理拦截文案）
- **测试**：99/99 通过

### [TASK-034] 修复 Claude Desktop 模型过多 + 请求过多
- **日期**：2026-06-03
- **类型**：fix
- **摘要**：
  1. **模型过多**：profile JSON 缺少 `inferenceModels` 字段，Claude Desktop 展示了全部 8 个 Claude 模型而不是 2 个。修复：在 `buildGatewayProfile()` 中加入 `inferenceModels: [{labelOverride:"deepseek-v4-flash", name:"claude-haiku-4-5"}, {labelOverride:"deepseek-v4-pro", name:"claude-sonnet-4-6"}]`（与 cc-switch 一致），移除不必要的 `coworkEgressAllowedHosts`。
  2. **请求过多**：`handleAnthropicModels` 返回全部 8 个模型，Claude Desktop 为每个模型做能力探测/预热请求。修复：新增 `INFERENCE_MODELS` 常量（2 个条目），`handleAnthropicModels` 改为仅返回这 2 个模型。同时新增 `handleAnthropicCountTokens` 处理 `POST /anthropic/v1/count_tokens`，避免 Claude Desktop 因 404 而重试。
  3. **其它**：`CLAUDE_MODELS` 补充 `claude-sonnet-4-6`；server.ts 新增 `/anthropic/v1/count_tokens` 路由；99/99 tests 绿。
- **变更文件**：
  - `electron/proxy/anthropic-relay.ts`（新增 `claude-sonnet-4-6`、`INFERENCE_MODELS`、`handleAnthropicCountTokens`；`handleAnthropicModels` 改用 `INFERENCE_MODELS`）
  - `electron/claude/desktop-writer.ts`（`buildGatewayProfile` 加 `inferenceModels`，移除 `coworkEgressAllowedHosts`）
  - `electron/proxy/server.ts`（新增 `/anthropic/v1/count_tokens` 路由）
  - `tests/unit/anthropic-relay.test.ts`（更新断言 + 新增 `handleAnthropicCountTokens` 测试）
  - `tests/unit/desktop-writer.test.ts`（断言 profile 含 `inferenceModels` 2 条）
- **注意事项**：已有用户的 Claude Desktop profile JSON 不会自动更新；需要重新"保存并应用"或重启 Codex Switch（`startupApplyClaude` 会自动重写）。

### [TASK-033] 修复启动未自动应用 CLI 配置 + 状态提示错误 + 日志来源过滤
- **日期**：2026-06-05
- **类型**：fix
- **摘要**：
  1. **启动未自动应用配置（Bug 1）**：`runV130ClaudeMigration` 是一次性迁移，首次运行后永不再执行。导致每次重启 Codex Switch 后，Claude Code CLI 的 `~/.claude/settings.json` 不会被重新写入，用户必须手动"保存并应用"才生效。修复：在 `migrations.ts` 新增 `startupApplyClaude(port)`，每次启动都无条件重新写入已启用工具的配置（有 API Key 且 installed 时）；在 `main.ts` `app.whenReady` 中于迁移之后调用它。
  2. **状态提示永久显示"↺ 重开终端生效/重启应用生效"（Bug 2）**：`ToolCard` 在 `configApplied === true` 时始终渲染 restartHint，用户重启后提示也不消失。修复：① `detect.ts` 的 `isClaudeCliConfigApplied()` 优先检查 `~/.claude/settings.json` 的 `__codexSwitch` 标记（settings.json 即生效，无需重启终端）；② Dashboard 引入 `justApplied` 状态，仅在本次刷新中触发了 `claudeApplyAll` 时才显示 hint；③ Claude Code CLI 的 restartHint 完全移除（settings.json 立即生效）；④ Claude Desktop restartHint 改为 `justApplied ? "重启应用生效" : undefined`。
  3. **日志来源无法区分/过滤（Bug 3）**：`handleAnthropicMessages` 只发出简单 string log（无 reqId / phase），Claude Desktop 请求落入 "系统/启动日志" misc 组，源过滤功能因此无效。修复：在 `anthropic-relay.ts` 新增 `AnthropicLogEntry` 类型，并在 `handleAnthropicMessages` 内生成 reqId、记录 start / success / error 三阶段结构化日志；`server.ts` 的回调直接将 entry 传给 `this.log()`。
- **变更文件**：
  - `electron/config/migrations.ts`（新增 `startupApplyClaude`）
  - `electron/main.ts`（import + 调用 `startupApplyClaude`）
  - `electron/claude/detect.ts`（`isClaudeCliConfigApplied` 优先检 settings.json；import `claudeCliSettingsPath`）
  - `electron/proxy/anthropic-relay.ts`（新增 `AnthropicLogEntry` + randomBytes + reqId/phase 日志）
  - `electron/proxy/server.ts`（更新 anthropic 回调签名）
  - `src/pages/Dashboard.tsx`（`justApplied` state + 修正 ToolCard restartHint）
- **注意事项**：`startupApplyClaude` 在 API Key 不存在时直接 return，不影响首次启动 Setup 向导流程。

### [TASK-032] 修复 Claude Desktop 模型映射未传入代理 + claudeApplyAll 未检查 enabled
- **日期**：2026-06-03
- **类型**：fix
- **摘要**：`prefs.claudeDesktop.modelMap` 存入 preferences 但从未传入代理实例，导致模型映射始终回落到 `DEFAULT_CLAUDE_DESKTOP_MODEL_MAP`（用户在 UI 修改无效）。同时 `claudeApplyAll` 未检查 `prefs.claudeDesktop.enabled`，即使用户关闭开关也会写入配置。修复：①`ensureProxy()` 创建代理时传 `claudeDesktop`；② `applyPreferencesTransaction()` 正向+回滚两处 `updateOptions` 均加入 `claudeDesktop`；③ `IPC.prefsSet` 改为 async，同步 `claudeDesktop` 到代理；④ `claudeApplyAll` 加 `prefs.claudeCli.enabled` / `prefs.claudeDesktop.enabled` 守卫。
- **变更文件**：
  - `electron/main.ts`（4 处修改）
- **注意事项**：`claudeDesktop.apiKey` 字段在 `AnthropicRelayOptions` 中存在但 `anthropicRelayOpts()` 忽略它（使用顶层 `opts.apiKey`）；传入空串或当前 key 均可。

### [TASK-031] 修复 Claude Desktop / Claude Code CLI 配置不生效（采用 cc-switch 3P 方案）
- **日期**：2026-06-04
- **类型**：fix
- **摘要**：用户报告"Claude Desktop 配置根本没有改变"。根因：之前往 `~/Library/Application Support/Claude/claude_desktop_config.json` 写 `inferenceProvider/inferenceGatewayBaseUrl/...` 完全无效——Claude Desktop 的 3P 网关从一个**完全不同**的目录读：`Claude-3p/configLibrary/<PROFILE_ID>.json`。参考 [farion1231/cc-switch](https://github.com/farion1231/cc-switch) 的 `claude_desktop_config.rs`+`claude_plugin.rs`，重写为：① 在 1p 与 3p 两份 `claude_desktop_config.json` 中都写 `deploymentMode:"3p"`（保留用户已有字段如 `mcpServers`）；② 在 `Claude-3p/configLibrary/00000000-0000-4000-8000-0000c0dec501.json` 写 gateway profile（`inferenceProvider:"gateway"`, `inferenceGatewayBaseUrl`, `inferenceGatewayApiKey`（占位 `cs-internal-placeholder`）, `inferenceGatewayAuthScheme:"bearer"`, `disableDeploymentModeChooser:true`, `coworkEgressAllowedHosts:["*"]`）；③ `_meta.json` 注册 entry+`appliedId`。卸载时仅当 `inferenceGatewayApiKey===PLACEHOLDER_KEY` 才动手，避免误删用户手配的 profile。Claude Code CLI 同步改为写 `~/.claude/settings.json` 的 `env` 字段（每次调用即生效，**无需重启终端**）+ `~/.claude/config.json` 的 `primaryApiKey:"any"`（cc-switch 的 OAuth 旁路标记），保留 `~/.zshrc` 写入作为兜底。Windows 路径从 `APPDATA` 改为 `LOCALAPPDATA`（与 Claude Desktop 实际位置一致）。`detect.ts` 改为读取 profile JSON 判断"已配置"。98/98 tests 绿。
- **变更文件**：
  - `electron/claude/paths.ts`（新增 `claudeDesktop3pConfigPath` / `claudeDesktopConfigLibraryDir` / `claudeDesktopProfilePath` / `claudeDesktopMetaPath` / `claudeCliSettingsPath` / `claudeCliConfigJsonPath`；Windows 改用 `LOCALAPPDATA`）
  - `electron/claude/desktop-writer.ts`（重写为 3P 方案；新增 `PROFILE_ID` / `PROFILE_NAME` / `PLACEHOLDER_KEY` 常量；`listClaudeDesktopBackups` 跨 3 个目录扫描并按时间戳倒序）
  - `electron/claude/env-writer.ts`（新增 `writeSettingsJson` / `removeSettingsJson` / `writeAuthBypass` 与 `CS_MARKER_KEY`；保留 shell profile 兜底）
  - `electron/claude/detect.ts`（`isClaudeDesktopConfigured` 改读 profile JSON）
  - `tests/unit/desktop-writer.test.ts`（重写覆盖 3P 路径、placeholder 边界、备份排序）
  - `tests/unit/env-writer.test.ts`（断言改用路径定位 calls 而非 index）
  - `src/components/ClaudeSettingsSection.tsx`（toast 改为"已写入 ~/.claude/settings.json 和 ~/.zshrc，直接运行 claude 即可"）
- **注意事项**：
  - PROFILE_ID `00000000-0000-4000-8000-0000c0dec501` 故意区别于 cc-switch 的 `00000000-0000-4000-8000-000000157210`，允许两者共存。
  - 卸载分支以 `inferenceGatewayApiKey === 'cs-internal-placeholder'` 作为"是我们写的"判定，**不要**改成普通字符串比较以免误判。
  - 用户已有 `claude_desktop_config.json` 中的 `mcpServers` 等字段会被保留——任何后续修改 desktop-writer 的人请勿改成"整体覆盖"。

### [TASK-028] 完整实现主面板、设置、日志和帮助页的缺失功能
- **日期**：2026-06-02
- **类型**：feat
- **摘要**：全面补完各大页面的未完成功能：① 新建 `src/pages/Help.tsx`，含上手指南（13步分页/复制按钮）、FAQ 手风琴（按 tag 分类筛选）、诊断信息导出（JSON 下载 + 复制）三个 Tab；② `App.tsx` 侧边栏新增"帮助"入口并接通路由，同步更新 `HeaderBar`/`HelpDrawer` 的 page 类型；③ `Settings.tsx` 新增"Claude 工具接入"分区，含 Claude Code CLI/Claude Desktop 启用开关、Desktop 备份还原列表、一键卸载所有写入按钮；④ `Logs.tsx` 新增来源筛选器（全部/Codex/Claude Desktop）并在页眉加注 Claude Code CLI 不走代理的说明；⑤ `server.ts` anthropic-relay 日志 source 改为 `claude-desktop`，类型同步更新；⑥ `global.d.ts` 补充 `claudeCli`/`claudeDesktop`/`migrations` 字段到 `getPreferences` 返回类型；⑦ `store.ts` Page 类型新增 'help'。96/96 tests 通过，typecheck 干净。
- **变更文件**：
  - `src/pages/Help.tsx`（新建）
  - `src/App.tsx`（Help 路由 + 侧边栏）
  - `src/components/HeaderBar.tsx`（page 类型扩展）
  - `src/components/HelpDrawer.tsx`（page 类型 + help 入口提示）
  - `src/pages/Settings.tsx`（Claude 工具接入 Section）
  - `src/pages/Logs.tsx`（来源筛选 + CLI 说明注释）
  - `electron/proxy/server.ts`（anthropic 日志 source = 'claude-desktop'）
  - `src/types/global.d.ts`（getPreferences 返回类型）
  - `src/lib/store.ts`（Page 类型）
- **注意事项**：UAT 前不 push 远程；Settings Claude 区块接入后，开关变更立即调 `setPreferences` 但不重启代理，需用户手动重开对应工具。

### [TASK-027] 修复工具连接状态三个缺陷
- **日期**：2026-06-02
- **类型**：fix
- **摘要**：修复三个工具状态显示 bug：① `whichExists()` 在 Electron 受限 PATH 下找不到 `codex`/`claude` 二进制（如 nvm、pnpm global 路径），改为先尝试当前 PATH，失败后用 `$SHELL -lc "which ..."` 登录 shell 重试，获取用户完整 PATH；② "刷新检测"仅读取状态但不应用配置，改为自动对 `installed && !configApplied` 的 Claude 工具调用 `claudeApplyAll()`，使刷新具有实际修复效果；③ ToolCard 对 Claude Code CLI 和 Claude Desktop 显示 `↺ 重开终端生效` / `↺ 重启应用生效` 琥珀色提示，告知用户配置已写入但需重启才能生效。
- **变更文件**：
  - `electron/claude/detect.ts`（`whichExists` 增加登录 shell 回退逻辑）
  - `src/pages/Dashboard.tsx`（`refreshDetect` 增加 auto-apply；`ToolCard` 新增 `restartHint` prop）

### [TASK-026] v1.3.0 Claude 接入后端全量实现
- **日期**：2026-06-03
- **类型**：feat
- **摘要**：按设计文档 docs/DESIGN-claude-support.md 实现全部后端 + UI 变更。新建 5 个文件，修改 7 个现有文件，新建 3 个单元测试文件，所有 96 个测试通过，typecheck 零报错。
- **变更文件**：
  - `electron/claude/paths.ts`（新建：跨平台路径工具，含 claudeDesktopConfigPath、shellProfilePaths、backupPath、codexDir 等）
  - `electron/claude/detect.ts`（新建：detectAll() 并行探测 4 个工具安装与配置状态）
  - `electron/claude/env-writer.ts`（新建：写/删 Claude Code CLI shell profile 环境变量块，Windows setx 路径）
  - `electron/claude/desktop-writer.ts`（新建：写/备份/还原/删 claude_desktop_config.json，PLACEHOLDER_KEY 安全鉴别）
  - `electron/proxy/anthropic-relay.ts`（新建：处理 GET /anthropic/v1/models 和 POST /anthropic/v1/messages，虚拟 Claude 模型目录 + SSE 透传至 api.deepseek.com/anthropic）
  - `electron/config/migrations.ts`（新建：v130_claude 一次性迁移，升级后自动应用已安装工具配置）
  - `electron/config/store.ts`（修改：新增 ClaudeCliPrefs、ClaudeDesktopPrefs、MigrationFlags 接口与 DEFAULTS）
  - `electron/proxy/server.ts`（修改：新增 /anthropic/v1/* 路由，anthropicRelayOpts() helper，claudeDesktop ProxyOptions 字段）
  - `electron/ipc/channels.ts`（修改：新增 claude:detect/apply-all/uninstall-cli/uninstall-desktop/uninstall-all/desktop-backups/desktop-restore）
  - `electron/preload.ts`（修改：暴露全部 claude:* IPC 方法）
  - `electron/main.ts`（修改：import claude 模块，keySet 后自动应用配置，registerIpc 注册 claude:* handlers，whenReady 运行迁移）
  - `src/pages/Dashboard.tsx`（修改：新增 4 卡片工具状态区，ToolCard 组件，claudeDetect 轮询/刷新）
  - `src/types/global.d.ts`（修改：新增 DetectResult/ToolStatus 类型，CodexSwitchApi 扩展 claude 方法）
  - `tests/unit/anthropic-relay.test.ts`（新建）
  - `tests/unit/env-writer.test.ts`（新建）
  - `tests/unit/desktop-writer.test.ts`（新建）
- **注意事项**：代码不推送到远端，等待用户 UAT 验证后由用户授权 push。

### [TASK-025] 设计 Claude Code CLI + Claude Desktop 接入方案（v0.3）
- **日期**：2026-06-02
- **类型**：docs
- **摘要**：撰写并迭代 docs/DESIGN-claude-support.md 至 v0.3，覆盖 4 款工具（Codex Desktop、Codex CLI、Claude Code CLI、Claude Desktop），明确 Codex Desktop 主力地位与 "不动存量" 原则。核心方案：(1) Claude Code CLI 直连 DeepSeek 官方 Anthropic 端点 `https://api.deepseek.com/anthropic`，写 9 个 env vars（含 ANTHROPIC_AUTH_TOKEN=真实 DeepSeek Key、CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1、CLAUDE_CODE_EFFORT_LEVEL=high），不经本地代理；(2) Claude Desktop 用本地代理新增 /anthropic/v1/{models,messages} 路由，仅做模型名重写 + SSE 透传；(3) 零配置 UX：保存 API Key 自动触发应用，Dashboard 升级为四卡片状态盘；(4) §5.4 安装顺序无关性：4 种安装场景（工具先/Switch 先/同时/卸载）+ 多触发点 rescan（启动/聚焦/托盘/手动）+ detectAll() 探测；(5) §5.5 Settings/Logs/Help 变更：Settings 增加 Claude 子区块和"卸载所有写入"按钮，Logs 增加来源标签列与脱敏规则扩展，Help 增加 onboarding/FAQ/诊断导出；(6) 向后兼容：electron-store schema 仅追加，keytar 复用，v1.2.x 用户升级一次性迁移。
- **变更文件**：
  - `docs/DESIGN-claude-support.md`（v0.1 → v0.2 → v0.3）

### [TASK-024] 修复 Codex 对话失忆（previous_response_id 未处理）
- **日期**：2026-06-02
- **类型**：fix
- **摘要**：Codex 通过 `previous_response_id` 引用上轮响应，代理忽略该字段导致每轮请求都只含当前新消息，模型完全失忆。修复：`DeepSeekProxy` 新增 `conversationStore: Map<string, ChatMessage[]>`，每轮响应后保存完整对话；下轮收到 `previous_response_id` 时查找并恢复历史上下文，再与新消息拼接发给 DeepSeek。
- **变更文件**：
  - `electron/proxy/server.ts`（新增 `conversationStore`、`CONV_STORE_MAX`；更新 msg 类型含 `previous_response_id`；修改 message 构建逻辑；响应后存储历史）
  - `package.json`（v1.2.2 → v1.2.3）
  - `CHANGELOG.md`（新增 v1.2.3 条目）
- **发布**：v1.2.3 tag 推送；GitHub Release 已创建 https://github.com/Mark7766/codex-switch/releases/tag/v1.2.3

### [TASK-023] 修复多工具调用导致 DeepSeek 400 错误（v1.2.2）
- **日期**：2026-06-01
- **类型**：fix
- **摘要**：`itemsToMessages` 将每个 `function_call` 翻译成独立的 assistant 消息，当同一轮次有多个工具调用时 DeepSeek 报 400："An assistant message with tool_calls must be followed by tool messages"。改用 while 循环将连续 `function_call` 合并为一条 `assistant` 消息的 `tool_calls` 数组；新增两个测试用例验证分组逻辑。用户本地测试通过后发布为 v1.2.2（v1.2.1 已被 Windows 升级修复占用）。
- **变更文件**：
  - `electron/proxy/translate.ts`（`itemsToMessages` 从 for-of 改为 while 循环分组）
  - `tests/unit/translate.test.ts`（新增 2 个分组测试；修正断言：multi-turn 应为 7 条消息而非 6 条）
  - `package.json`（v1.2.1 → v1.2.2）
  - `CHANGELOG.md`（新增 v1.2.2 条目）
- **发布**：v1.2.2 tag 推送；GitHub Release 已创建 https://github.com/Mark7766/codex-switch/releases/tag/v1.2.2

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

---

## TASK-029：Claude 功能补全（Settings/Logs/Help 按设计稿对齐）

- **日期**：2025-07-14
- **类型**：feat
- **摘要**：对照 `docs/DESIGN-claude-support.md` 逐项排查四大页面缺口，补全缺失功能。
- **变更文件**：
  - `src/pages/Logs.tsx` — 新增"显示拦截"复选框，将原有 `showBlocked` 状态变量接线到 UI
  - `electron/claude/detect.ts` — `ToolStatus` 新增 `profilePaths?: string[]`，`detectClaudeCli` 返回时填充 shell profile 路径
  - `src/types/global.d.ts` — 同步 `ToolStatus` 接口更新
  - `src/components/ClaudeSettingsSection.tsx` — **新建**：自包含的 Claude 设置分区组件，含 Claude Code CLI（enable 开关 + shell profile 路径展示 + 5 个环境变量表格 + 保存）、Claude Desktop（enable 开关 + 配置路径展示 + 3 行模型映射表格 + 保存 + 备份还原）、一键卸载按钮
  - `src/pages/Settings.tsx` — 替换原简易 Claude section 为 `<ClaudeSettingsSection />`，删除已迁移的 state 和函数
  - `docs/help/faq.json` — 新增 5 条 Claude 专项 FAQ（tag: Claude）
  - `docs/help/onboarding.json` — 新增 2 个上手步骤（Claude Code CLI 验证、Claude Desktop 验证）
- **注意事项**：
  - Settings.tsx 行数从 490 降至约 350，符合 400 行限制；ClaudeSettingsSection.tsx ~245 行
  - TypeScript 0 错误；96/96 测试通过

---

## TASK-030：三个 Bug 修复（重复帮助、Claude Desktop 配置覆盖、CLI 模型名错误）

- **日期**：2025-07-14
- **类型**：fix
- **摘要**：修复用户测试后报告的三个 Bug。
- **变更文件**：
  - `src/App.tsx` — 从侧边栏 nav items 中移除 `{ id: 'help', label: '帮助', emoji: '❓' }`，去掉重复的帮助导航入口；顶部 `?` 按钮打开的 HelpDrawer 保留
  - `src/components/HelpDrawer.tsx` — 新增"诊断"标签页（内嵌原 Help 页的 DiagTab 内容：下载 JSON / 复制到剪贴板 / 打开日志目录 + 常见问题解决提示）；将旧 Help 页的全部内容合并到抽屉
  - `electron/claude/desktop-writer.ts` — 将 `writeClaudeDesktopConfig` 从**覆盖整个文件**改为**合并写入**（读取已有 JSON → spread 合并 gateway 字段 → 写回），防止 mcpServers 等用户配置丢失；`removeClaudeDesktopConfig` 同步改为只删除 gateway 字段，非空时写回而非 unlink；移除无用 `GatewayConfig` 接口
  - `electron/claude/env-writer.ts` — 移除 `DEFAULT_ENV_VARS` 中模型名的 `[1m]` 后缀（`deepseek-v4-pro[1m]` → `deepseek-v4-pro`）；该后缀是 UI 显示标注，直传 DeepSeek API 会导致模型无法识别
  - `src/components/ClaudeSettingsSection.tsx` — CLI 模型下拉移除带 `[1m]` 的选项；保存成功 toast 改为附带操作提示：CLI 配置显示"已写入 ~/.zshrc，请重新打开终端后运行 claude"，Desktop 配置显示"已写入 Claude Desktop 配置，请重启 Claude Desktop 生效"
- **注意事项**：
  - TypeScript 0 错误；96/96 测试通过（desktop-writer 原 6 个测试全部兼容新 merge 语义）
  - 用户遇到"ConnectionRefused"的根本原因：CLI env 未刷新（需要重开终端），现已通过 toast 提示
  - Claude Desktop 原代码覆盖写会导致 mcpServers 配置丢失，用户恢复备份后 gateway 配置消失，现改为 merge 可解决
