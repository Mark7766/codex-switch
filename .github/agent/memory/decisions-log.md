# 📝 Codex Switch — 技术决策日志 (ADR)

> **用途**：记录项目中每个重要技术决策，使决策可追溯、可理解。
> 格式参考 [Architecture Decision Records](https://adr.github.io/)。

---

## ADR 模板

```markdown
### ADR-{编号}: {标题}

- **日期**：YYYY-MM-DD
- **状态**：✅ 已采纳 / ❌ 已废弃 / 🔄 已替代
- **决策者**：{人员/Agent}

#### 背景
> 为什么需要做这个决策？遇到了什么问题？

#### 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| 方案 A | ... | ... |
| 方案 B | ... | ... |

#### 决策
> 选择了哪个方案？

#### 理由
> 为什么选这个方案？

#### 影响
> 这个决策会影响什么？
```

---

## 决策记录

### ADR-028: v2.0.0 — Codex DeepSeek 官方直连（不再走本地代理）+ 社区数字口径调整

- **日期**：2026-08-19
- **状态**：✅ 已采纳
- **决策者**：用户 + AI Agent

#### 背景
v2.0.0 之前，Codex 连 DeepSeek 走本地代理（127.0.0.1:11435），由代理做 OpenAI Responses ⇄ Chat Completions 协议翻译、模型映射、reasoning_content 跨轮回传。DeepSeek 官方文档确认 **DeepSeek API 原生支持 Responses 格式**，可以在 `~/.codex/config.toml` 里配 `[model_providers.deepseek]`（`base_url="https://api.deepseek.com/"` + `wire_api="responses"`）外加一份官方 `models.json` 模型目录，让 Codex CLI / Desktop / VS Code 插件直连 DeepSeek。

#### 决策
1. **Codex 直连 DeepSeek，照官方模板**：`config.toml` 写 `model_provider="deepseek"`、`preferred_auth_method="apikey"`、`forced_login_method="api"`、`model_catalog_json="~/.codex/models.json"`，`[model_providers.deepseek]` 段写 `base_url="https://api.deepseek.com/"`、`wire_api="responses"`、`experimental_bearer_token="<API Key>"`（密钥直接进 config.toml，完全照官方一键脚本）。同步写入官方 models.json（打包为静态资产 76KB）。
2. **DeepSeek 视为直连供应商**：`provider==='deepseek'` 不再需要代理；本地代理仅保留给 Agnes/GLM（它们只讲 Chat Completions）。ensureProxy / applyPreferencesTransaction / proxyInfo 全部把 deepseek 当作直连处理；直连状态在 Dashboard 显示「直连」。
3. **存量迁移**：启动时 `runV200DeepSeekDirectMigration` 把老 `127.0.0.1` 代理模板重写为直连（flag `v200_deepseekDirect` 一次性）。
4. **社区数字口径**：侧边栏「和 X 位朋友一起使用」从 Server 的「活跃用户(30天)」改为「累计注册客户端数」= `COUNT(client_registry)`（Server `community_stats` 新增 `total_clients` 字段，客户端 `communityGetCount` 改读它）。文案不变。

#### 理由
1. 官方文档确认原生 Responses 支持——不再需要协议翻译层，直连延迟更低、少一层转发
2. 「完全照官方」降低兼容风险：模板与 DeepSeek 一键脚本逐字一致（用户明确选择）
3. 复用 v1.16.0 自定义供应商的直连模式蓝本，改动面小
4. 社区数字用累计注册客户端数最直观，且不受 30 天遥测清理影响

#### 影响
- 直连后代理层功能对 DeepSeek 失效：请求日志、token 用量统计、对话缓存、后台建议拦截（Dashboard 显示「直连」，CHANGELOG 已注明取舍）
- `experimental_bearer_token` 使 API Key 明文出现在 config.toml（本地文件，与 auth.json chmod 600 同属「Codex 运行必需」妥协；OS 钥匙串仍为唯一权威存储）
- models.json 要求 Codex ≥ 0.144.0 才能读取模型目录元数据；旧版 Codex 直连仍可用但可能退化为默认行为
- 社区口径变更依赖 Server 端同步部署（community 返回 total_clients）
- **修订（2026-08-19，TASK-109）**：① 代理启停改为按「系统级全直连」判定（任一工具需要代理就启动，含 Claude 工具切 Agnes），不再只跟踪 Codex 供应商边界；② 客户端 `communityGetCount` 用 `total_clients ?? active_users ?? 0` 回退，Server 未部署时先显示旧口径；③ Dashboard 全直连时启停按钮常驻（点击提示"当前工具均无需本地代理"），文案改为"DeepSeek/自定义直连；GLM/Agnes 仍需本地代理"。

#### 替代方案
- "保留 DeepSeek 代理/直连开关" → 否决：多一个配置面，用户已明确 DeepSeek 完全直连
- "密钥仍走 auth.json + requires_openai_auth" → 否决：用户选择完全照官方（experimental_bearer_token）；auth.json 仍照写作为冗余兜底

---

### ADR-027: v1.16.0 — PackyCode 替换为自定义供应商（custom provider）

- **日期**：2026-06-24
- **状态**：✅ 已采纳（方案设计阶段，未编码）
- **决策者**：用户 + AI Agent

#### 背景
v1.15.0 引入的 PackyCode 供应商名称和 Base URL 硬编码在产品中。现在需要：① 不能以 PackyCode 名称出现；② Base URL 不能预置；③ 接入逻辑需适配任意第三方 API。

#### 决策
> 将 `'packycode'` provider 类型全局重命名为 `'custom'`，新增一个 `customBaseUrl` 字段让用户自行填写。Codex 和 Claude 工具共用这一个 URL。模型映射列表不做任何改动。存量 PackyCode 用户自动迁移（预填旧 URL `www.packyapi.com`）。

#### 理由
1. **极简化**：只加一个字段、一个输入框，其余全是机械重命名
2. **零破坏**：存量用户迁移后配置不变，Base URL 自动预填
3. **模型映射不动**：保留 PackyCode 已有的模型列表，用户无需重新配置
4. **自定义永远是直连**：不经本地代理（代理只做 Responses⇄Chat 翻译，对未知协议无效）

#### 影响
- ~15 文件，代码净变化约 +50/-60 行
- `store.ts` 新增 `customBaseUrl: string` 字段
- `secrets.ts` 重命名 keytar account（packycode → custom）
- `writer.ts` / `desktop-writer.ts` / `env-writer.ts` 硬编码 URL → `customBaseUrl`
- `Settings.tsx` 新增一个 Base URL 输入框
- 存量迁移：`runV160CustomProviderMigration()` 自动将 `packycode` → `custom` + 预填旧 URL

---

### ADR-026: v1.14.3 — claudeApplyAll 不再依赖 installed 检测，用户显式保存时强制执行写入

- **日期**：2026-06-22
- **状态**：✅ 已采纳
- **决策者**：用户 + AI Agent

#### 背景
用户反馈切换 Claude Desktop 供应商（GLM↔DeepSeek）后点「保存并应用」，配置文件实际未被修改。排查发现 `claudeApplyAll` handler 有三层静默失败：
1. `result.claudeDesktop.installed` 检测为 false 时跳过写入（例如应用未安装在预期路径、非标准安装位置）
2. API Key 缺失时 `if(!dk)` 静默跳过，UI 显示"保存成功"
3. `writeClaudeDesktopConfig` 异常被 catch 吞掉，只发遥测

任一条件满足，用户看到「保存成功」但文件实际未改动。

#### 决策
> `claudeApplyAll` 的 Desktop 和 CLI 路径均移除 `installed` 检测。用户点保存即强制执行写入。Key 缺失或写入失败时，收集错误信息并 throw 到 UI 层，让用户看到明确提示。

#### 理由
1. 用户点「保存并应用」是显式意图，应无条件执行，不应被环境检测拦截
2. 写入配置文件到磁盘无副作用——即便 Claude Desktop 尚未安装，写了配置文件等安装后也能自动生效
3. 静默失败是最差的 UX——用户以为操作成功，实际上什么都没发生
4. startupApplyClaude 保留 installed 检测（启动时自动 apply 不应在未安装时写文件），两条路径各有分工

#### 影响
- `electron/main.ts` `claudeApplyAll` handler：移除 `detectAll()` 调用（该 handler 不再需要 installed 信息）
- `src/pages/Settings.tsx`：新增 DeepSeek Key 缺失的 UI 守卫（之前只有 Agnes/GLM）
- handler 返回时若 errors 非空则 throw `Error`（含 `errors` 数组），UI 的 try/catch 展示具体失败原因

### ADR-025: v1.13.0 — Settings 页面三卡片独立供应商架构

- **日期**：2026-06-19
- **状态**：✅ 已采纳
- **决策**：放弃全局供应商下拉框统一全家桶的方案。改为三张独立卡片：Codex 接入、Claude Desktop 接入、Claude Code CLI 接入。每张卡片有自己的供应商选择、接入状态显示、模型联动。Claude 工具另有模型映射弹窗。
- **理由**：用户反馈全局切换不够灵活——不同工具有不同需求，一张卡片管一个工具更清晰。

### ADR-024: v1.13.0 — Agnes AI 多供应商支持（一个下拉框，切换上游）

- **日期**：2026-06-19
- **状态**：✅ 已采纳
- **决策者**：用户 + AI Agent

#### 背景
用户希望接入 Agnes AI（`agnes-2.0-flash`）作为 DeepSeek 之外的第二个 AI 供应商。Agnes API 兼容 OpenAI Chat Completions 格式（与 DeepSeek 相同），Base URL 为 `apihub.agnes-ai.com/v1`。

#### 决策
> Settings 加一个下拉框选供应商。proxy 根据选择切换上游 hostname 和 API Key。一个全局变量，选完保存，代理自动重启。不做多供应商同时路由、不做供应商级模型映射表。

#### 理由
1. DeepSeek 和 Agnes 都讲 Chat Completions，协议翻译层零改动
2. 苹果式简单：一个开关，选完即用，不需要新页面/新向导
3. 上游 hostname 从硬编码 `api.deepseek.com` 改为 `ProxyOptions.upstreamBase`，未来加新供应商只需加一个选项

#### 影响
- `stream.ts` 硬编码 `DEEPSEEK_BASE` 常量移除，改为 `deps.upstreamBase`
- `store.ts` 新增 `provider: 'deepseek' | 'agnes'` 字段
- `secrets.ts` 新增 Agnes Key keytar 存储
- Settings 新增供应商下拉框 + 动态 Key 输入

### ADR-023: v1.13.0 — 删除 LLM compact + ndjson 持久化，改用纯内存 LRU + Codex JSONL fallback

- **日期**：2026-06-19
- **状态**：✅ 已采纳
- **决策者**：用户 + AI Agent

#### 背景
v1.5.0 引入了自己的 LLM 摘要压缩（`compact.ts`, ~418行）和 ndjson 持久化缓存（`conversation-store.ts`, ~264行）。对标分析发现：

1. **cc-switch**：512 条纯内存，无 compact、无持久化。写 `model_context_window=1M` + 禁用 `enable_request_compression` 避免 404。
2. **Codex++**：读 Codex SQLite 元数据，无 compact、无持久化。同样是写 config 配置项。
3. Codex 的 `/v1/responses/compact` 返回 `encrypted_content`（OpenAI 专有 latent 表示），DeepSeek 不支持，经代理必 404。

用户决定和 cc-switch/Codex++ 对齐：不自己实现 compact，写 config 让 Codex 不触发，超限时给用户清晰中文提示。

#### 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| A. 保留 LLM compact + ndjson（当前） | 功能完整 | 维护 ~700 行 compact/ndjson 代码；compact 结果污染缓存一致性；摘要不当会让用户无从排查 |
| B. 纯内存 LRU + Codex JSONL fallback（和 cc-switch 对齐） | 删除 ~2000 行代码；缓存不丢数据（Codex JSONL 永久保有）；超限时用户明确知道发生了什么 | 重启后缓存清空需从 Codex JSONL 重新加载（~10ms/次） |

#### 决策
> 选择 **方案 B**：删除 `conversation-store.ts`、`compact.ts`、`compact-routes.ts`。代理使用纯内存 LRU（500条）。缓存未命中时从 `~/.codex/sessions/` 的 JSONL 文件回退读取。`/v1/responses/compact` 返回 `{ compaction: null }`。`codex/writer.ts` 写入 `model_context_window=1M` + `[features] enable_request_compression=false`。

#### 理由
1. 和 cc-switch/Codex++ 对齐——这两个项目都已大规模验证此策略可用
2. Codex 的 compact 依赖 OpenAI 专有 `encrypted_content`，经代理不可用
3. 绝大多数对话到不了 DeepSeek 128K 上限，compact 触发概率极低
4. LLM 摘要是不可逆信息损失，摘丢关键细节用户无从排查
5. 净删除 ~1967 行代码，降低维护负担

#### 影响
- 删除 `electron/proxy/conversation-store.ts`、`electron/proxy/compact.ts`、`electron/proxy/compact-routes.ts` 及配套测试
- 新增 `electron/codex/session-reader.ts` — 扫描 `~/.codex/sessions/` 目录读取对话历史
- `server.ts` ConversationStore → 纯内存 Map + LRU
- `codex/writer.ts` 追加 4 个上下文窗口配置字段
- ADR-019（v1.5.0 LLM compact）被推翻

---

### ADR-022: v1.11.0 — macOS 自动更新走原生 https 下载 DMG，不走 Squirrel.Mac

- **日期**：2026-06-16
- **状态**：✅ 已采纳
- **决策者**：AI Agent

#### 背景
v1.11.0 自动更新功能需要在 macOS 上自动下载新版本。由于 macOS 构建未签名（`identity: null`），Squirrel.Mac 的 `downloadUpdate()` 会触发签名校验失败（ADR-013），不能用于自动下载。但**下载 DMG 文件本身不需要 Squirrel.Mac**——用 Node.js 原生 `https.get()` 即可。

#### 决策
> macOS 自动下载走**原生 https 流式下载**，和插件包下载同模式。Server 返回 302 到 COS 广州 → 客户端 `https.get()` + stream pipe → 保存到 `~/Downloads/Codex-Switch-<ver>-mac-<arch>.dmg`。安装时 `app.quit()` 退出应用 + `shell.openPath(dmg)` 打开文件。

#### 理由
1. Squirrel.Mac 的签名限制只影响"原子替换安装"这一步，不影响文件下载
2. 原生 https 下载和 PluginManager 完全一致，代码复用
3. 下载完成后用户双击拖拽覆盖安装（macOS 标准操作），接受度高于"去浏览器下载"
4. Windows 端保持 `electron-updater.downloadUpdate()` + `quitAndInstall()`，全自动

#### 影响
- `electron/updater/index.ts` 重写，新增 `downloadMacDmg()` 函数（~90 行）
- macOS 端不再触发 `manual-download` 事件（浏览器跳转），改为正常的 `download-progress` + `downloaded` 事件流

### ADR-021: v1.10.0 — 离线插件安装采用"下载 + 自然语言引导"方案

- **日期**：2026-06-15
- **状态**：✅ 已采纳
- **决策者**：用户 + AI Agent

#### 背景
Codex Desktop 用户在国内无法正常访问插件市场（依赖 GitHub/npm），插件安装是最大痛点。我们需在 Codex Switch 客户端中提供友好的插件安装功能。

#### 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| A. 直接解压到 `~/.codex/plugins/` | 全自动、零用户操作 | Codex 插件格式/目录结构无公开文档，易因版本升级导致安装失败或损坏用户配置 |
| **B. 引导用户在 Codex 中输入自然语言指令，让 Codex 自己安装** | Codex 理解自己的插件机制；不会因版本变化而失效 | 多一步操作（复制粘贴）；需用户已启动 Codex |
| C. CLI 子命令 | 命令行自动化 | Codex CLI 子命令不稳定/不存在；CLI 本身不面向小白用户 |

#### 决策
> 选择 **方案 B**：Codex Switch 负责从 codex-switch-server 国内高速下载离线插件包（COS 广州，36MB，~15s），下载完成后生成自然语言指令「你帮安装一下离线插件安装包 {路径} ，我要把这些插件都加载到codex里」，用户复制粘贴到 Codex 对话框中，Codex 自行完成安装。

#### 理由
1. Codex 最懂自己的插件加载机制，绕过它硬编码目录路径极不安全
2. 指令用自然语言而非代码命令，符合"零门槛"产品定位
3. Server 端 COS 广州托管让国内用户下载速度可达 2MB/s
4. 下载路径选择 `~/Downloads`（而非 app data），用户可手动管理，路径直观

#### 影响
- 新增 `electron/plugins/` 模块（PluginManager）和 `src/pages/Plugins.tsx`
- 独立插件页面（非 Settings 子区块），有自己的多步流程
- 不支持断点续传（v1.10.0）：36MB 不值得增加复杂度
- 下载用原生 https 模块流式 pipe，避免 36MB 全进内存

---

## 决策记录

### ADR-001: 采用 Electron + React + TypeScript 作为桌面应用技术栈

- **日期**：2026-05-30
- **状态**：✅ 已采纳
- **决策者**：项目发起人 + AI Agent

#### 背景
旧的 `codex-deepseek-installer` 是基于 Python + CLI 的安装器，要求用户自行安装 Git、Node.js 和执行多条命令。目标用户大多数完全不懂命令行，这套流程对他们极不友好。
我们需要把"让 Codex 用上 DeepSeek"这件事做成**一个真正的图形界面桌面应用**：用户从 GitHub Releases 下载安装包 → 双击安装 → 点几下按钮搞定。同时需要 macOS 和 Windows 双平台覆盖，资源有限，必须一套代码两端复用。

#### 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A. Electron + React + TypeScript** | 业界事实标准（VS Code / Discord / Claude Desktop / Notion 均采用），生态成熟、跨平台一套代码、打包/签名/自动更新工具链完整（electron-builder）；前端开发者上手快；社区文档丰富 | 安装包较大（约 80 – 120 MB）；内存占用相对原生方案高 |
| B. Tauri + React | 安装包小（约 5 – 10 MB）、内存低 | 生态相对新，原生 webview 在 Windows（WebView2）和 macOS（WKWebView）行为差异需要额外踩坑；Rust 依赖让普通前端开发者构建/调试门槛高；本地 HTTP 代理 + keychain 需要 Rust 侧实现，开发成本明显增加 |
| C. .NET MAUI / Avalonia | 真原生体感 | macOS 支持不如 Windows 成熟；前端技术栈完全不通用；UI 复用难度大 |
| D. 各平台原生（Swift + WinUI） | 体验最佳 | 需要两套代码、两套技能栈；维护成本最高；明显违反"个人/小团队、极简"原则 |

#### 决策
> 选择 **方案 A：Electron + React + TypeScript（Vite + Tailwind + electron-builder）**。

#### 理由
1. **打包/分发最简单**：electron-builder 一条命令出 `.dmg` 和 `.exe`，GitHub Actions 多平台流水线模板成熟，对"一键安装"目标天然契合。
2. **对标产品全是 Electron**：Claude Desktop / VS Code / Discord / Notion 都用 Electron，UI/UX 参考直接可抄，避免重新发明轮子。
3. **本地 HTTP 代理零成本**：Node 内建 `http` 模块就能起服务并支持流式响应，无需额外 Rust/C++ 桥接代码。
4. **前端生态可复用**：React + TypeScript + Tailwind 是项目发起人熟悉的栈，迭代速度最快。
5. **极简原则优先于安装包体积**：相对于"小白用户能否装上"这件事，安装包多几十 MB 完全可接受；用户对桌面工具体积的容忍度远高于 web 应用。
6. **安全机制清晰**：`contextIsolation` + `preload` 白名单是 Electron 官方推荐模式，路径明确、文档完备。

#### 影响
- 整个工程结构按 Electron 主进程 / 渲染进程 / preload 三段划分（见 AGENTS.md）。
- 必须在所有渲染窗口启用 `contextIsolation: true` 并禁用 `nodeIntegration`。
- 打包流程依赖 electron-builder；macOS 需要 Developer ID 签名 + Apple 公证才能避免 Gatekeeper 警告；Windows 需要代码签名证书才能避免 SmartScreen。
- 安装包预计每平台 80 – 120 MB；Release 说明需向用户解释体积。
- 后续若需要更小的安装包或更低的内存占用，可以重新评估 Tauri，但需先确认 Rust 侧的代理 + keychain 工作量。

---

### ADR-002: 直接借鉴 `codex-deepseek-installer/proxy/deepseek-proxy.mjs` 作为代理实现的蓝本（含 WebSocket + reasoning_content）

- **日期**：2026-05-30
- **状态**：✅ 已采纳
- **决策者**：项目发起人 + AI Agent

#### 背景
参考工程 `/Users/mark/work/gitspace/opensource/codex-deepseek-installer` 中的 `proxy/deepseek-proxy.mjs`（约 523 行）已经在生产环境跑了相当长一段时间，覆盖了 Codex CLI / Desktop 实际会发出的所有请求形态：

- HTTP `/v1/responses`（OpenAI Responses API）
- WebSocket 流式协议（Codex CLI v0.132+ 强依赖）
- `deepseek-chat`（V3）与 `deepseek-reasoner`（R1）模型映射
- `reasoning_content` 在多轮对话中的回传（R1 思考模型必需）
- SSE 流式响应转发
- API Key 安全存储在 `~/.codex/auth.json`（`0o600`）

Codex Switch 是它的 GUI 版本，代理逻辑必须达到至少同等覆盖度，否则等于功能退化。

#### 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| A. 在 Electron 主进程中 spawn 原版 `.mjs`（child_process） | 改动最少，立刻可用 | 多了一层进程；打包体积要带 `proxy/` 目录；崩溃/日志/IPC 调试更麻烦；调试时主进程拿不到原始事件流 |
| **B. 用 TypeScript 重写为 `electron/proxy/` 模块（直接跑在 Electron 主进程内）** | 单进程、强类型、可单元测试（Vitest）、日志/状态/IPC 直接互通、打包简单 | 需要把现有 JS 逐段翻译并补类型 |
| C. 从零设计代理协议层 | 可定制 | 浪费已被验证过的设计；R1 `reasoning_content` 跨轮逻辑很容易踩坑 |

#### 决策
> 选择 **方案 B：以 `proxy/deepseek-proxy.mjs` 为蓝本，用 TypeScript 重写为 `electron/proxy/` 模块**，跑在 Electron 主进程内。

#### 理由
1. **行为对齐已知正确实现**：直接以参考代码为 spec，不用重新摸索 Responses API ⇄ Chat Completions 的字段映射、`reasoning_content` 的跨轮拼接、SSE 边界情况。
2. **保持默认端口 `127.0.0.1:11435`**：参考工程的 `config/config.toml.template` 已经写死这个端口，老用户的 `~/.codex/config.toml` 不用改一个字也能继续工作。
3. **WebSocket 必备**：Codex CLI v0.132+ 大量使用 WebSocket 流式协议，不支持就等于不可用，必须从一开始就把 `ws` 列为运行依赖。
4. **同进程的可观测性**：所有请求/响应事件能直接通过 IPC 推到渲染层的 Logs 页面（脱敏后），不需要再做跨进程日志聚合。
5. **可测试性**：TypeScript + Vitest 可以为 translate / reasoning / stream 三个核心函数写出 ≥ 90% 覆盖率，远好于黑盒跑 `.mjs`。
6. **打包简化**：单语言、单产物，electron-builder 不用额外打包 `.mjs` 子目录。

#### 影响
- 新增运行时依赖：`ws`（WebSocket 服务器）。
- 主进程结构按 `electron/proxy/{server,translate,reasoning,stream}.ts` 拆分，对应原文件中的逻辑段。
- 默认端口锁定 `11435`，不再变更（写入 `coding-standards.md` 与 `project-memory.md` 的关键约束）。
- 后续 Codex CLI / DeepSeek API 协议升级时，只需在对应 TS 模块内修改 + 补测试。
- 参考工程仍以 GitHub 原始链接形式在 README / docs 中致谢。

---

### ADR-003: 每个平台同时产出多硬件架构的独立安装包（mac x64/arm64 + win x64/arm64）

- **日期**：2026-05-30
- **状态**：✅ 已采纳
- **决策者**：项目发起人 + AI Agent

#### 背景
目标用户是"完全不懂电脑的朋友"，他们不会、也不该被要求去判断"我这台 Mac 是 Intel 还是 M 系列"或"我这台 Windows 是 x64 还是 ARM Surface"。同时：
- Apple Silicon（arm64）已成为 Mac 主流，但 Intel Mac 在 2020–2023 仍是大量存量用户。
- Windows 端 ARM 笔电（Surface Pro X / 9 / 10、Lenovo / 华硕 ARM 机型）份额持续上升，x64 在 ARM 上的转译性能/兼容性都不理想。
- electron-builder 原生支持每平台多 arch 一次构建。

#### 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| A. 每平台只发一个架构（mac arm64 + win x64） | 包数量少，CI 快 | 抛弃 Intel Mac 用户与 Windows ARM 用户；与"零门槛"原则冲突 |
| B. 仅 mac 出 universal `.dmg`，win 仅 x64 | 体验 OK，包数量较少 | universal 包体积约翻倍；Windows ARM 仍被抛弃 |
| **C. 每平台同时产出 x64 + arm64 两个独立包**（mac 额外可选 universal） | 用户下载页能精确匹配硬件，单包体积小；覆盖全部主流硬件 | CI 矩阵增加到 4 个分支；Release 资产数翻倍；下载页需要清晰的"我该下哪个"指引 |

#### 决策
> 选择 **方案 C**：默认产出 4 个独立安装包：

| 平台 | 架构 | 格式 | 文件名 |
|------|------|------|--------|
| macOS | x64 | `.dmg` | `Codex-Switch-<ver>-mac-x64.dmg` |
| macOS | arm64 | `.dmg` | `Codex-Switch-<ver>-mac-arm64.dmg` |
| Windows | x64 | NSIS `.exe` | `Codex-Switch-Setup-<ver>-win-x64.exe` |
| Windows | arm64 | NSIS `.exe` | `Codex-Switch-Setup-<ver>-win-arm64.exe` |

可选额外产出 macOS universal `.dmg`，给"不想选"的用户兜底。

#### 理由
1. **硬件全覆盖**：所有主流 Mac 与 Windows 硬件都能拿到原生架构的安装包，避免 Rosetta / Windows x86-on-ARM 转译带来的性能与崩溃风险。
2. **体积友好**：每个独立包大约 80 – 120 MB；universal 包接近 200 MB，作为可选项而非默认能让大多数用户少下一半。
3. **CI 友好**：electron-builder 的 `--mac --arm64` / `--win --arm64` 一行命令搞定；GitHub Actions 矩阵直接列 4 项，互不阻塞。
4. **下载页清晰**：Release 描述里给"我该下哪个？"图文表，把"零门槛"贯彻到分发环节。
5. **Windows 端必须是真正的安装包**（NSIS `.exe`），不是绿色版 zip——双击装、有开始菜单图标、有卸载入口，符合普通 Windows 用户的预期。

#### 影响
- `electron-builder.yml` 中 mac 配置 `target: [{ target: dmg, arch: [x64, arm64] }]`；win 同理。
- `.github/workflows/ci.yml` 的 build job 改为四元 matrix（已实施）。
- 发布 workflow（待建）需要分别在 macOS 与 Windows runner 上构建对应 arch 的产物，再统一上传到同一个 GitHub Release。
- 文档需提供「我该下哪个」表格：
  - Mac：左上角 Apple 菜单 → 关于本机 → 看「芯片」是 Intel 还是 Apple；
  - Windows：设置 → 系统 → 系统信息 → 看「系统类型」。
- 长期：如果 Intel Mac 装机量低于阈值（例如下载量 < 5%），再评估退役 `mac-x64`。

---

### ADR-004: 自动绕过 Windows 环境下 7z 提取 winCodeSign 软链接特权错误

- **日期**：2026-05-30
- **状态**：✅ 已采纳
- **决策者**：项目发起人 + AI Agent

#### 背景
当在未开启【开发人员模式 (Developer Mode)】且未使用管理员权限的普通 Windows 机器上运行 `pnpm package:win` 时，`electron-builder` 在下载并使用 `7za.exe` 解压 `winCodeSign-2.6.0.7z` 的过程中，会因为尝试在 Windows NTFS 分区上创建 macOS 相关的符号链接（`symlink`，例如 `darwin/10.12/lib/libcrypto.dylib` 和 `darwin/10.12/lib/libssl.dylib`）而抛出 `ERROR: Cannot create symbolic link: 客户端没有所需的特权`，导致打包程序强制崩溃退出。
要求非技术用户开启系统开发人员模式或启动管理员权限并不符合"极简零门槛"原则，我们需要一个能够让无论何种普通权限的 Windows 系统在没有任何特殊配置下都能完美一键打包的解决方案。

#### 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| A. 强制要求开发人员在 Windows 开启"开发人员模式" | 零额外脚本开发成本 | 用户体验差；很多不熟悉 Windows 高级设置的开发者无从下手；违反"零门槛"原则 |
| B. 改用 zip 格式打包并移除 `winCodeSign` 依赖 | 可绕过符号链接 | 无法使用 NSIS 自动生成合规、干净、友好的 Windows 双击安装包，只能发布绿色版 zip；对小白不友好 |
| **C. 自动预解压并过滤 macOS/linux components** | 100% 自动化；不破坏 NSIS 打包；在普通用户权限下即可完美通过；自动缓存复用已下载的 `.7z` 归档 | 需要编写一个大约 100 行的 Node.js 缓存预热脚本 |

#### 决策
> 选择 **方案 C：编写 `scripts/unblock-win-packager.mjs` 并在 Windows 下的 `package:win` / `package:all` 命令前自动注入**。

#### 理由
1. **纯自动化、静默完成**：用户仅需运行 `pnpm package:win`，该脚本自动搜寻 `AppData\Local\electron-builder\Cache\winCodeSign` 目录下的 `.7z` 缓存包；若不存在则自动从 GitHub 镜像下载。
2. **完美契合 electron-builder 缓存判断机制**：通过在 Cache 目录下预先解压出一个名为 `winCodeSign-2.6.0` 结构完整的文件夹，`electron-builder` 运行时在本地搜寻到匹配目录，会直接快乐地跳过默认的下载 extraction 阶段，直接使用缓存，从而绕过了错误！
3. **软链接裁剪过滤**：使用项目里现成的 Rust/Go/JS 便携式 7-Zip 工具：`node_modules/7zip-bin/win/x64/7za.exe` 并通过参数 `-x!darwin` 和 `-x!linux` 强制只解压对打包 Windows 绝无影响的 windows 工具链目录，完全过滤了包含 macOS 动态库软链接的部分（在 Windows 打包 Windows 并不需要 macOS 签名工具），彻底消除了因软链接生成所引发的操作系统特权阻碍。

#### 影响
- 在 `package.json` 的 `"package:win"` 和 `"package:all"` 前部追加运行 `node scripts/unblock-win-packager.mjs`。
- 在 `README.md` 与项目长期记忆中记录和规范该设计，使其具有完全的可维护性。

---

### ADR-005: 采用纯 Node.js (make-icons.mjs) 替代 Python 的 make-icons.py

- **日期**：2026-05-30
- **状态**：✅ 已采纳
- **决策者**：AI Agent

#### 背景
原本编译 macOS `.icns` 和 Windows `.ico` 程序图标使用 Python PIL 脚本 `make-icons.py`。然而，在 Windows 构建环境或者在没安装 Python 及其 Pillow 等复杂原生第三方库的宿主机上，该 Python 脚本无法正常执行。这会导致 `build/icon.ico` 和 `build/icon.icns` 无法生成，使 Windows 最终打包出 fallback 的默认绿色 Electron 标志图标，无法与 Mac 保持精美的 UI 视觉统一。

#### 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| A. 强制安装 Python 和 Pillow | 保持原有脚本不改 | 给无 Python/Pillow 的开发者和小白系统重重设卡，阻碍了一体化部署 |
| B. 引入 sharp, jimp 等第三方 Node 包进行绘制 | 生态熟悉 | 引入大量 Native 二进制依赖组件或重量级包，容易产生安装死锁、安装体积增加、特定系统构建崩溃等风险 |
| **C. 采用纯 Node.js 拼合预生成的 PNG 资源** | 100% 运行、零额外依赖、绝对轻量、二进制文件级编译、全宿主平台通杀 | 需要写文件级别的 ICO、ICNS 编译算法 |

#### 决策
> 选择 **方案 C**：利用仓库中已存在的、跨平台通用的预渲染图标文件集合 `build/icon.iconset/*.png`，利用 Node.js 原生的 `fs` 读写，在内存中完成 ICO 的目录区块拼写 + 偏移量填充；同时针对 ICNS 进行 ID 切片拼合。

#### 理由
1. **零依赖，零安全风险**：不加载外部 canvas、sharp、python等第三方运行时库。
2. **多端极致对齐**：保证了哪怕没有任何高级工具的 Windows 宿主机上，也可以通过 `pnpm build` 指令，秒级对齐生成高保真 Windows 及 macOS 双端图标。
3. **完全无感**：将其整合为 pre-build 流程，并成功对齐 electron-builder。


## ADR-004：模型映射四级回退（v1.0.0）
- **日期**：2026-05-30
- **决策**：mapModel 改为 `精确 → 白名单 → 前缀（按特异性排序）→ 默认回退`，前缀/回退命中时 WARN 日志且默认回退到 `deepseek-v4-flash`；存量用户通过 `modelMappingVersion` + `migrateIfNeeded` 安全合并默认映射。
- **理由**：v0.1.0 的 `mapping[req] || req || fallback` 会把未识别模型透传给 DeepSeek 触发 400，且新增映射对老用户不可见。
- **影响**：`electron/proxy/translate.ts`、`electron/config/store.ts`、相关单测；行为对新模型更友好。

## ADR-005：自动更新走 electron-updater + ghproxy 镜像（v1.0.0）
- **日期**：2026-05-30
- **决策**：使用 `electron-updater` 的 generic provider + `setFeedURL`；镜像 4 选 1（auto/github/ghproxy/custom），auto 时 5s HEAD 探测，sha512 校验保留。
- **理由**：国内用户直连 GitHub Release 经常超时；ghproxy 镜像可加速且对 electron-updater 透明，sha512 防镜像劫持。
- **影响**：`electron/updater/*`、`electron-builder.yml`（publish: github）、`release.yml`。

## ADR-006：日志生命周期 + 集中脱敏（v1.0.0）
- **日期**：2026-05-30
- **决策**：每次 `/v1/responses` 请求分配 `req_xxxxx`；日志结构化字段（reqId/phase/durationMs/model 等）；所有日志在 emit 前经 `redactSensitive`（sk-*, Authorization, OPENAI_API_KEY → ***）。
- **理由**：诊断包要拿给社区分析时不能泄露密钥；按 reqId 分组的 UI 也需要结构化字段。
- **影响**：`electron/proxy/server.ts`、`electron/proxy/errors.ts`、`src/pages/Logs.tsx`、`ReportIssueModal`。

## ADR-011：macOS auto-update 必须同时产出 zip target（v1.0.3）
- **日期**：2026-05-30
- **决策**：`electron-builder.yml` 的 `mac.target` 必须同时包含 `dmg` 与 `zip`（x64 + arm64）；`.github/workflows/release.yml` 的 `actions/upload-artifact path:`、flatten `find` 命令、`softprops files:` 三处 glob 都必须覆盖 `*.zip`。
- **理由**：electron-updater 在 macOS 上由 Squirrel.Mac 实施原子升级，**只接受 zip 格式补丁**；dmg 仅用于人工首次安装。若 release 中没有 zip，已发布客户端调用 auto-update 会直接报 `ZIP file not provided`，与产物 URL 是否能下载无关。
- **影响**：`electron-builder.yml`、`.github/workflows/release.yml`、所有未来 release 的 mac asset 数量翻倍（dmg+zip 各 2 + blockmap × 4）。
- **不踩坑提示**：electron-builder 默认 mac 配置只列 dmg；新工程很容易漏 zip 直到首位用户尝试自动升级才暴露。

## ADR-012：未签名 macOS 构建必须 identity:null + hardenedRuntime:false（v1.0.4）⛔ SUPERSEDED by ADR-013
- **日期**：2026-05-30
- **状态**：被 ADR-013 推翻。v1.0.4 客户端实测仍报同一签名错误，证明此路不通。`identity: null` + `hardenedRuntime: false` 调参可以保留（确实让 .app 不再写不一致的 CodeResources），但**不是**报错的根因，也不能修复 Squirrel.Mac 校验失败。详见 ADR-013。

## ADR-013：macOS 未签名分发禁用 Squirrel.Mac 自动升级，回退浏览器手动下载（v1.0.5）
- **日期**：2026-05-30
- **决策**：在 macOS 上，`UpdaterManager.download()` 不调用 `autoUpdater.downloadUpdate()`，改为 `shell.openExternal('https://github.com/Mark7766/codex-switch/releases/latest')` 并向渲染层 emit `manual-download` 事件；UI 引导用户手动下载 dmg 并拖入 `/Applications` 替换。Windows / Linux 路径不变，仍走 electron-updater 原生 auto-update。
- **理由**：Squirrel.Mac 在解压新 .app 后调用 `SecRequirementForLaunchedApp()` 获取**当前运行 app** 的 designated requirement，再用它校验新版 .app。对未通过 Apple Developer ID 真正签名的 app（包含 `identity: null` 与 `identity: '-'` ad-hoc 两种情况），该 requirement 退化为 `cdhash == <固定哈希>`——这意味着新版 app 必须与旧版字节完全一致，跨版本数学上不可能成立。这是 Apple 平台对未签名 app 的硬性限制，无法通过 electron-builder 配置或打包流程绕过。
- **影响**：
  - `electron/updater/index.ts`、`src/types/global.d.ts`、`src/components/UpdateBadge.tsx`、`src/pages/Settings.tsx` 都新增 `manual-download` 事件分支。
  - v1.0.0..v1.0.4 已安装的 mac 客户端跑的是旧代码，无法享受此 fallback；这批用户必须**手动**升级到 v1.0.5 一次。
  - 长期方案：若获取 Apple Developer ID 证书，移除 `darwin` 分支即可恢复原子自动升级。

## ADR-014：v1.1.0 — 代理生命周期状态机化 + 端口冲突显式化 + 运行期 crash 自动恢复
- **日期**：2026-06-01
- **状态**：✅ 已采纳（随 v1.1.0 上线）
- **决策**：
  1. 把 `DeepSeekProxy` 的 start/stop/restart 串行化到一个 `taskQueue: Promise` 上，状态以 `server.listening` 为最终真相，对外暴露 `stopped/starting/running/stopping/error` 5 态。
  2. **取消** EADDRINUSE 时静默 `port+1` 行为；端口冲突直接 reject + `emit('proxy-error', {kind:'port-conflict', recoverable:false})`，让用户在弹窗里选择"关闭进程并重试 / 改端口 / 取消"。
  3. `stop()` 增加 3 秒硬超时与 `closeAllConnections()` 兜底，挂起 SSE/WS 不再阻塞退出；并在 stop 完成后 `actualPort = 0`，确保下次 start 重新读取最新 `opts.port`。
  4. 运行期 crash（已成功 listen 后断开）触发 3 次退避自动恢复（1s / 3s / 9s），仍失败则停留 `error` 态并 emit `auto-recover-failed`。**不**给用户 "禁用自动恢复" 开关——简单可靠优先于可配置。
  5. `app.before-quit` 中 `proxy.stop()` 上加 3 秒硬超时，超时直接 `app.exit(0)` 防止进程僵死。
- **理由**：用户实测 P0 bug "改端口 → 停 → 启，端口不一致" 表层是 Dashboard 没刷 port，深层是 server 自动 +1 + stop 不清 port + prefs 不写 codex 三处叠加。一次性按状态机重写比修补三处更可靠，并彻底消除 "实际端口与设置不一致" 这类整类问题。
- **影响**：
  - `electron/proxy/server.ts`（核心逻辑）；新增 `tests/unit/server.lifecycle.test.ts` 5 用例。
  - 行为差异：以前同端口被占会自动 +1 启动，现在直接报错——**用户需主动处理冲突**，但端口可控。
  - 前端：必须订阅 `proxy:on-error` 并在 `port-conflict` 时弹 `PortConflictModal`。
- **替代方案**：
  - "保留 +1 自动让步" → 否决：是当前 bug 的源头，且让 Codex 配置文件失去与运行时端口一致性的保证。
  - "由用户决定是否自动恢复" → 否决：增加配置面、教育成本，1.1.0 优先减少决策点。

## ADR-015：v1.1.0 — Settings 页合并为 "保存并应用" 单按钮（事务化）
- **日期**：2026-06-01
- **状态**：✅ 已采纳
- **决策**：渲染层不再让用户分别决定"保存偏好"和"重新写入 ~/.codex"；点击"保存并应用"后由主进程 `prefs:apply` IPC 在一次 handler 中：① `setPreferences` ② 用最新 prefs 写 `~/.codex/config.toml` + `auth.json` ③ 若 `proxyPort` 改变且代理在跑则 `proxy.restart()`。任一步失败 → 回滚 store 到调用前快照，向渲染层抛错。
- **理由**：用户报告的端口不一致 bug 中，"prefs 写了但没写 codex" 是核心环节之一。让前端做两次按钮调用永远存在"只点一次"的人为漏配。事务化的另一好处是 `~/.codex` 与 store 严格同步。
- **影响**：删掉 Settings 页的 "重新写入 ~/.codex" 二级按钮；如需单独写 codex（极少场景），仍可通过 IPC `codex:write` 调用，但 UI 不再暴露。

## ADR-016：v1.1.1 — stop() 必须主动 terminate 已建立的连接
- **日期**：2026-06-02
- **状态**：✅ 已采纳
- **背景**：v1.1.0 用户反馈"点了停止代理，codex 还能正常问答；lsof 看端口仍然 ESTABLISHED"。复现：`server.close()` 与 `wss.close()` 都只是停止接受新连接，对已存在的 keep-alive HTTP / WebSocket 客户端默认**不主动断开**——它们要等客户端自己关。Codex CLI 的代理客户端会维持长连接，所以 stop 之后这些连接照样在 Codex Switch 进程里继续工作；3 秒兜底 `closeAllConnections()` 虽然存在，但触发太晚且未 `terminate()` WebSocket clients。
- **决策**：`stopInternal` 在调用 `server.close` / `wss.close` 之前先：① 遍历 `wss.clients` 调 `client.terminate()`；② 对 `http.Server` 立刻调 `closeIdleConnections()` 与 `closeAllConnections()`。这样 close 的回调几乎瞬间触发，3s race 仅作为最坏兜底。
- **理由**：Codex Switch 是桌面工具，"停止"必须立即失效；不能让 codex CLI 在残留 socket 上继续穿透。优雅排空（graceful drain）适合服务端，不适合桌面控制面板。
- **影响**：stop() 用时从最长 3s 缩短到 < 200ms；新增回归测试 `stop() forcibly terminates established keep-alive connections`。澄清 `~/.codex/config.toml` 仅做 `base_url` 指向，codex CLI 不会自启动任何进程——本应用是端口 11435 的唯一持有者。

## ADR-017：v1.1.4 — `response.completed` 必须包含完整 OpenAI 字段
- **日期**：2026-06-02
- **状态**：✅ 已采纳（必要前置，但单独不足以解决"问一句话被打 5 次"）
- **决策**：`response.created` / `response.completed` 都补齐 `created_at`、`error: null`、`incomplete_details: null`、`usage`（DeepSeek `prompt_tokens` 等映射为 OpenAI `input_tokens` 等，缺省 0/0/0）。
- **理由**：codex CLI v0.135 的 SSE/WS 解析期望这些字段；缺失会导致协议层判残，进入重试。

## ADR-018：v1.1.5 — `response.completed` 必须显式声明 `end_turn`
- **日期**：2026-06-03
- **状态**：✅ 已采纳（关键 bug 真正根因）
- **背景**：v1.1.4 把所有可见字段补齐后，用户实测仍然"一句话被打 5 次"。本机 ndjson 日志显示同一 WS 连接里 5 个 `req_xxx → success` 周期，间隔约 70ms，最后 1006 断连——典型 agent 自循环。
- **诊断**（基于上游源码）：
  - `codex-rs/codex-api/src/sse/responses.rs` 的 `ResponseCompleted` 把 `end_turn` 解析为 `#[serde(default)] Option<bool>`。
  - `codex-rs/core/src/client.rs` 的 agent loop 用 `ResponseEvent::Completed { end_turn, .. }` 判断本轮是否结束；`None` 不等同于 `true`。
  - 我们之前没发 `end_turn` → codex 解析为 `None` → agent loop 误判"未结束"→ 同 WS 自动 `response.create` 同一句话，循环到 backoff 用尽 1006 断连。
- **决策**：`electron/proxy/stream.ts` 在 `response.completed` 中显式加：`end_turn: !hasPendingToolCalls`。
  - 没挂起的 function_call → `end_turn: true`，本轮结束。
  - 有 tool_calls 待执行 → `end_turn: false`，等 codex 回 `function_call_output` 再下一轮。
- **替代方案**：
  - "始终 `end_turn: true`" → 否决：tool-use 场景永远拿不到工具结果，会断链。
  - "用 DeepSeek 的 `finish_reason` 直接映射"（`stop` → true，`tool_calls` → false）→ 等价但实现更复杂；当前用 `toolCalls` 字典是否非空已足够。
- **影响**：
  - 修复后单元测试 `tests/unit/stream.endTurn.test.ts` 锁死两个分支。
  - 真实 codex CLI 验证：`codex exec` 单问题只产生一对 `response.create`/`response.completed`，无 Reconnecting。
  - 参考工程 `codex-deepseek-installer/proxy/deepseek-proxy.mjs` 同样缺该字段，对 v0.135+ 也是潜在 bug；可考虑反哺 PR。
- **教训**：v1.1.4 单凭"补齐看起来该有的字段"判断 root cause 是错的。真正的 root cause 必须从协议消费者（codex 源码）反推；没有源码佐证就发版 = 概率事件。下次类似 bug 优先克隆 codex 看 parser，再设计补丁。

---

### ADR-006: Claude Desktop / Claude Code CLI 配置走 cc-switch 的 3P + settings.json 方案

- **日期**：2026-06-04
- **状态**：✅ 已采纳
- **决策者**：AI Agent（用户授权）

#### 背景
v1.x 早期版本往 `~/Library/Application Support/Claude/claude_desktop_config.json` 写
`inferenceProvider/inferenceGatewayBaseUrl/...` 完全无效，用户报告"配置根本没改变"。
Claude Code CLI 仅写 `~/.zshrc`，需要重启终端才生效，体验差。

#### 决策
照搬业内成熟方案 [`farion1231/cc-switch`](https://github.com/farion1231/cc-switch)：

1. **Claude Desktop** 走 3P (third-party gateway) 目录：
   - 在 1p 与 3p 两份 `claude_desktop_config.json` 都写 `deploymentMode: "3p"`，**保留**用户已有字段。
   - 网关参数写到 `Claude-3p/configLibrary/<PROFILE_ID>.json`。
   - `_meta.json` 维护 `appliedId` 与 `entries` 注册表。
   - PROFILE_ID 选 `00000000-0000-4000-8000-0000c0dec501`，故意区别于 cc-switch 的
     `00000000-0000-4000-8000-000000157210`，允许两者共存。
   - 卸载只在 `inferenceGatewayApiKey === 'cs-internal-placeholder'`（占位标记）时执行，
     避免误删用户手配的 profile。
2. **Claude Code CLI** 走 `~/.claude/settings.json` 的 `env` 字段（每次调用读取，**无需重启终端**）+
   `~/.claude/config.json` 写 `primaryApiKey: "any"`（cc-switch 的 OAuth 旁路标记）。
   `~/.zshrc` 块仍保留作为兜底。
   `settings.json` 中带 `__codexSwitch: "managed"` 标记，卸载时仅清理我们写入的 9 个 env 键，保留用户其他字段。
3. **Windows 路径** 从 `APPDATA` 改为 `LOCALAPPDATA`（Claude Desktop 实际安装位置）。

#### 替代方案
- "继续往 1p `claude_desktop_config.json` 写 gateway 字段" → 否决：Claude Desktop 不读这里，无效。
- "整体覆盖 `claude_desktop_config.json`" → 否决：会抹掉用户的 `mcpServers` 等已有配置。
- "只用 `~/.zshrc` 不写 `settings.json`" → 否决：需重启终端，UX 差，且其他 shell 配置可能覆盖。

#### 影响
- 用户安装后 Claude Desktop 重启即可走代理，Claude Code CLI 立即生效。
- `electron/claude/desktop-writer.ts` 完全重写（~210 行），新增 `PROFILE_ID` / `PLACEHOLDER_KEY` 常量。
- `electron/claude/env-writer.ts` 新增 `writeSettingsJson` / `writeAuthBypass` / `removeSettingsJson`。
- `tests/unit/desktop-writer.test.ts` 与 `tests/unit/env-writer.test.ts` 重写（断言改用路径定位，不再依赖 call index）。
- 与 cc-switch 共存：通过不同 PROFILE_ID 实现，两者切换互不干扰（但同一时刻只能有一个 `appliedId` 生效）。

#### 教训
集成成熟桌面应用的配置时，**先看竞品/参考实现的源码**再动手。Claude Desktop 的官方文档没说 3P 走
`Claude-3p/configLibrary/`，但 cc-switch 的 Rust 源码（`src-tauri/src/claude_desktop_config.rs`）
有完整路径推导逻辑；花 20 分钟读它比花 2 小时猜路径强。

---

### ADR-019: v1.5.0 — /v1/responses/compact 上下文压缩采用 LLM 摘要 + ndjson 持久化

- **日期**：2026-06-11
- **状态**：❌ 已废弃（被 ADR-023 取代）
- **决策者**：用户 + AI Agent

#### 背景
Codex Desktop 长对话后调用 `POST /v1/responses/compact` 报 502 错误。旧实现仅做"ID 克隆"（零压缩），且存在无错误处理、无超时、无请求体大小限制三个导致 502 的直接缺陷。conversationStore 纯内存存储导致代理重启后历史全丢。

用户在设计阶段明确要求：① 一次性综合方案而非分阶段渐进；② 选择 LLM 摘要（调 DeepSeek 总结旧消息）而非简单截断；③ conversationStore 需持久化到磁盘。

#### 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| A. 简单截断（保留最近 N 条） | 零成本、零延迟 | 丢失旧消息中的关键信息；长对话后期模型缺乏上下文 |
| **B. LLM 摘要 + 保留最近 K 条** | 保上下文连贯性；用户目标和决策不丢失 | 每次 compact 多一次 DeepSeek API 调用 |
| C. 完全不压缩（仅加固错误处理） | 改动最小 | 长对话最终超出 DeepSeek 上下文窗口（64K–128K），后续请求全部失败 |

#### 决策
> 选择 **方案 B：LLM 摘要 + 保留最近 K 条**。消息数 >20 时触发摘要（recentKeep=10 条不动），调用 DeepSeek 将更早的消息总结为一条 system 消息。失败时自动回退截断保留 30 条。conversationStore 使用 ndjson 文件持久化，debounce 5s 刷盘 + compact 后强制刷盘，启动自动恢复。

#### 理由
1. **用户明确选择**：设计阶段用户在三选一（简单截断 / LLM 摘要 / 分阶段）中选择了 LLM 摘要方案
2. **compact 是低频操作**（每长对话 1–2 次），多一次 API 调用的成本可忽略，对比"上下文断裂导致 N 次重试"反而省钱
3. **摘要质量有保障**：保留最近 10 条消息不做摘要，确保当前上下文 100% 准确；更早消息做摘要覆盖用户目标和关键决策
4. **持久化消除"失忆"脆弱性**：代理重启后 recover 所有对话历史，避免 compact ID 悬空

#### 影响
- 新增 `electron/proxy/compact.ts`（LLM 摘要核心）和 `electron/proxy/conversation-store.ts`（持久化层）
- `electron/proxy/server.ts` 新增 `handleCompactHttp` / `compactAndStore` / `processWsCompact` 三个方法
- conversationStore 接口从 `Map<string, ChatMessage[]>` 升级为 `ConversationStore` 类（兼容 get/set/has/delete/size）
- 每次 compact 发送完整对话历史到 DeepSeek API 做摘要（input tokens ≈ 对话历史大小）
- v1.5.0 版本号

#### v1.5.4 扩展：compaction_trigger / compaction item 协议对齐

- **日期**：2026-06-11
- **问题**：Codex Desktop 在 WS `response.create` 的 input items 中发送 `compaction_trigger`，期望响应 output 包含 `type: "compaction"` 项目。旧实现不处理该类型 item，导致 Codex Desktop 内部 "remote compaction v2" 报错。
- **决策**：
  1. 检测 input 中的 `compaction_trigger` → 复用已有 `compactAndStore()` 做 LLM 摘要 → 生成符合 OpenAI 协议的 `compaction` 输出项目（`type: "compaction"`, `encrypted_content: base64({compactedId, messages, timestamp})`）
  2. 在 `streamDeepSeek` 新增 `extraOutputItems` 可选参数注入额外输出项目到 `response.completed.output`
  3. 入站 `compaction` item 解码恢复对话历史（base64 → messages），补充 `previous_response_id` 机制
  4. `itemsToMessages` 显式跳过 `compaction` / `compaction_trigger` 类型
- **理由**：OpenAI Responses API 规范定义 `compaction` 为 opaque output item，Codex Desktop 依赖此类型判断 compaction 成功。我们的 base64 JSON payload 在 proxy 内自产自消费，对 Codex Desktop 完全透明。
- **影响**：`compact.ts`（+4 helper）、`stream.ts`（+extraOutputItems）、`server.ts`（async ws callback + trigger handling）、`translate.ts`（explicit skip）。141/141 tests pass。

---

### ADR-020: v1.6.0 — Claude Desktop 直连 DeepSeek（取消代理转发）

- **日期**：2026-06-11
- **状态**：✅ 已采纳
- **决策者**：用户 + AI Agent

#### 背景
v1.3.0 为 Claude Desktop 引入了本地代理转发路径（`anthropic-relay.ts`），使 Claude Desktop 通过 Codex Switch 代理间接访问 DeepSeek。但随着使用深入，代理层引入了多个问题：max_tokens 穿透导致回复截断（TASK-051）、tools strip 后模型回复偏短、SSE 流式转发增加延迟。同时 Claude Code CLI 一直走直连且运行良好——两种工具的接入模式不统一，增加了维护和排查的复杂度。

#### 决策
> 删除 Claude Desktop 的本地代理转发路径，改为和 Claude Code CLI 一样：由 Codex Switch 写入 3P gateway profile 直接指向 `https://api.deepseek.com/anthropic` + 真实 DeepSeek API Key。代理层仅保留 Codex（OpenAI Responses ⇄ Chat Completions 协议转换）。

#### 理由
1. **对称性**：Claude Desktop 和 Claude Code CLI 使用相同的 DeepSeek Anthropic 端点，配置逻辑统一
2. **消除整类 bug**：代理层的模型重写、tools 处理、max_tokens clamp、SSE 转发等逻辑全部移除，TASK-051 等代理特有问题自然消除
3. **代码净减少**：删除 ~400 行代码（`anthropic-relay.ts` + server 路由），降低维护负担
4. **DeepSeek 端点成熟**：Claude Code CLI 已长期验证同一端点稳定可用
5. **模型映射由 DeepSeek 处理**：按 model 前缀路由（opus→v4-pro, sonnet/haiku→v4-flash），Codex Switch 不再需要维护模型映射表

#### 影响
- `electron/proxy/anthropic-relay.ts` 整体删除（~400 行）
- `electron/proxy/server.ts` 移除 3 条 `/anthropic/v1/*` 路由
- `electron/claude/desktop-writer.ts` 重写：profile 指向 `api.deepseek.com` + 真实 API Key
- `electron/config/store.ts` 移除 `ClaudeDesktopPrefs.modelMap`
- 前端 Settings UI 简化（Desktop 模型映射下拉框移除）
- 新增 v1.6.0 存量用户迁移（自动改写 profile URL + API Key）
- 不再需要 `PLACEHOLDER_KEY` 机制；改用 `__codexSwitch: "managed"` 标记
