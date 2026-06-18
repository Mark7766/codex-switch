# 更新记录

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.13.0] - 2026-06-18

### 新增

- **🔍 智能搜索，遇到问题直接问**。右上角新增搜索按钮，点开输入问题（比如"Codex 连不上怎么办"），AI 会基于帮助文档和安装指南给你答案。不管在哪一页都能用，不打断当前操作
- **帮助文档全面升级**。FAQ 新增了大量常见问题：Token 消耗为什么高、怎么省钱、安不安全、Codex 没反应怎么办……都是真实用户每天在微信群里问的问题，现在打开帮助就能找到答案

### 修复

- **Claude Desktop 上手指南过时信息修正**。Claude Desktop 早就直连 DeepSeek 了，不再走本地代理——帮助文档和日志说明已同步更新
- **域名更换**。官网从 codexswtich.cloud 迁移到 codex-switch.cloud，一切自动生效，无需重新配置

## [1.12.2] - 2026-06-18

### 修复

- **自动更新检查终于正常工作了**。修复了更新检查一直报错的问题，现在启动 5 秒后会自动检查新版本，每 6 小时再检查一次。有新版会自动下载，完成后点右上角一键升级

## [1.12.1] - 2026-06-17

### 修复

- **装完插件，技能列表终于有东西了**。Codex 插件安装后会自动注册所有技能到活跃列表，技能面板不再空空如也。只注册通用开发类技能，跳过需要外部账号的 SaaS 插件

## [1.12.0] - 2026-06-17

### 新增

- **Claude 扩展一键安装**。插件页面 Claude 标签不再是占位——现在可以下载 170+ 个 Claude 扩展包（165 MB），一键复制指令粘贴到 Claude Desktop Cowork 中自动安装。精选 20 个核心扩展（含 Superpowers 全系列），也可以自定义选择安装哪些
- **Claude Code 也支持**。下载完成后点击「安装到 Claude Code」按钮，获得专属提示词，粘贴到 Claude Code 即可把扩展装进去
- **插件列表硬编码**。170+ 个 Claude 扩展清单内置在应用中，分类浏览、按需勾选，不需要等网络加载

## [1.11.0] - 2026-06-16

### 新增

- **推荐给朋友**。侧边栏新增「💚 推荐给朋友」入口，一键复制推荐语发给朋友。朋友打开安装指南，按步骤就能装好 Codex 和 Claude
- **社区计数**。侧边栏底部显示「和 X 位朋友一起使用」，知道自己不是一个人
- **🎖 早期成员**。v1.11.0 发布前安装的用户将永久拥有「早期成员」身份标签，显示加入日期和通过你加入的朋友数量
- **自动更新增强**。设置中新增「自动下载新版本」开关（默认开启）。开启后有新版本自动下载，完成后右上角通知，点一下就能升级。macOS 也会自动下载 DMG 到下载文件夹

### 修复

- 修复更新后窗口无法显示的崩溃问题（IPC handler 重复注册）

## [1.10.0] - 2026-06-15

### 重磅新增：离线插件一键安装 🎉

> 这是 Codex 用户安装后的 **Top 1 痛点**：插件市场强依赖 GitHub/npm 等境外资源，国内用户根本刷不出来。现在只需点两下——下载 → 复制一条指令粘贴到 Codex——173 个精选插件全部就位。

- **173 个精选离线插件包**。涵盖 Claude Code 集成、代码格式化、Git 辅助、中文优化等，由 codex-switch-server 维护更新
- **国内 COS 广州高速下载**。36 MB 约 15-20 秒完成（2 MB/s），比直连 GitHub 快 50 倍以上
- **零门槛体验**。侧边栏新增「🔌 插件」入口 → 点击下载 → 复制指令 → 粘贴到 Codex 对话框中 → Codex 自动完成安装
- **智能去重**。已下载过的用户再次进入直接跳到安装引导，不浪费流量
- **下载保护**。磁盘空间不足提前提示、30 秒静止超时自动中断、取消即清理临时文件
- **Dashboard NEW 角标**。首次使用引导，进入一次后自动消失

### 新增
- **插件页面**（`src/pages/Plugins.tsx`）。5 阶段状态机：加载 → 浏览 → 下载中（进度条+速度+剩余时间）→ 完成引导 → 错误恢复
- **PluginManager 核心模块**（`electron/plugins/`）。Server API 调用 → 302 重定向到 COS → 流式 pipe 写入磁盘 → 500ms 进度推送
- **插件遥测**。`plugin_pack_info_fetch` / `plugin_pack_download` / `plugin_install_command_copy` 三个事件，追踪下载漏斗转化率
- **Dashboard 插件快捷卡片**。「🔌 Codex 插件 · 173 个精选插件可一键安装 → 下载并安装」
- **Help FAQ 新增**。「如何安装 Codex 插件？」——标签「插件」

### 修复
- 修复 `plugins:get-install-command` IPC handler 被重复注册导致应用启动时窗口无法显示的崩溃 bug

## [1.9.1] - 2026-06-14

### 修复
- **上下文超限自动恢复 Token 化**。`emergencyCompact` 从按消息条数截断改为按 token 数截断（800K 上限），解决大代码块对话中单条消息 30 万+ token 导致压缩后仍超限的问题。
- **孤儿 tool 消息自动清理**。新增 `removeOrphanedTools` 函数，token 截断后自动移除失去对应 `tool_calls` 的孤立 `tool` 消息，修复 DeepSeek 返回 "tool must be a response to a preceding tool_calls" 错误。
- **中文错误识别**。`isContextExceededError` 新增"对话过长"、"上下文限制"、"超过模型"中文模式匹配。
- **压缩状态保存提前**。恢复逻辑改为先保存 compacted 状态再重试，即使重试失败下轮请求也不会重复从原始超大对话开始。

## [1.9.0] - 2026-06-14

### 新增
- **对话历史保护方案**（多用户反馈，P0）。详见 `docs/DESIGN-conversation-preservation.md`。
  - 代理停止前强制刷盘，消除 5 秒 debounce 窗口内的对话数据丢失
  - 对话缓存默认不清除（MAX_AGE→永久，MAX_ENTRIES 50→1000），用户可在设置中调整上限或手动清空
  - Settings → 新增「对话缓存」区块：显示已缓存条数、最早记录时间、缓存上限、清空按钮
- **对话记录来源切换**。首次安装时自动备份原始配置（`install-original`），永久保留。
  - Settings → 新增「对话记录来源」开关：一键在 OpenAI 官方 ↔ Codex Switch 代理之间切换
  - 切换不会删除任何对话——用户随时可找回 OpenAI 上的历史对话
- **Dashboard 恢复提示**。首次使用后若存在原始配置备份，显示可关闭的 amber 提示条引导用户找回对话。

### 修复
- **上下文超限自动恢复增强**（v1.8.1 补充）。`isContextExceededError` 新增中文模式识别（"对话过长"、"上下文限制"、"超过模型"），覆盖 DeepSeek 中文错误信息。
- `conversation-store` 自动清理逻辑移除（24h/50 条静默删除 → 用户手动控制）

## [1.8.0] - 2026-06-13

### 质量提升（按 QUALITY-AUDIT-v1.7.0.md 执行）

**P0 — Critical**
- **C4 CSP**: `src/index.html` 新增 Content-Security-Policy meta 标签
- **C1 Server 拆分**: `server.ts` 1587→641 行（-60%），提取 6 个子模块

**P1 — High**
- **H1 路径穿越**: `restoreCodexConfig`/`deleteBackup`/`restoreClaudeDesktopBackup` 新增目录白名单校验
- **H2 命令注入**: `env-writer.ts` 的 `setx`/`reg delete` 改为 `execFile`（参数数组）
- **H5 IPC 校验**: `keySet`/`proxyLookupPort`/`proxyKillPort`/`prefsSet`/`codexWrite` 新增类型/范围校验
- **H6 并发竞态**: `store.ts` 新增 `writeMutex` 串行化写入 + `applyPreferencesTransaction` 精确回滚

**P2 — Medium**
- **M1 静默 catch**: 6 个文件 9 处 catch 块添加 `log.warn`/`log.debug`
- **C2 渲染层测试**: 新增 `store.test.ts`（10 用例）+ `Settings.test.tsx`（6 用例）
- **C3 E2E 框架**: Playwright 配置 + `smoke.test.ts` + `test:e2e` 脚本

**P3 — Low**
- **M2 死代码**: 移除 2 个未使用的 IPC 通道 + `void dialog`
- **M3 IPC 一致性**: 新增自动验证 preload 与 channels IPC 同步的测试
- **M5 依赖更新**: `electron-updater` 6.8.3→6.8.9，`prettier` 3.8.3→3.8.4；评估报告记录大版本风险

## [1.7.0] - 2026-06-12

### 新增
- **Server 集成 — 更新检查接入 codex-switch-server。** 新增 `'server'` 镜像模式（默认首选），更新检查 feed URL 指向 `https://www.codexswtich.cloud/api/v1/updates`。`pickAuto` 探测顺序调整为 server → github → ghproxy。
- **体验优化计划（匿名遥测上报）。** 新增 `electron/server-client/` 模块：`config.ts`（Server URL 三级优先级解析 + clientId 管理）、`client.ts`（HTTP 客户端，原生 `node:https`）、`telemetry.ts`（遥测客户端，支持离线检测、退避重试）。默认开启，可在 Settings 底部关闭。
- **网络离线自适应。** 断网时遥测静默停止上传，HEAD ping 主动探测 + 被动错误兜底，连续 3 次失败后指数退避（5min → 10min → 20min，上限 1h）。离线下 `track()` 不入 buffer，网络恢复后自动恢复上报。遥测故障绝不阻塞代理主流程。
- Settings → 底部新增「体验优化计划」勾选框（默认勾选）。

### 变更
- `updateMirror` 默认值从 `'auto'` 改为 `'server'`。v1.6.x 存量用户自动迁移。
- `electron/updater/mirrors.ts`：`MirrorMode` 类型新增 `'server'`，`buildFeedUrl` 和 `pickAuto` 支持 server 参数。
- `electron/config/store.ts`：新增 `serverUrl`、`telemetryEnabled`、`clientId` 三个字段及默认值。
- `electron/ipc/channels.ts`：新增 `telemetry:set-enabled`、`telemetry:get-online`、`server:ping` IPC 通道。
- `electron/proxy/server.ts`：新增 `ProxyOptions.onModelCall` 回调，每次请求完成时触发，供遥测使用。
- `src/types/global.d.ts`：新增 `serverUrl`、`telemetryEnabled`、`clientId` 类型，`updateMirror` 扩展为含 `'server'`。

### 开发连调
- 开发模式（`!app.isPackaged`）自动连接 `http://localhost:8000/api/v1`，零配置即可本地连调。
- 环境变量 `CODEX_SWITCH_SERVER_URL` 可覆盖 Server URL（优先级最高）。

## [1.6.0] - 2026-06-11

### 变更
- **Claude Desktop 直连 DeepSeek（不再走本地代理）。** Claude Desktop 3P 网关 profile 从指向本地代理 `http://127.0.0.1:{port}/anthropic` 改为直接指向 `https://api.deepseek.com/anthropic`，API Key 从占位符改为真实 DeepSeek Key。与 Claude Code CLI 一致——两者都直连 DeepSeek，不再经过 Codex Switch 代理转发。
- **删除 `electron/proxy/anthropic-relay.ts`**（约 400 行）。模型名重写、tools/tool_choice strip、SSE 流式转发、max_tokens clamp 等代理层逻辑全部移除。
- **server.ts 移除 `/anthropic/v1/*` 路由**（3 条）。
- **desktop-writer.ts 重写**：profile JSON 增加 `__codexSwitch: "managed"` 标记用于卸载识别；`inferenceModels` 扩展为 3 条（opus→v4-pro, sonnet→v4-flash, haiku→v4-flash）；`PROFILE_NAME` 改为 "DeepSeek"。
- **store.ts 简化**：`ClaudeDesktopPrefs.modelMap` 字段移除（模型映射由 DeepSeek 端点按前缀处理）。
- **detect.ts 更新**：检测 Claude Desktop 配置的条件从 `127.0.0.1` 改为 `deepseek.com`。
- **前端 UI 简化**：ClaudeSettingsSection 移除 Desktop 三行模型映射下拉框，改为只读模型表。
- **新增 v1.6.0 迁移**：存量用户 profile 自动从本地代理 URL 改写为 `api.deepseek.com` + 真实 API Key。

### 修复
- **max_tokens 穿透问题自然消除。** v1.5.5 修复的 Claude Desktop warmup probe `max_tokens=1` 导致回复截断问题，直连后不再需要代理层 clamp（DeepSeek 端点自行处理）。

## [1.5.0] - 2026-06-11

### 新增
- **上下文压缩完整重构（LLM 摘要 + 持久化）。** 修复了 Codex Desktop 在长对话后调用 `/v1/responses/compact` 时报 502 错误的问题。根因有三：① compact 端点缺少错误处理/超时/请求体大小限制，流异常时连接裸断导致 502；② 旧实现仅做"ID 克隆"没有真正的上下文压缩，长对话最终超出 DeepSeek 上下文窗口；③ conversationStore 纯内存存储，代理重启后历史全部丢失（"失忆"bug 复现）。重构为三个维度：**健壮性**（HTTP handler 全加固：30s 超时 / 1MB 大小限制 / 流错误捕获 / 400/408/413/500 分级错误响应；WebSocket 新增 `response.compact` 事件处理）、**LLM 摘要**（消息数 >20 时调用 DeepSeek 做对话摘要，保留最近 10 条不动，失败时回退截断保留 30 条）、**持久化**（conversationStore 使用 ndjson 文件存储，debounce 5s 刷盘 + compact 后强制刷盘，启动恢复 + 24h/50 条自动清理）。新增 `electron/proxy/compact.ts` 和 `electron/proxy/conversation-store.ts` 两个模块，新增 19 个测试用例，全量测试 123 个通过。

## [1.2.3] - 2026-06-02

### 修复
- **对话失忆修复。** 使用 Codex Switch 代理后，Codex 每轮回复都不记得上一轮说了什么。根因：OpenAI Responses API 是有状态的，Codex 客户端每轮只发当前新消息并附带 `previous_response_id`，历史上下文本应由服务器维护；代理完全忽略了该字段，导致每次请求都只含当轮消息、模型完全失忆。修复：代理新增 `conversationStore`，每轮请求结束后将完整对话保存为对应 `responseId` 的记录，下轮收到 `previous_response_id` 时自动查找并拼接历史，再发给 DeepSeek，最多缓存 200 轮（按连接生命周期自动 GC）。

## [1.2.2] - 2026-06-01

### 修复
- **多工具调用（multi-tool use）400 报错修复。** 当 Codex 在同一轮次里发出多个 `function_call`（如同时调 `shell`、`read_file`、`write_file`），之前每个调用被翻译为独立的 assistant 消息，导致 DeepSeek 返回 400 错误："An assistant message with tool_calls must be followed by tool messages"。现已修复：同一轮次所有 function_call 合并进一条 assistant 消息的 `tool_calls` 数组。

## [1.2.1] - 2026-06-01

### 修复
- **Windows 自动升级/退出可靠性修复。** 解决 Windows 用户在下载完更新点「立即升级」时报错"原版本程序未关闭"的问题。优化：在调用升级安装前主动停止代理并刷新统计数据，避免 `before-quit` 事件锁死进程；退出逻辑由 `app.quit()` 改为 `app.exit(0)`，确保进程彻底销毁。
- **多工具调用（multi-tool use）400 报错修复。** 当 Codex 在同一轮次里发出多个 `function_call`（如同时调 `sh`、`read_file`、`write_file`），之前每个调用被单独翻译成一条 `assistant` 消息，导致 DeepSeek 报 400："An assistant message with 'tool_calls' must be followed by tool messages"。现在将同一轮次的所有 `function_call` 合并进一条 `assistant` 消息的 `tool_calls` 数组，符合 Chat Completions 协议规范。

## [1.2.0] - 2026-06-01

### 新增
- **拦截请求不计入统计，日志默认过滤。** 被本地拦截的请求（空 warm-up / suggestion）不再累加到"处理请求数"或 lifetime 统计；日志面板默认隐藏拦截条目，可通过"显示拦截请求 (N)"按钮切换显示。统计条仅展示实调 DeepSeek 的请求数量。
- **Token 计费（持久化）。** 每次实调 DeepSeek 结束后记录 DeepSeek 返回的 `usage`（inputTokens / outputTokens），在日志面板成功行末尾显示 `↑X ↓Y tokens`；主面板「累计」区块新增输入 / 输出 / 总 token 统计，跨重启持久化（每 30s 写入 electron-store）。未来付费「节省 token」功能预留了 `tokenSavingEnabled` 字段钩子。

## [1.1.10] - 2026-06-01

### 修复
- **v1.1.9 的空 warm-up 拦截条件写错了。** 原条件要求 `instructions` 为空，但 Codex Desktop 的 warm-up 帧虽然 `input=[]`，却带了系统提示词，导致条件始终为 false、warm-up 仍被转发到 DeepSeek（1.5–2.5s/次）。本版只看 `input.length === 0`，不再看 instructions。
- **日志面板区分 "实调 / 已拦截 / 失败"。** 被本地拦截的请求现在指示为灰色圆点 + `⌫ 本地拦截，未调用 DeepSeek（未消耗 token）`，顶部统计条同时展示 *实调 DeepSeek* / *已拦截* 两个计数，让用户一眼看出哪些请求费了 token、哪些是免费本地返回。

## [1.1.9] - 2026-06-01

v1.1.8 拦住了 "建议气泡" 提示词本身（~1ms），但 Codex Desktop 在打开后台 WS 时还会发一帧 **空 warm-up handshake**（`items=0 instructions=''`），上版仍会转发到 DeepSeek。结果是即使用户不操作，Codex Desktop 仍然每 ~30s 轮询一次，每次费一次真 DeepSeek 调用。

### 修复
- **同时拦截空 warm-up 请求**：如果一条 `response.create` 的 `input` 是空数组且 `instructions` 为空，本地直接返回空 `response.completed`，不走上游。`finishReason=blocked-empty-input`，耗时 ~1ms。
- codex CLI 的真实提问首帧 `items ≥ 1`，不会误伤。

### 说明
- Codex Desktop 的轮询本身是其客户端行为，我们无法从代理侧禁止（关掍 WS 会被立即重连，反而更坏）。本修复使每次轮询的两条请求（warm-up + suggestion）都变为本地短路，累计费用接近零。

## [1.1.8] - 2026-06-01

用户用 Codex Desktop 单句提问产生 17+ 请求、长时间使用累积 500+：复盘日志定位出 Codex Desktop 后台 "hyperpersonalized suggestions" 特性在每个闲置周期会拉起独立 WS，每个 WS 又带动 4-7 次 tool-use 调用。这些请求与当前会话无关、不影响使用、纯耗 token。

### 修复
- **拦截 Codex Desktop "建议气泡" 后台请求。** 代理以指纹识别（`# Overview / Generate 0 to 3 hyperpersonalized suggestions`）本地返回空建议 + `end_turn=true`，不调用 DeepSeek。后台 finish 标记为 `blocked-suggestion`，日志可查。开启后同一提问的总请求数从可能数十次变为 1–2 次。
- 设置 → 代理与模型 里新增开关（默认开）：*拦截 Codex Desktop 后台 "建议气泡" 请求*。依赖该特性的用户可手动关闭。

## [1.1.7] - 2026-06-01

基于 v1.1.6 的可观测日志，复盘了用户提供的 ndjson：所谓 "一句话被打 5 次" 实际上是 **两个独立 WS** 上的两件事——一个是用户真实提问（1 次请求即 end_turn），另一个是 Codex IDE 的 "hyperpersonalized suggestions" 后台特性触发的多轮 tool-use 链（warm-up + 提示 + 3 次 function_call_output → 最终 stop）。代理本身行为正确，每次 `tool_calls` 都正确发 `end_turn=false`、最终 `stop` 发 `end_turn=true`。

### 修复
- **模型映射补全**：`gpt-5.4`、`gpt-5.4-pro` 加入默认映射表，避免 codex CLI 自报 `gpt-5.4` 时落到前缀兜底规则触发 WARN。`CURRENT_MAPPING_VERSION` 升至 3，老用户启动时自动合并新键（已有自定义映射不被覆盖）。

### 说明（不修复）
- 后台 "suggestions" 多轮 tool-use 链是 codex IDE/CLI 自身的能力，由模型决定是否调工具、调几次。代理只是忠实转发协议，不应也不会拦截。如希望减少这类调用，请在 codex 端关闭对应特性。

## [1.1.6] - 2026-06-03

v1.1.5 的 `end_turn` 修复在 `codex exec` 单次问答里验证有效（1-2 次请求即结束），但用户报告交互式 codex 仍然有连发请求；本版本不再做 "靠猜的修复"，而是把诊断信息 **写进默认日志**，让下一次复现就能看出真因。

### 新增（诊断/可观测）
- `proxy.ndjson` 现在每条 WS 请求都带 **`connId`**（如 `ws_mptyt2e9_7hrm`），同一个 WS 上的请求一目了然——之前所有日志条目都没有连接 id，导致无法区分 "5 次同 WS 循环" 和 "5 次独立 WS 调用"。
- 请求开始日志现在包含 **`items=N kinds={message:3,function_call_output:1,...} tools=N lastUser="前 80 字"`**，可以直接看出 codex 是不是在重发同一个问题（lastUser 重复 = bug；items/kinds 增长 = 正常 tool-use 流转）。
- 请求成功日志现在包含 **`end_turn=true|false finish=stop|tool_calls|...`**，确认本进程实际发出去的 `response.completed.end_turn` 与上游 DeepSeek 的 `finish_reason`。
- WS 关闭日志多打印 `conn=...` 关联 connId。

### 加固
- `end_turn` 判定加 `finish_reason !== 'tool_calls'` 双保险：即使 DeepSeek 把空 `tool_calls` 数组带在 deltas 里，只要 `finish_reason: 'stop'` 也会被判为本轮结束。
- 文档代码审查：`PROXY_DEBUG_WS=1` 仍然保留为打印 WS 原文消息的强力开关，但日常诊断已不再依赖它。

### 仍待验证
- 本机 `codex exec` 验证为单次问答 2 次调用（1 次 warm-up + 1 次真实回答），无循环——此版本不再做盲目修复，等用户在交互式 codex 上跑一次后，根据新增日志锁定真因。

## [1.1.5] - 2026-06-03

彻底修复"问一句话被打 5 次"的浪费请求 bug。**这是真正的根因，1.1.4 的字段补全是必要但不充分的前置修复。**

### 修复
- `response.completed` 现在包含 **`end_turn`** 字段：当本轮没有挂起的 `function_call` 时为 `true`，否则为 `false`。
  - 根因：codex CLI v0.135 的 agent loop（见 `codex-rs/codex-api/src/sse/responses.rs` 的 `ResponseCompleted` / `codex-rs/core/src/client.rs`）以 `Option<bool>` 解析该字段。我们之前没发，codex 解析为 `None`，agent loop 误判"对话还没结束"，自动在同一 WS 上再发 `response.create`，把同一句话反复打到 DeepSeek，直到客户端 backoff 用尽以 1006 断连——用户看到的就是"一句话被打 5 次 + Reconnecting"。
  - 修复后 codex 拿到 `end_turn=true` 立刻终止本轮，单次问题只产生一次上游请求。
- 验证：本机用真实 `codex exec --skip-git-repo-check "..."` 跑通，`PROXY_DEBUG_WS=1` 抓 WS 原文确认每个用户提问只对应一对 `response.create`/`response.completed`。

### 新增
- `PROXY_DEBUG_WS=1` 环境变量：开启后在 stdout 打印每条 WS 入/出消息原文（截断到 600 字符），便于本地排查协议层问题。生产模式默认关闭，无任何性能影响。
- 仓库内新增 `scripts/dev-proxy.cjs` 与单测 `tests/unit/stream.endTurn.test.ts`，把 `end_turn` 行为锁死。

## [1.1.4] - 2026-06-02

修复 codex CLI 不交事、不停「Reconnecting…」但 proxy 依然连续返 200 的坊间 bug（同一条 WS 上 5 次重发同一个问题，WS 未闭）。

### 修复
- `response.created` / `response.completed` 现在包含 `created_at`、`error: null`、`incomplete_details: null`、`usage`（上游 DeepSeek 返回的 token 计数映射为 OpenAI 格式，缺省 0/0/0），与 OpenAI Responses API 契约一致。较新版 codex CLI 缺这些字段会判响应不完整并重试，用户看到的是“Reconnecting…”。
- `handleWs` 加 20s 服务端 ping 心跳（`ws` 库默认不发），WS 关闭日志补充 `reason`。

## [1.1.3] - 2026-06-02

CI 修复：v1.1.2 发版流水线在下载 `nsis-resources-3.4.1.7z` 时遇 GitHub 镜像 502，导致 Windows 包未产出；format:check 检出 7 个文件未走 prettier。

### 修复
- 为 `release.yml` 的 Windows build 加 3 次重试（与 mac 一致），避免偶发 502 直接失败。
- `pnpm format` 走一遍，全库 prettier 清洁。

## [1.1.2] - 2026-06-02

UX 补丁：为关键操作补上「点了之后有反应」的可见反馈。

### 优化
- 设置页「保存并应用」、「保存 API Key」：点击后按钮即时变 spinner + 「正在应用…」并 disabled；右上角 Toast 依次弹「正在保存并应用…」→「已保存并应用」（成功/错误/变更重启代理都会提示）。
- 主面板「启动/停止代理」同样使用 spinner + 文案切换（「正在启动…/正在停止…」）+ 全局 Toast，按钮最小宽防抖动。
- 统一反馈风格：info → success/error 三色 Toast 2 秒自动消失，可点击关闭。
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
