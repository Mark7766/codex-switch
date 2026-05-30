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
