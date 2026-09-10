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

### ADR-036: 「切换到 OpenAI 官方」不得删除 `[model_providers.*]` 块；`sanitizeManagedConfig` 默认一块不剥

- **日期**：2026-09-10
- **状态**：✅ 已采纳
- **决策者**：用户 + AI Agent

#### 背景
ADR-034 修好了「切换**供应商**后旧对话打不开」。用户随即发现**同一 bug 的另一条入口**：点「切换到 OpenAI 官方」后，报错原封不动回来了 —— `Model provider ZAI not found` / `Model provider deepseek not found`。

根因：全仓只有两条剥离路径，上次只修了一条。

| 路径 | 调用 | `stripProviderBlocks` | 结果 |
|---|---|---|---|
| 切换到另一家供应商 | `writer.ts` `writeCodexConfig` | `[当前那家]` | ✅ 已修 |
| **切换到 OpenAI 官方** | `writer.ts` `restoreOriginalConfig` | 不传 → 默认 `'all'` | ❌ 所有受管块全删 |

用户的判断直接命中了要点：**OpenAI 官方也是「一家供应商」**，没理由对它特殊对待。

#### 关键认识（推翻了一个旧假设）

**删块这一步本来就是多余的。**

- **BUG-007（v2.3.0）的要害是顶层 `model_provider` 残留，不是块。** 当时报错 `but you passed gpt-6-astra` 的成因是：`model` 被清掉了、`model_provider = "deepseek"` 还在 → Codex 把官方默认模型名发给了 DeepSeek。**删掉顶层 `model_provider` 就已经切回官方了。**
- **未被选中的 provider 块是惰性的。** Codex 只解析 `model_provider` 指向的那一家，`[model_providers.X]` 只是配置里的一张没被引用的表。**这正是 ADR-034 的机制本身** —— deepseek ↔ ZAI 互切能工作，靠的就是「保留另一家的块」。同一机制对 OpenAI 官方同样成立。

#### 决策
① **删掉 `stripProviderBlocks: 'all'` 这个模式**，`SanitizeOptions.stripProviderBlocks` 改为 `string[]`，**默认 `[]`（一块都不剥）**。
② `restoreOriginalConfig()`（「切换到 OpenAI 官方」）不再传该参数，**只清顶层受管键与 `[features]` 受管键**。
③ 顺带删掉由此变成死代码的 `MANAGED_PROVIDER_BLOCK` 与其 import。

#### 理由
- **不安全的能力不该保留。** 修完这条路径后仓库里再无任何调用方需要 `'all'`（真正的「恢复出厂」是 `restoreCodexConfig(backupPath)`，整文件覆盖 `install-original` 备份，与剥离无关）。留着一个「会把块删光」的模式，就是留一个会复现本 bug 的陷阱。默认值必须是最安全的那个。
- **单一心智模型。** 改完后「OpenAI 官方」在结构上与其他供应商平起平坐：切到它 = 让顶层 `model_provider` 消失，就这么简单。

#### 为何不会让 BUG-007 回归
顶层 `model_provider` 与 `model` 仍被 `MANAGED_TOP_KEY` 清除 → Codex 回落到内置 `openai`，保留的块永远不被引用。已用测试锁定（`writer.test.ts` / `config-merge.test.ts` / `providers.test.ts` 共 8 条断言），并做**变异验证**：把默认值临时改回「剥光三家」→ **恰好这 8 条如期失败**，还原后 163/163 通过。

#### 影响
- 用户可见文案同步（`Settings.tsx`）：「清除本应用写入的配置，恢复 Codex 原生行为」→「Codex 改回用 OpenAI 官方；已接入的供应商配置会保留（历史对话需要它）」。
- **立下规则：任何路径都不得删除 `[model_providers.*]` 块。**

### ADR-035: 未发布的迭代不单独占版本号 —— 四版折叠为单一 3.0.0

- **日期**：2026-09-10
- **状态**：✅ 已采纳
- **决策者**：用户 + AI Agent

#### 背景
2.3.0 之后连续写了 2.4.0（模型收敛）、3.0.0（代理 → 配置工具）、3.1.0（清理）、3.1.1（合并写修复）四条更新日志，但**这四版都没有发布**——远端用户手上的仍是 2.3.0。CHANGELOG 是给**升级用户**看的，他们打开应用只会看到最上面那一条；四条并排反而制造「中间隔了好几个版本」的错觉。

#### 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| A：保留四条，`package.json` 设到 3.1.1 | 改动最小，迭代粒度细 | 用户看到 4 条从未单独发布过的记录；版本号虚增 |
| B：折叠为单一 3.0.0（**采纳**） | 与用户实际经历一致（2.3.0 → 3.0.0 一次到位）；3.0.0 是「代理工具 → 配置工具」的破坏性主版本，语义正确 | 丢失版本内部的迭代次序；需同步清理代码注释里的旧版本号 |

#### 决策
四版折叠为单一 `[3.0.0]`，CHANGELOG 只留**一条**，**从用户视角**写；删除「修复 / 隐私 / 保持不变」等对升级用户无意义的章节。

#### 理由
**更新日志的读者是升级用户，不是维护者。** 维护者要的迭代细节在 `task-history.md` 与 `decisions-log.md` 里，不该占用 CHANGELOG 的篇幅。判断一条内容该不该进更新日志，只问一句：*用户需要知道吗？知道了需要做什么吗？*

#### 影响
- `package.json` = `3.0.0`；代码内 32 处 `v3.1.1` / `v3.1.0` / `v2.4.0` 注释归一为 `v3.0.0`（纯注释，无行为变化）。
- **ADR-034 与 TASK-127 标题里的「v3.1.1」是当时的工作代号，对用户即 3.0.0** —— 标题保留不改写，历史记录以当时的代号为准。
- 立下规则：**连续未发布的迭代在发版时折叠进承载它的那个版本**；反过来，**一旦某版真的发布过，就不得再合并进后续版本**——2.3.0 及更早因此保持原样不动。

### ADR-034: v3.1.1 — `config.toml` 改为「合并写」；受管 provider 块只更新当前那家、其余保留

- **日期**：2026-09-10
- **状态**：✅ 已采纳
- **决策者**：用户 + AI Agent

#### 背景
用户报告：切换供应商后，**原供应商的历史对话全部打不开**（`Model provider deepseek not found`；切回去则报 `ZAI not found`）。

诊断（基于用户本机实证）：**Codex 是按对话记住 `model_provider` 的** —— 会话文件 `~/.codex/sessions/**/rollout-*.jsonl` 记录 `payload.model_provider`（该用户 49 个会话里 44 个是 `deepseek`）。而旧实现切换供应商时**整份覆盖** `config.toml`，只留当前那家的块 → 上一家的对话全部失效。

同时发现同源的第二个问题：写入是**替换**而非**合并**，会抹掉配置里所有非受管内容（`notify` / `[desktop]` / `[mcp_servers.*]` / `[projects.*]` / 用户自建 `[model_providers.*]`）。该用户机器上这些段之所以还在，是 **Codex Desktop 自己事后又写回去**，属运气而非设计。

#### 决策
1. **`config.toml` 的写入改为合并语义**：读出现有文件 → 只剥离「我们的顶层键 + 当前供应商的块 + `[features]` 受管键」→ 组装写回。**其余内容一律原样保留**（含其它 `[model_providers.*]`）。
2. **始终保留所有受管供应商的块**，只有顶层 `model` / `model_provider` 随切换变化。
3. **不合成其它供应商的块** —— 原样保留即可，因而**不需要它们的 Key**，也不会写出残缺块。
4. `sanitizeManagedConfig()` 增加 `stripProviderBlocks: 'all' | string[]`（传供应商 id），默认 `'all'` 保持「切换到 OpenAI 官方」的行为不变。

#### 理由
1. Codex 的会话-provider 绑定是**外部事实**，我们无法改变；唯一能做的就是**别删**provider 块。
2. 「保留」优于「重建」：重建需要拿到每家 Key，缺 Key 就是残缺配置；保留则零信息需求。
3. 整份覆盖是**静默数据丢失**，且被 Codex 的自我重写掩盖了 —— 这类 bug 不修，迟早以更贵的形式暴露。
4. 与 ADR-031/033 同一条主线：**替用户做主地整份替换/一刀切清理，必然在某处反噬**。

#### 影响
- 切换供应商后，**双方的**历史对话都能继续打开；受影响的旧对话无需任何处理。
- `config.toml` 不再被我们抹掉用户/Codex 自有内容；用户手工加的键（`sandbox_mode`、自建 provider…）得以保留。
- 写入仍需**幂等**（否则每次保存都会新增备份）—— 已加测试锁定；合并组装保证二次写入字节一致。
- 还原路径（「切换到 OpenAI 官方」）行为**未变**：仍剥离全部受管块。
- **已知残留风险（本轮有意不处理）**：`models.json` 仍只装当前供应商目录，而旧对话记录的 model 可能是另一家/已退役的 slug。判断 Codex 对未知模型是退化处理而非硬报错（用户那批 `deepseek-v4-flash` 会话在该模型退役后仍可打开即旁证），且该文件同时是 Codex 模型列表的数据源，混入别家 slug 会更乱。若后续出现「模型找不到」类错误再单独决策。

#### 替代方案
- 「写全部受管供应商的块（合成）」→ 否决：需要各家 Key，缺 Key 即残缺配置。
- 「切换时提示用户旧对话会失效」→ 否决：把我们的实现缺陷转嫁给用户，且并未解决问题。
- 「把 models.json 也改成保留全部供应商目录」→ 本轮否决：见上「已知残留风险」；属**推测性改动**，不做。

---

### ADR-033: v3.1.0 — 把测试文件纳入类型检查（`tsconfig.test.json` 接入 `typecheck`）

- **日期**：2026-09-10
- **状态**：✅ 已采纳
- **决策者**：用户 + AI Agent

#### 背景
一次全仓无用文件审计（TASK-126，用导入图可达性分析，结论是**没有无用的源码文件**）中顺带发现：`tsconfig.test.json` **存在但无任何脚本或配置引用它**。而 `pnpm typecheck` 只跑两个项目 —— `tsconfig.electron.json`（`include: electron/**`）与 `tsconfig.renderer.json`（`include: src/**`）。

**即：`tests/` 从来没有被类型检查过。** 实测运行一次就暴露 4 处前几轮重构的遗留（store 测试仍在遍历已删除的 `plugins`/`help` 页面、writer 测试仍在传已移除的 `'agnes'` 供应商、migrations mock 缺类型标注、ipc-consistency 的 Set 类型不匹配）。

#### 决策
在 `package.json` 的 `typecheck` 后追加 `&& tsc -p tsconfig.test.json --noEmit`，把测试文件纳入类型检查。

#### 理由
1. **这类假绿比编译错误危险**：那 4 处全部活过了前几轮「typecheck ✅ + 151 个测试全绿」的验证 —— 因为测试文件既不被类型检查，其断言对象又已在运行时消失，断言本身却仍然通过（例如遍历一个已不存在的页面名却断言 `page` 等于它，永远成立）。
2. **配置文件断链是隐性债务**：一个存在却无人调用的 tsconfig，看起来像「已配置」，实际是零覆盖。与 ADR-031/032 的教训同源：**断链迟早以「测试在测不存在的东西」的形式暴露**。
3. 成本近乎为零：`tsconfig.test.json` 早已写好（`include: tests/**`、`types: [node, vitest/globals]`），只是没人调用。

#### 影响
- `pnpm typecheck` 现在覆盖 `electron/` + `src/` + `tests/` 三者；CI 的 lint/typecheck 步骤随之拦住测试层的过时引用。
- 修复了 4 处遗留（其中前两处是**真实陈旧**，按当前行为改正而非仅为过编译）。
- 顺带删掉 5 个零引用导出：`IpcChannel`、`WriteOpts`、`getServerConfig`、`resetPreferences`、`updateClaudeDesktopApiKey`。
- 顺带把误提交的 Playwright 产物 `test-results/`（2 文件）移出版本控制并加入 `.gitignore`。
- **新增流程约束**：改完重构必须跑 `pnpm typecheck`（含 tests）；**删功能时必须同步搜测试**（那次 store 测试的页面遍历用例就是在删 `'plugins'` 的同一个任务里漏改的）。两条均已写入 project-memory。

#### 替代方案
- 「删掉 `tsconfig.test.json`」→ 否决：它看起来像死文件，实则是**该有的覆盖缺失了**。删掉等于把缺口永久固化。
- 「只修 4 处、不接入 typecheck」→ 否决：下次重构还会同样漏，问题只是被推迟。

---

### ADR-032: v3.1.0 — 遥测收窄为「仅配置操作 + 零个人数据」、移除插件子系统、写入路径统一「去重+修剪」

- **日期**：2026-09-10
- **状态**：✅ 已采纳
- **决策者**：用户 + AI Agent

#### 背景
v3.0.0 转型为纯配置工具后做了一次全面审计（TASK-125）。审计发现两类问题：**功能与定位不符**
（遥测仍在采集崩溃原文与设备标识符、插件子系统依赖远程服务）与**两个真实缺陷**（Claude 侧写入
不去重不修剪备份、迁移 flag 互相覆盖）。本 ADR 记录由此产生的四项决策。

#### 决策

**① 遥测收窄：只上报配置操作，去掉全部个人数据**

保留三个事件，且字段仅剩枚举与字段名：

| 事件 | 保留字段 |
|---|---|
| `config_write` | `fields_changed`（**字段名**，非值） |
| `tool_install` | `tool`（枚举） |
| `tool_install_fail` | `tool` + `error_kind`（本地归类枚举） |

**删除**：`app_start`、`error`（uncaughtException / unhandledRejection）、`update_check`、
`update_download`（插件三连随插件子系统一并消失）。

**三处隐私面必须关掉**：
1. **`error` 事件整体停发** —— 它的 `error_message` / `error_stack`（截断 500 字符）可能含
   用户家目录路径与配置内容片段，是整条遥测里最明确的泄露面。崩溃排障看本地 electron-log 即可。
2. **`tool_install_fail.error_code` 改为本地归类枚举**（`classifyWriteError()`）——
   历史上该字段曾把**完整 Anthropic API Key** 送进服务端遥测库（TASK-098），数据至今需人工清理。
   绝不再上报原始报错文本。
3. **`client_id` 不再进上报体** —— 持久设备标识符属 PIPL 下的个人信息。
   注意 `clientId` **保留在 prefs 里**（社区/邀请功能调 `/client/<id>/profile` 需要它），只是不再随遥测上报。

**② 移除插件子系统**（约 1,750 行）：它是「从我们的服务器下载 36MB/165MB 离线包 + 生成安装指令」，
与「把配置写对」正交，且**必须联网到 codex-switch.cloud 才能用**，不是纯本地功能。

**③ Claude 侧写入对齐 Codex 侧的「去重 + 修剪」不变量**：抽出 `electron/config/file-write.ts`
作为两侧共用实现。**任何绕过它直接 `fs.writeFile` 写用户配置文件的代码，都是在重新引入
「备份无限堆积」这个缺陷。**

**④ 迁移 flag 改为键级合并**（`setMigrationFlag`）：`setPreferences` 是浅合并，直接写
`{migrations: {x: true}}` 会整体替换该对象、抹掉其它 flag。

#### 理由
1. 遥测的合规风险是实打实的（项目自己的 `LEGAL-RISK-CHINA.md` 把「遥测默认开启违反知情同意」
   列为🟠高风险）：**去掉个人数据比调整默认开关更彻底**——用户没关也不会泄露。
2. 插件是这套体系里唯一「必须连我们的服务器才能用」的子系统，与「本地配置工具」的定位冲突最大。
3. 备份堆积是可验证的真实缺陷（用户机器上 415 份 `.zshrc.bak`），不是理论问题；
   两条不变量必须收敛到一处，否则必然再次漂移（这正是缺陷成因）。
4. 迁移重跑会让三条历史迁移每次启动各跑一遍，既浪费又放大缺陷 ③。

#### 影响
- **遥测口径变化**：服务端收到的数据里不再有 `client_id`，无法做设备级去重/留存分析；
  只能看事件总量与分布。若有产品侧需求，应改用**每次会话随机、不落盘**的匿名 id。
- 遥测默认值仍为**开启**（用户未要求改默认），但因上报内容已不含个人信息，opt-out 不再构成合规风险。
  `LEGAL-RISK-CHINA.md` 的对应结论随之失效，已在该文件补记。
- 设置页文案改为准确描述上报范围；CHANGELOG 单列「隐私」小节。
- 删插件后 `Page` 只剩三个页面、IPC 通道减少 7 条、preload API 减少 9 个、依赖减少 2 个
  （`@testing-library/jest-dom`、`tsx` 均为零引用）。
- 用户既有的备份文件**未自动清理**（破坏性操作不擅自执行），CHANGELOG 给出可选的手动命令。
- macOS/Windows 的 `~/.zshrc.bak.*` 从此不再增长；`maxBackupsPerFile`（默认 5）现在对
  Codex 与 Claude 两侧都生效。

#### 替代方案
- 「遥测整体删除」→ 未采纳：用户明确要保留配置操作类上报（用于判断功能是否被用上）；收窄比删除更贴合意图。
- 「遥测改为默认关闭」→ 未采纳：收窄到零个人数据后，默认开启不再有合规问题，且能保住数据连续性。
- 「保留插件但改为可选下载」→ 未采纳：它的问题不是默认开关，而是依赖远程服务这一前提。

---

### ADR-031: v3.0.0 — 转型为纯配置工具：删除本地代理、移除 Agnes、GLM 转直连、引入供应商注册表

- **日期**：2026-09-10
- **状态**：✅ 已采纳
- **决策者**：用户 + AI Agent

#### 背景
v2.0.0 起 DeepSeek 已走官方直连，本地代理（`electron/proxy/`，13 文件 3,640 行）实际只服务 Agnes/GLM。用户提供的智谱官方文档证实 **GLM 也支持 Codex 直连**（`https://open.bigmodel.cn/api/v1` + `wire_api="responses"`），于是代理的最后一个存在理由消失。用户决定：**本版本做完就不再维护代理，把这个应用彻底变成配置工具**。

用户同时指出架构上的根本问题：**配置 Codex 与配置 Claude 本是同一套机器**（往某端点写地址 + Key + 模型表），却因历史原因在 writer / desktop-writer / env-writer / secrets / migrations / Settings.tsx / ModelMappingModal 七八处各写一遍——同一份事实最多抄五遍，并已因此产生过两次漂移 bug（`ClaudeSettingsSection` vs `DEFAULT_ENV_VARS`；CLI 档位默认值三处不同步）。

#### 关键取证（未靠猜测）
比对智谱官方 Codex 模板与既有 `DEEPSEEK_DIRECT_TEMPLATE`，确认二者**同构**：

| | DeepSeek | 智谱 GLM |
|---|---|---|
| `model_provider` / 段名 | `deepseek` | `ZAI` |
| `base_url` | `https://api.deepseek.com/` | `https://open.bigmodel.cn/api/v1` |
| `model_reasoning_effort` | `high` | `max` |
| `preferred_auth_method`/`forced_login_method` | 有（官方模板要求） | 无 |
| `experimental_bearer_token` | 有 | 有 |
| `model_catalog_json` | 有 | 有 |

差异全部是**数据**，不含逻辑。这直接决定了注册表的形状。

#### 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| A. 保留代理，只加 GLM 直连 | 改动小 | 代理已无任何服务对象（Agnes 也要删），留着纯负担：3,640 行 + 端口 + 日志 + 统计 + 缓存全为空转 |
| B. 删代理但每家供应商各留一套模板/UI | 机械改动 | 重复照旧，加第 4 家供应商（Qwen）仍要改 7 处 |
| **C. 删代理 + 供应商注册表（唯一事实来源，经 IPC 下发渲染层）** | 新增供应商＝加一条数据；消除 5 份重复；配置工具的正确形态 | 一次性大改（本次 ~3,640 行删除 + 主进程/渲染层多处重写） |

#### 决策
选 **C**：
1. **删除整个本地代理**及其全部衍生功能（日志页、请求/token 统计、对话缓存、后台建议拦截、端口设置、端口冲突处理）。
2. **移除 Agnes 供应商**（不支持 Codex 的 Responses 协议）。存量用户**不做任何处理**：无迁移、无提示、不清理钥匙串条目；仅加读时 `normalizeProvider` 防崩溃。
3. **GLM 转为 Codex 直连**，模型清单按用户给的 **glm-5.3 / glm-5.3-flash / glm-5.2**。
4. **新建 `electron/config/providers.ts` 作为唯一事实来源**；因两个 tsconfig 的 `rootDir`/`include` 各自独立、无法共享模块，渲染层经**新 IPC 通道 `providers:list`** 取用 → **描述符必须保持纯数据**（有守门测试）。
5. **Key 通道对供应商泛型化**（`key:get/set/clear` + providerId），12 个 handler / 9 条常量收敛为 3 + 1。
6. **主面板只留四个工具接入状态**；**侧边栏「设置」排第一且为默认落地页**。

#### 理由
1. 官方模板同构是硬证据——重构不是审美偏好，而是消除已造成两次 bug 的结构性重复
2. 代理删除后「配置工具」的定位才自洽：不占端口、不必常驻，配置写好后各工具直连
3. 纯数据描述符 + 单条 IPC 通道，与本项目「渲染进程只通过 IPC 访问系统资源」的硬约束一致，且绕开了 tsconfig rootDir 的构建风险

#### 影响
- **被本 ADR 推翻的历史决策**（其结论仅对已删除的代理路径成立）：ADR-002（移植参考工程代理为核心）、ADR-014（代理生命周期状态机）、ADR-016（stop 主动断开连接）、ADR-019/023（compact 与对话缓存策略）、ADR-028 中「代理保留给 Agnes/GLM」的部分。ADR-001（Electron 技术栈）、ADR-006/020（Claude 配置注入方式）、ADR-029/030（模型阵容）**仍然有效**。
- **`~/.codex/models.json` 成为跨供应商共享文件** → 目录写入必须合并（见 TASK-124 注意事项 1）。
- **受管 TOML 段名由注册表派生** → 杜绝 BUG-007 复现。
- **`runV300DirectMigration`** 是本版本最有价值的迁移：GLM 用户此前正走代理，代理删掉后其 config.toml 会指向不存在的端口。
- 代理时代的 telemetry 事件（`proxy_start`/`proxy_stop`/`proxy_error`）不再产生；服务端若有基于 `proxy_error` 的告警会出现「日志静默」。存活的信号是 `config_write` / `tool_install`。
- **`lifetimeFirstStartAt` 必须保留**：名字带 lifetime 但它喂的是「早期成员」徽章，与代理无关。
- 行为变化：GLM 的 reasoning effort 由 `xhigh`（代理模板）改为 `max`（官方文档）。

#### 替代方案
- 「保留代理作为兜底」→ 否决：Agnes 一删就再无服务对象，留着的全是空转与维护面。
- 「手动维护受管段名/Key 清单」→ 否决：BUG-007 已证明手写清单必然漏，注册表派生是唯一可靠做法。
- 「为渲染层复制一份注册表」→ 否决：那正是本次要消灭的重复；改用 IPC 单向下发 + 手抄**类型**（类型漂移可由 tsc 近似兜底，数据漂移不能）。

---

### ADR-030: v2.4.0 — DeepSeek 模型阵容收敛为两个；视觉能力并入 `deepseek-flash`

- **日期**：2026-09-10
- **状态**：✅ 已采纳
- **决策者**：用户 + AI Agent

#### 背景
DeepSeek 官方公告：① 模型名改用 `deepseek-flash`，旧名 `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` 仍可调用但模型已下线，请求由 DeepSeek-V4.1-Flash 提供服务并按 Flash 计费；② V4 Pro 计划下线——北京时间 2026-09-14 12:00 后至 V4.1 Pro 上线前，`deepseek-v4-pro` 的请求全部路由到 V4.1 Flash。因此三个接入点（Codex / Claude Desktop / Claude Code CLI）的模型选择须从三个收敛为两个。**关键未知项是「视觉能力是否随 vision-exp 一并消失」**——公告未说明。

**取证方式（未靠猜测）**：本项目的 `electron/codex/deepseek-models.json` 约定「与 DeepSeek 官方 Codex 一键脚本逐字节一致」。拉取官方脚本 **v1.3.0**（`https://cdn.deepseek.com/api-docs/codex-deepseek-setup.sh`，108,855 B）并解析其内嵌 models.json，得到确定答案：

| slug | input_modalities | 图片 | priority |
|------|------------------|------|----------|
| `deepseek-flash` | `["text","image"]` | ✅ | 1 |
| `deepseek-v4-pro` | `["text"]` | ❌ | 2 |

官方目录**恰好两个**模型（脚本自带校验：「需恰好包含 deepseek-flash 与 deepseek-v4-pro 两个模型」），且官方脚本自己负责清理旧 slug（`LEGACY_SLUG_PREFIX="deepseek-v4-flash"`）。**结论：视觉能力并入 `deepseek-flash`，能力并未丢失。**

#### 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| A. 移除 vision，Codex 与 CLI 彻底失去读图 | 表面上「两个模型」最整齐 | 与官方目录事实不符——官方明确把 image 声明在 flash 上，等于主动砍掉一个已具备的能力 |
| **B. 视觉并入 `deepseek-flash`，删掉独立的 vision 模型与 `vision` prop** | 与官方目录逐字节对齐；能力零损失；CLI/Desktop 选项同一套，删掉一整条分支 | 需重命名 ~20 文件；`vision` prop 及其配套测试一并删除 |
| C. 保留 vision-exp 作为第三个遗留选项 | 改动最小 | 直接违背用户「收敛为两个」的要求，且该模型已下线 |

#### 决策
选 **B**：
1. `electron/codex/deepseek-models.json` 用官方 heredoc 逐字节替换（3 → 2 模型，76,107 B）；顺带修正仓库 pro 条目 `supports_search_tool: true` → `false`（与官方不符的陈旧值）。
2. 全面重命名（用户选定范围）：接入层 + 智能搜索 + 本地代理内部默认值/白名单 + dev 脚本 + FAQ。
3. **删除 `ModelMappingModal` 的 `vision?: boolean` prop**，`DEEPSEEK_ROLE_DEFAULT_CLI` / `_DESKTOP` 合并为单一 `DEEPSEEK_ROLE_DEFAULT`（opus→pro、sonnet/haiku→flash）。
4. **存量用户零改动**（用户拍板）：不加迁移，且**有意不 bump `CURRENT_MAPPING_VERSION`（保持 5）**。
5. 用户可见处保留过渡提示：Settings 的 Pro 选项说明、Setup 向导副标题、FAQ、CHANGELOG。**（该条已被下方「修订」部分淘汰）**

#### 理由
1. 官方目录是唯一权威来源，且本项目已有「逐字节对齐官方」的成文约定——照做即零判断风险
2. 视觉并入 Flash 后，**ADR-029 的结论失去对象**：Desktop 与 CLI 的档位选项与默认值完全相同，`vision` prop 的存在理由（为 Desktop 隐藏 vision 模型）消失，留着就是死代码
3. 不做迁移是用户的明确取舍：旧名仍可调用且按 Flash 计费，没有非改不可的理由；代价是需处理「持久化旧名不在新下拉中」的显示问题（见影响）

#### 影响
- **`CURRENT_MAPPING_VERSION` 成为易误改的陷阱**：改 `DEFAULT_MAPPING` 取值时若顺手 bump，会把新默认映射合并进存量用户配置，违背本次取舍。已在该常量上写明不变式。
- **两个 UI 收尾改动**（否则「不改存量」会变成「静默显示错乱」）：
  1. `Settings.tsx` 的 DeepSeek 下拉新增**旧值保留项**（持久化值以 `deepseek-` 开头且不在新列表时额外渲染 `<option>`），避免 `<select>` 匹配不到 option 渲染空白。
  2. `ModelMappingModal` 的 `isCustom` 由 `currentValue === '__custom__'` 改为 `!isPreset(currentValue, presets)` —— 修掉一个**既有 bug**：从持久化恢复的非预设值下拉显示「自定义…」却不渲染输入框，用户既看不到也改不了（自 v2.2.0 Desktop 隐藏 vision 起潜伏）。
- ADR-029 中「Desktop 不提供 vision」的操作性结论作废，但其技术事实（Desktop 3P gateway 只发 `claude-*` 路由名、`labelOverride` 仅显示、真实档位由 DeepSeek 服务端路由决定）**仍然成立**，已保留在 `desktop-writer.ts` 注释中。
- 代理层（自 v2.0.0 起仅服务 Agnes/GLM）内的旧名一并重命名；旧名请求走前缀→fallback 落到 `deepseek-flash`，与上游实际落点一致，无功能损失。
- 供应商差异收敛：`ClaudeSettingsSection` 的重置处理器此前与 `DEFAULT_ENV_VARS` 漂移（sonnet 仍写 pro），本次对齐。

#### 替代方案
- 「保留 `vision` prop 以免未来加回」→ 否决：YAGNI，且当前留着会误导后人以为 Desktop 真被区别对待。
- 「bump `CURRENT_MAPPING_VERSION` 让存量用户自动换新名」→ 否决：用户明确选择不碰存量数据；且旧名仍可用，强制改写用户已保存的选择属于越权。

#### 修订（2026-09-10，同日回访）—— Codex 模型选择器只显裸模型名

**用户新指令**：「codex 接入选择 deepseek 模型时，直接显示模型名称，deepseek-flash 和 deepseek-v4-pro，不写说明，也不要 deepseek-v4-flash-vision-exp」。

**淘汰本 ADR 原决策第 5 条**（「Settings 的 Pro 选项说明 + Setup 向导副标题」）与本 ADR 影响部分原先的「旧值保留项」方案：

| 项 | 原方案（同日早先） | 修订后 |
|---|---|---|
| 选项文字 | `DeepSeek Flash (deepseek-flash) · 可读图` | 裸 id：`deepseek-flash` / `deepseek-v4-pro` |
| Pro 下线提示 | 选中 pro 时在下方显示小字 `<p>` | **完全移除**（向导副标题也移除） |
| 存量旧名 | 渲染「『旧名』（旧名，仍可用）」保留项 | 加载时**折叠为 `deepseek-flash`**（`foldRetiredDeepseekModel()`，仅改显示，保存才写回） |
| 向导 `ModelOption` | 友好标题 + 副标题 | 裸 id，`subtitle` 改为可选并条件渲染 |

**修订理由**：① 用户明确要求「直接显示模型名称」——模型 id 本身就是最准确的信息，中英混排标签反而增噪；② 保留项会让下拉出现**第三个名字**（含用户明确点名的 `deepseek-v4-flash-vision-exp`），与「只要两个」冲突；折叠为 flash 后下拉恒为两项、永不空白，且不违背「不主动改存量」——存储只在用户点保存时更新。

**修订的代价（已向用户说明并获认可）**：V4 Pro 下线提示自此从**整个 Codex UI 消失**，仅存于 `docs/help/faq.json` 与 CHANGELOG `[2.4.0]`。此前「选项旁加说明」的决策被更具体的新指令覆盖。

**同一日内第二次修订 —— Claude 侧映射弹窗也折叠（用户第三次回访，附前后对比截图）**

用户看到弹窗实际渲染后反馈「原来的默认也太难看」：存量用户持久化的 `deepseek-v4-flash` 不在预设列表 → 被判为自定义值 → 渲染成 `✏️ 自定义…` + 输入框，且该输入框用 `float-right` 挤压了左侧档位标签，把「Claude Haiku 4.5」压成三行。要求改成干净的三行下拉。

**由此淘汰本 ADR 上一段「两处策略不同是有意的」的说法**——该结论在 DeepSeek 供应商下已不成立，勿再据此拒绝合并：

| 场景 | 规则 |
|---|---|
| Codex 默认模型下拉（`Settings.tsx`） | DeepSeek 旧名折叠为 `deepseek-flash` |
| Claude 映射弹窗（`ModelMappingModal`，provider==='deepseek'） | **同样折叠**——不再是「回落自定义态」 |
| `Settings.tsx` 恢复 `cliMapping` / `desktopMapping` | 供应商为 deepseek 时折叠；否则原样（避免「不打开弹窗直接点保存」把旧名又写回去） |
| glm / agnes / **custom** 供应商 | **不折叠**。custom 供应商可能合法地手填 `deepseek-*`（第三方网关也可代理该模型），折叠会吃掉用户输入 |

**新增单一事实来源 `src/lib/deepseek-models.ts`**（导出 `foldRetiredDeepseek` / `foldRetiredDeepseekMap`）：折叠规则此前在 `Settings.tsx` 与弹窗里各写一份，而本项目已出现过两次同类漂移（`ClaudeSettingsSection` vs `DEFAULT_ENV_VARS`、CLI 档位默认值三处不同步），故收敛为一份。

**顺带修掉布局 bug**：自定义输入框的 `float-right` 改为 `<div className="flex justify-end mt-1">` 包裹——float 会挤压同行档位标签导致折行（用户截图即为此现象）。

**回归测试**：`ModelMappingModal.test.tsx` 2 例锁定（DeepSeek 旧名折叠为 flash 且**无**自定义输入框 / custom 供应商的 `deepseek-v4-flash` **保持**自定义态不折叠）；`Settings.test.tsx` 3 例锁定 Codex 下拉（两个裸 id 且无说明文案 / 旧名折叠为 flash / `deepseek-v4-pro` 原样保留）。全套 **225/225 ✅**。

---

### ADR-029: v2.2.0 — Claude Desktop 不提供 DeepSeek 视觉模型（vision 仅 Codex + Claude Code CLI）

- **日期**：2026-09-07
- **状态**：✅ 已采纳
- **决策者**：用户 + AI Agent

#### 背景
用户实测把 Claude Desktop 的 Claude Sonnet 映射到 `deepseek-v4-flash-vision-exp` 后贴图报错、图片显示「Unsupported Image」。排查（本机 profile/日志 + DeepSeek 官方「图像理解」文档 + cc-switch 源码 + [anthropics/claude-code#56990](https://github.com/anthropics/claude-code/issues/56990)）确认：**Claude Desktop 3P gateway 请求 `model` 发送的是条目 `name`（必须是 claude-opus/sonnet/haiku 形状，Desktop 强校验非 Anthropic 名直接拒绝），`labelOverride` 只是模型下拉的显示名，上游看不到**。DeepSeek 按 claude-* 名做档位路由到文本档 → 图片 content 400 → 客户端降级为 `[Unsupported Image]`。DeepSeek 官方明确：Anthropic 端点发图时请求 `model` 必须**字面等于** `deepseek-v4-flash-vision-exp`（claude-* 路由不映射到它），只有能原样发 model id 的客户端（Claude Code CLI 的 env / 程序化 anthropic SDK / Codex Responses）能触达。

#### 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| A. 为 Desktop 引入本地 Anthropic 路由（claude-* 名→真实 deepseek 模型 + 转发 image block） | Desktop 真能看图；模型映射恢复真实语义 | 推翻 ADR-020「Claude 直连无代理」；DeepSeek 需常驻本地代理；改动大 |
| **B. v2.2.0 仅 Claude Code CLI 支持 vision，Desktop 移除该模型** | 诚实、改动小、不推翻架构；CLI env 路径真实有效 | Desktop 用户不能用视觉（Anthropic 客户端硬限制，官方无 GUI 通道） |

#### 决策
选 **B**：v2.2.0 只让 Claude Code CLI 支持 `deepseek-v4-flash-vision-exp`；Claude Desktop 的 DeepSeek 模型映射回 pro/flash 两档（haiku 默认 flash）。`ModelMappingModal` 加 `vision?: boolean`（默认 true=CLI 语义；Desktop 卡片传 false）。

#### 理由
1. Desktop 3P 客户端机制决定直连无法驱动第三方视觉模型（证据充分）；无本地路由时任何映射都只是显示层
2. CLI env 把 model id 原样发给 api.deepseek.com/anthropic，正中官方路径，是低成本真实收益
3. 不为单一功能引入长期代理架构负担（ADR-020 有意移除 Claude 本地转发）

#### 影响
- Claude Desktop 模型映射不含 vision。延伸事实：Desktop 上 pro/flash 的 labelOverride 映射同样**只改显示名**、不真正切换上游模型——真实模型由 DeepSeek 服务端按 claude-* 名档位路由决定（TASK-081 等历史「labelOverride 修复」语义存疑）
- 若未来要 Desktop 视觉，需重新评估「本地 Anthropic 路由（agent gateway）」方案，属新架构决策

---

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
