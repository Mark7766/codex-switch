# 设计方案：Codex Switch 支持 Claude Code CLI 与 Claude Desktop

> **文档状态**：草稿 v0.3 · **日期**：2026-06-02
> **适用版本**：Codex Switch v1.3.0（规划中）
> **核心理念**：用户**只需配 DeepSeek API Key**，其余一切默认。零额外操作即可同时驱动 4 款主流 AI 工具。

---

## 一、背景与动机

Codex Switch v1.2 已经稳定支持 **Codex Desktop**（图形化用户的主力，**当前用户基数最大**）和 **Codex CLI**，通过 OpenAI Responses API → DeepSeek 转换实现。

现在很多用户同时使用 **Claude Code CLI** 和 **Claude Desktop**，希望同一个 API Key、同一个 Codex Switch 也能驱动它们。
目标用户完全不懂命令行，方案必须做到——

> **打开 Codex Switch → 填一次 DeepSeek API Key → 完成。Codex Desktop / Codex CLI / Claude Code CLI / Claude Desktop 四端全部能用。**

并且必须满足：

- 现有 v1.2.x 用户升级**无感**：原有的 Codex Desktop / Codex CLI 接入路径完全不动
- **安装顺序无关**：用户先装 Codex Switch 再装目标工具、或先装工具再装 Codex Switch，都能在合适时机自动应用配置

参考 [cc-switch](https://github.com/farion1231/cc-switch) 的接入思路，本方案在保持 Codex Switch **极简定位**下，仅新增对 Claude 两个工具的最小必要支持，并把整套配置自动化覆盖到 4 个工具。

---

## 二、关键洞察（决定了整个方案的简化方向）

### 2.1 DeepSeek 已官方支持 Anthropic 协议

DeepSeek 提供 Anthropic 兼容端点：

```
https://api.deepseek.com/anthropic
```

这意味着任何使用 Anthropic SDK 的客户端（如 **Claude Code CLI**）只需把 `ANTHROPIC_BASE_URL` 指向这个地址、`ANTHROPIC_AUTH_TOKEN` 填 DeepSeek API Key，就能**直接和 DeepSeek 对话，完全不需要本地代理**。

### 2.2 Claude Desktop 仍需本地代理（且代理逻辑可大幅简化）

Claude Desktop 的 3P 配置 (`claude_desktop_config.json`) 会校验：

- `/v1/models` 返回的模型 ID 必须形如 `claude-sonnet-*` / `claude-opus-*` / `claude-haiku-*`
- DeepSeek 的 Anthropic 端点返回的是 `deepseek-v4-pro` 等真实模型名 → Claude Desktop 拒绝识别

所以 Desktop 仍需 Codex Switch 的本地代理在中间做一件事：**模型名重写 + 透传**。
**不再需要协议格式转换**（DeepSeek 已是 Anthropic 兼容），代理逻辑因此从"复杂格式转换"降级为"轻量 reverse proxy"。

### 2.3 这个方案对用户而言意味着什么

| 工具                | 接入方式                                             | 是否经过本地代理                           | 用户感知                                      |
| ------------------- | ---------------------------------------------------- | ------------------------------------------ | --------------------------------------------- |
| **Codex Desktop**   | 写 `~/.codex/config.toml` + `auth.json`（v1.2 已有） | ✅ 是                                      | 与 v1.2 一致，**不动**                        |
| **Codex CLI**       | 写 `~/.codex/config.toml` + `auth.json`（v1.2 已有） | ✅ 是                                      | 与 v1.2 一致，**不动**                        |
| **Claude Code CLI** | 写 shell profile 环境变量                            | ❌ 否（直连 DeepSeek 官方 Anthropic 端点） | 配好 API Key 后，开新终端即可用 `claude` 命令 |
| **Claude Desktop**  | 写 `claude_desktop_config.json`                      | ✅ 是（轻量代理重写模型名）                | 配好 API Key 后，重启 Claude Desktop 即可使用 |

---

## 三、目标与非目标

### In Scope

| 目标                    | 说明                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| ✅ Claude Code CLI 接入 | 写 shell profile 环境变量，**直连** DeepSeek 官方 Anthropic 端点，不经本地代理               |
| ✅ Claude Desktop 接入  | 写 `claude_desktop_config.json`，请求经本地代理（模型名重写 + 透传到 DeepSeek `/anthropic`） |
| ✅ 零配置体验           | 用户保存 DeepSeek API Key 后，Claude 配置自动应用；无需额外点击                              |
| ✅ 复用现有端口         | 在已有 `127.0.0.1:11435` 上新增 Anthropic 路由，不引入新端口                                 |
| ✅ 配置备份与还原       | 写入前自动备份；GUI 提供"还原"按钮                                                           |
| ✅ 向后兼容             | v1.2.x 用户升级到 v1.3.0，原有 electron-store / keytar 数据无损可用                          |

### Out of Scope

| 非目标                              | 原因                          |
| ----------------------------------- | ----------------------------- |
| ❌ Gemini CLI / OpenCode 等其他工具 | 超出极简定位                  |
| ❌ 多供应商管理面板                 | cc-switch 已有，不重复造轮子  |
| ❌ Claude Desktop 的 OAuth 复用     | 超出范围                      |
| ❌ MCP / Skills / Sessions 管理     | 超出范围                      |
| ❌ Linux 平台 Claude Desktop 支持   | Claude Desktop 暂不支持 Linux |

---

## 四、技术方案

### 4.1 Claude Code CLI：直连 DeepSeek 官方端点（不走本地代理）

**用户操作（应用启动后自动完成，无需手动点击）：**

1. 用户在 Setup 向导中保存 DeepSeek API Key（已有逻辑）→ keytar
2. 主进程检测到 Claude Code CLI 已安装（`~/.claude/` 目录或 `claude` 在 PATH 中）
3. 自动从 keytar 读出 API Key，写入用户 shell profile（zsh / bash / fish）：

```sh
# --- Codex Switch: Claude Code CLI config (auto-generated, do not edit) ---
export ANTHROPIC_AUTH_TOKEN="<your DeepSeek API Key>"
export ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"
export ANTHROPIC_MODEL="deepseek-v4-pro[1m]"
export ANTHROPIC_DEFAULT_OPUS_MODEL="deepseek-v4-pro[1m]"
export ANTHROPIC_DEFAULT_SONNET_MODEL="deepseek-v4-pro[1m]"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="deepseek-v4-flash"
export CLAUDE_CODE_SUBAGENT_MODEL="deepseek-v4-flash"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1"
export CLAUDE_CODE_EFFORT_LEVEL="high"
# --- End Codex Switch ---
```

4. GUI 显示"已为 Claude Code CLI 配置完毕，请重新打开终端运行 `claude`"

**还原：** 删除 `# --- Codex Switch: Claude Code CLI config` 注释块。
**API Key 轮换：** 用户在 Settings 改 API Key 后，自动重写 profile 中的 `ANTHROPIC_AUTH_TOKEN`。

**安全考量（重要）：**

将真实 API Key 写入 shell profile 是一个**安全权衡**：

- ✅ 优点：CLI 直连 DeepSeek，无需 Codex Switch 进程常驻；零延迟、零额外故障点
- ⚠️ 缺点：Key 以明文形式落盘到 `~/.zshrc`（虽然该文件本身权限是 `0644`，但仍可被本机其他进程读取）

**缓解措施：**

- profile 文件写入后强制权限 `0600`（仅当前用户可读）
- GUI 在"应用配置"前向用户展示一次明确提示："你的 DeepSeek API Key 将以明文形式保存在 `~/.zshrc`。如果你共用此机器，请考虑只用 Claude Desktop 模式。"
- 提供"卸载 Claude Code CLI 配置"按钮（即"还原"）

### 4.2 Claude Desktop：轻量代理（模型名重写 + 透传）

代理在已有的 `127.0.0.1:11435` 上新增两个路由：

```
GET  /anthropic/v1/models      → 返回 claude-sonnet-4-5 / claude-opus-4-5 / claude-haiku-4-5
POST /anthropic/v1/messages    → 改写 model 字段后透传到 https://api.deepseek.com/anthropic/v1/messages
```

> 用 `/anthropic/v1/...` 前缀而非 `/v1/...`，避免与 Codex 已用的 `/v1/responses` 命名空间混淆。

**透传逻辑（伪代码）：**

```ts
// POST /anthropic/v1/messages
const body = await readJson(req);
const role = inferRole(body.model);            // claude-sonnet-* → "sonnet" 等
const mapping = store.get('claudeDesktopModelMap')[role];
body.model = stripCapabilitySuffix(mapping.model);   // 剥 [1m]
forwardToUpstream({
  url: 'https://api.deepseek.com/anthropic/v1/messages',
  headers: { 'x-api-key': await keytar.getPassword(...) },
  body,
  stream: true,                                // SSE 透传，不解析
});
```

**关键点：**

- 不再需要 OpenAI Chat Completions ↔ Anthropic 协议互转，代理实现量从原来的 ~600 行降至 ~150 行
- SSE 流式响应**字节级透传**，不解析、不缓冲，延迟最小
- 鉴权：客户端 (`inferenceGatewayApiKey`) 用占位符；代理用 keytar 中真实 Key 调用上游

**配置文件写入（自动）：**

| 平台    | 路径                                                              |
| ------- | ----------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json`                     |

写入内容：

```json
{
  "inferenceProvider": "gateway",
  "inferenceGatewayBaseUrl": "http://127.0.0.1:11435/anthropic",
  "inferenceGatewayAuthScheme": "bearer",
  "inferenceGatewayApiKey": "cs-internal-placeholder"
}
```

写入前先备份为 `claude_desktop_config.json.bak.<timestamp>`。

### 4.3 模型映射配置

#### Claude Code CLI（环境变量直接控制）

模型由 shell profile 中的环境变量决定，默认值如 §4.1。
用户可在 GUI 中修改这些默认值（写入 electron-store，应用配置时套用到 profile）。

| 环境变量                                   | 默认值                | 说明                           |
| ------------------------------------------ | --------------------- | ------------------------------ |
| `ANTHROPIC_MODEL`                          | `deepseek-v4-pro[1m]` | 交互式默认                     |
| `ANTHROPIC_DEFAULT_SONNET_MODEL`           | `deepseek-v4-pro[1m]` | Sonnet 角色                    |
| `ANTHROPIC_DEFAULT_OPUS_MODEL`             | `deepseek-v4-pro[1m]` | Opus 角色（复杂任务）          |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL`            | `deepseek-v4-flash`   | Haiku 角色（轻量）             |
| `CLAUDE_CODE_SUBAGENT_MODEL`               | `deepseek-v4-flash`   | 子任务并发 agent               |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | `1`                   | 禁用非必要遥测，减少不必要请求 |
| `CLAUDE_CODE_EFFORT_LEVEL`                 | `high`                | 推理努力度                     |

> `[1m]` 是 Claude Code SDK 识别的能力标注（声明 1M 上下文）。**直连场景下由 DeepSeek 端点处理**，Codex Switch 不参与。

#### Claude Desktop（代理内部映射）

```jsonc
{
  "claudeDesktopModelMap": {
    "sonnet": { "model": "deepseek-v4-pro", "supports1m": true },
    "opus": { "model": "deepseek-v4-pro", "supports1m": true },
    "haiku": { "model": "deepseek-v4-flash", "supports1m": false },
  },
}
```

代理在 `GET /anthropic/v1/models` 中根据此表生成虚拟 Claude 模型列表（含 `context_window` 字段），
在 `POST /anthropic/v1/messages` 中根据请求的 Claude 角色名查表替换为真实 DeepSeek 模型名。

---

## 五、零配置体验（关键 UX 设计）

> "开发完成后，用户什么都没改变，就同时支持了 Claude Code CLI 和 Claude Desktop。"

### 5.1 自动应用流程

```
首次启动 / Setup 向导
        │
        │  用户输入 DeepSeek API Key → 保存到 keytar
        ▼
主进程 onApiKeySaved 钩子
        │
        ├─ 检测到 Claude Code CLI 存在？
        │      └─ 是 → 自动写 shell profile（带真实 Key）
        │      └─ 否 → 跳过（GUI 显示"未检测到"）
        │
        ├─ 检测到 Claude Desktop 安装？
        │      └─ 是 → 自动写 claude_desktop_config.json（占位符 Key）
        │      └─ 否 → 跳过
        │
        └─ 启动本地代理（已有逻辑，不变）
                现在同时为 Codex 和 Claude Desktop 服务
```

### 5.2 GUI 简化

旧方案要求用户在 Settings 中分别"应用配置 / 还原"。**新方案改为**：

- **Dashboard 主面板**：除"代理状态"卡片外，新增**四个状态卡片**，分别显示 Codex Desktop / Codex CLI / Claude Code CLI / Claude Desktop 的接入状态（绿色=已配置且可用；灰色=未检测到该工具；红色=有问题）
- 每个卡片右上角一个齿轮图标 → 进入该工具的高级设置（修改模型映射、查看路径、还原）
- **没有"应用配置"按钮**——配置在保存 API Key 时就自动完成；在检测到新工具安装时也会自动完成（详 §5.4）

### 5.3 用户故事

```
故事 A：全新用户（Codex Switch 先装）
1. 下载 Codex Switch.dmg → 拖入 Applications → 打开
2. 向导：填 DeepSeek API Key → 下一步 → 完成
3. Dashboard 显示：Codex Desktop / CLI / Claude Code CLI / Claude Desktop 的检测状态
4. 以后装任何一个工具，Codex Switch 都会自动补上配置（详 §5.4）

故事 B：Codex Desktop 老用户装上 Claude
1. 代理一直在跑，Codex Desktop 已用 v1.2 二零十五周
2. 某天装了 Claude Desktop、拉起一次就退出
3. 下次打开 Codex Switch（或点托盘图标）时，Codex Switch 检测到 Claude Desktop 已装
   → 弹 toast："检测到 Claude Desktop，已为你自动配好。重启 Claude Desktop 即可使用。"
4. Dashboard 对应卡片从灰转绿 ✅

故事 C：v1.2 老用户升级
1. 在 Codex Switch 内点击"检查更新" → 升级到 v1.3.0
2. 启动后，应用读取已存在的 keytar API Key + 原 Codex 配置
3. 自动检测 4 个工具；Claude Code CLI / Desktop 装了就自动写配置
4. 原有 Codex Desktop 接入**完全不动**，现有会话不受影响 ✅
```

### 5.4 安装顺序无关性（关键）

4 个目标工具（Codex Desktop / Codex CLI / Claude Code CLI / Claude Desktop）与 Codex Switch 本身的安装顺序任意，均能自动适应。

#### 4 种典型场景

| 场景  | 安装顺序                         | Codex Switch 的处理                                                                |
| ----- | -------------------------------- | ---------------------------------------------------------------------------------- |
| **A** | 先装目标工具 → 后装 Codex Switch | Codex Switch 首次启动 → 完成 Setup 向导存 API Key → 扫描到工具存在 → 自动应用配置  |
| **B** | 先装 Codex Switch → 后装目标工具 | 启动时未检测到则记为"未安装"；在**下述触发点**重扫，一旦发现工具出现即自动应用配置 |
| **C** | 同时装、顺序不确定               | 同场景 A 逻辑处理                                                                  |
| **D** | 装了又卸载某工具                 | 下一次扫描发现工具消失 → 卡片从绿转灰；不主动清理已写入的配置（用户可能重装）      |

#### 重扫描触发点

为了覆盖场景 B（先装 Codex Switch，之后随时可能装工具），以下时机会重新扫描并补上配置：

1. **应用启动** — `app.whenReady()` 后扫一次
2. **窗口获得焦点** — `BrowserWindow.on('focus')` 节流 60s
3. **点击托盘图标** — `Tray.on('click')`
4. **Dashboard “刷新”按钮** — 手动触发
5. **废弃**：文件系统 watcher（在 `/Applications`、`~/.codex`、`~/.claude` 上设 `fs.watch`）——**不采用**，多平台补丁多、容易出错；上面 4 个触发点已足够覆盖 99% 场景

#### 检测逻辑总览

```
electron/claude/detect.ts 与 electron/codex/detect.ts 提供统一接口：

detectAll() 返回 {
  codexDesktop: { installed: bool, version?: string, configPath?: string },
  codexCli:     { installed: bool, version?: string, configPath?: string },
  claudeCli:    { installed: bool, version?: string, profilePath?: string },
  claudeDesktop:{ installed: bool, version?: string, configPath?: string }
}
```

检测依据（仅举 Claude，Codex 已有）：

- **Claude Code CLI**：`which claude` 成功 或 `~/.claude/` 目录存在
- **Claude Desktop**：macOS 检测 `/Applications/Claude.app`；Windows 检测 `%LOCALAPPDATA%\Programs\Claude\Claude.exe`

扫描后与 store 中上次状态 diff：

- `installed: false → true`：自动写配置 + 弹一次 toast
- `installed: true → false`：仅更新卡片状态，不动配置文件（用户可能重装）

#### Codex Switch 未启动时的补丁

场景 B 下，用户装 Codex Desktop / Claude Desktop 后可能不会立刻打开 Codex Switch。
解决：

- **默认开启开机自启**（`app.setLoginItemSettings`）——Codex Switch 启动后隐藏到托盘，占用极低
- 这样任何新装的目标工具都会在用户下次重启后被扫到并自动接入
- 首次安装 Codex Switch 时 Setup 向导勾选该选项（默认勾上，可取消）

### 5.5 Settings / Logs / Help 的变更

v1.2 的 Settings / Logs / Help 结构保留，仅做**向后兼容式的扩展**：原页面、原路径、原术语不改，只加东西。

#### Settings 页

原有分区（保留）：

- **常规**：语言、主题、开机自启
- **代理**：端口、日志级别
- **API Key**：DeepSeek API Key（keytar）
- **Codex**：Codex 模型映射、配置路径、一键还原

新增分区：

- **Claude Code CLI**：Shell profile 路径、环境变量默认值、“卸载 Claude 配置”按钮
- **Claude Desktop**：模型映射表（sonnet/opus/haiku → deepseek-v4-pro/flash + supports1m）、配置文件路径、“还原备份”按钮

底部新增一个**“一键卸载所有 Codex Switch 写入的配置”**——该按钮一次性清理：Codex 配置还原、Claude profile 注释块删除、Claude Desktop config 还原。方便用户完全退出。

#### Logs 页

原有能力（保留）：代理请求/响应日志（脱敏 Authorization）、按级别过滤、查看 `electron-log` 文件。

新增内容：

- **请求来源标签**：每条请求日志额外打一个源标签——`Codex` / `Claude Desktop`（根据请求 path：`/v1/responses` vs `/anthropic/v1/messages`）。
  > Claude Code CLI 直连 DeepSeek，**不走本地代理也不进入本地日志**。Logs 页顶部增加一句说明，避免用户误以为“Claude CLI 调用为什么不出现”。
- **Filter** 下拉增加 `全部 / Codex / Claude Desktop` 三个选项
- **模型名**作为额外列显示（重写后的真实上游模型名）
- 脱敏规则扩展：`x-api-key` / `Authorization` / `ANTHROPIC_AUTH_TOKEN` 都隐去后段、在 UI 中以 `sk-***末6位` 呈现

#### Help 页

原有能力（保留）：FAQ、社区链接、版本/许可证。

新增内容：

- **上手指南**补充 Claude Code CLI 、Claude Desktop 各一段图文（“如何验证接入成功”）
- **FAQ 新条目**：
  - “为什么 Claude Code CLI 不需要 Codex Switch 运行？”
  - “为什么 Claude Desktop 需要？”
  - “我先装了 Codex Switch，后装了 Claude Desktop，该怎么让它生效？” → 答案指向 §5.4
  - “Claude 发起请求但 Logs 里没记录” → 说明 CLI 直连
  - “如何完全退出 Codex Switch” → 指向 Settings 底部“一键卸载”按钮
- **诊断报告**：一键导出包含 4 个工具检测状态 + 最近日志（脱敏），方便设计 issue 时提交

---

## 六、向后兼容（v1.2.x → v1.3.0）

### 6.1 数据兼容性

| 数据项                                  | v1.2.x 位置                       | v1.3.0 处理                    |
| --------------------------------------- | --------------------------------- | ------------------------------ |
| DeepSeek API Key                        | keytar (`codex-switch/deepseek`)  | **不变**，复用同一条目         |
| 用户偏好（端口、Codex 模型映射）        | electron-store `preferences.json` | **不变**，schema 仅做 **追加** |
| Codex 配置文件 (`~/.codex/*`)           | 已有备份机制                      | **不变**                       |
| 反向代理对话历史（`conversationStore`） | 内存                              | **不变**                       |

### 6.2 store schema 演进（仅追加，不改不删）

```jsonc
// v1.2.x 已有字段（保持不变）
{
  "proxyPort": 11435,
  "codexModelMap": { ... },
  "logLevel": "info"
}

// v1.3.0 新增字段（缺省时使用默认值）
{
  // ... 上面的全部保留
  "claudeCli": {
    "enabled": true,                    // 默认开启自动配置
    "envVars": { ... 见 §4.3 }
  },
  "claudeDesktop": {
    "enabled": true,
    "modelMap": { ... 见 §4.3 }
  }
}
```

读取时一律 `store.get('claudeCli', defaultClaudeCli)`，缺失字段走默认值，旧用户**升级后无需任何操作**。

### 6.3 升级时的一次性迁移

启动时检查：

```ts
const migrated = store.get('migrations', { v130_claude: false });
if (!migrated.v130_claude) {
  // 检测 Claude Code CLI / Claude Desktop 是否已装
  // 已装则自动写配置文件（前提：keytar 中已有 API Key）
  store.set('migrations.v130_claude', true);
}
```

升级用户首次启动 v1.3.0 后会看到一次性 toast："Claude 接入已就绪 🎉"。

### 6.4 降级保护（用户回退到 v1.2.x）

- v1.2.x 不识别 `claudeCli` / `claudeDesktop` 字段，但 electron-store 保留它们不会出错
- v1.3.0 写入的 `claude_desktop_config.json` 和 shell profile 注释块**降级后仍然有效**（CLI 直连不依赖 Codex Switch；Desktop 配置在代理停止后失效，用户可在 Claude Desktop 内切回 Official Login）
- 提供"卸载 Claude 配置"按钮，干净移除所有改动

---

## 七、原方案中不合理 / 不友好之处的修订

下表列出 v0.1 草案中的问题与本次（v0.2）的修订：

| 问题                             | v0.1 草案                                          | v0.2 修订                                                                    |
| -------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| 对 CLI 也走本地代理              | 设计了 Anthropic ↔ Chat Completions 的复杂双向转换 | CLI 直连 DeepSeek 官方 Anthropic 端点，零代理                                |
| 代理逻辑过重                     | 需实现完整的 Anthropic Messages API server         | 退化为模型名重写 + SSE 透传，代码量降低 ~75%                                 |
| 用户必须点击"应用配置"           | Settings 中两个独立按钮                            | API Key 一存即自动应用，零点击                                               |
| 把 Claude 接入埋在 Settings 深处 | 看不到状态，要去 Settings 找                       | 提到 Dashboard 主面板做状态卡片                                              |
| 没说清 v1.2 用户升级路径         | 仅"v1.3.0 实现本方案"                              | 新增第六章详述 schema 兼容、迁移、降级                                       |
| 端口前缀冲突风险                 | 直接占用 `/v1/messages`                            | 改为 `/anthropic/v1/messages`，与 `/v1/responses` 命名空间隔离               |
| Linux 没说怎么处理               | 仅说"不支持 Desktop"                               | 明确：Linux 上 Claude Code CLI 同样支持（写 `~/.bashrc`），仅 Desktop 不可用 |
| 没提工具卸载/还原                | 只有"还原"模糊概念                                 | "卸载 Claude 配置"一键清理：删 profile 注释块 + 还原 desktop config          |
| 安全说明不足                     | 一句话带过                                         | §4.1 详述明文 Key 落盘的权衡 + 缓解措施                                      |
| 不必要遥测开销                   | 未涉及                                             | 默认设置 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`，减少非必要外联        |

---

## 八、新增/变更文件清单

```
electron/
├── proxy/
│   ├── anthropic-relay.ts     [新增] Claude Desktop 用：模型名重写 + SSE 透传（~150 行）
│   └── server.ts              [修改] 注册 GET /anthropic/v1/models、POST /anthropic/v1/messages
├── claude/                    [新增目录]
│   ├── detect.ts              [新增] 检测 Claude Code CLI / Claude Desktop 是否安装
│   ├── paths.ts               [新增] 跨平台配置文件路径
│   ├── env-writer.ts          [新增] 写/还原 shell profile（zsh/bash/fish + Windows setx）
│   └── desktop-writer.ts      [新增] 写/备份/还原 claude_desktop_config.json
├── config/
│   ├── store.ts               [修改] 新增 claudeCli / claudeDesktop 字段（带默认值）
│   └── migrations.ts          [新增] v130_claude 一次性迁移
└── ipc/
    └── channels.ts            [修改] 新增 claude:status / claude:reapply / claude:uninstall

src/
├── pages/
│   └── Dashboard.tsx          [修改] 新增 Claude Code CLI / Claude Desktop 状态卡片
├── pages/
│   └── Settings.tsx           [修改] 新增"Claude 高级设置"页（修改模型映射、查看路径、卸载）

tests/unit/
├── anthropic-relay.test.ts    [新增] 模型名重写、SSE 透传单元测试
├── env-writer.test.ts         [新增] profile 注释块写入/解析/还原幂等性
└── desktop-writer.test.ts     [新增] config.json 写入/备份/还原
```

---

## 九、Dashboard 主面板原型

```
┌──────────────────── Codex Switch ────────────────────────┐
│                                                          │
│  代理状态：✅ 运行中  127.0.0.1:11435   [刷新检测]        │
│                                                          │
│  ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐            │
│  │ Codex │  │ Codex │  │Claude │  │Claude │            │
│  │Desktop│  │  CLI  │  │ Code  │  │Desktp │            │
│  │       │  │       │  │  CLI  │  │       │            │
│  │✅ 就绪│  │✅ 就绪│  │✅ 就绪│  │⬜ 未装│            │
│  │  ⚙   │  │  ⚙   │  │  ⚙   │  │       │            │
│  └───────┘  └───────┘  └───────┘  └───────┘            │
│                                                          │
│  [  停止代理  ]  [  打开日志  ]  [  设置  ]              │
└──────────────────────────────────────────────────────────┘
```

卡片状态说明：

- 绿色 `✅ 就绪` — 工具已装、配置已应用、代理运行中（Codex/Claude Desktop）或不需代理（Claude CLI）
- 灰色 `⬜ 未装` — 未检测到该工具；点击卡片弹出"如何安装"说明（不主动下载）
- 红色 `⚠ 修复` — 例如端口变更导致 desktop config 不一致、profile 被人为篡改、代理未运行；点击一键修复

---

## 十、数据流总图

```
┌────────────────────────────────────────────────────────────────────┐
│                Codex Switch（Electron 主进程）                       │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │      DeepSeekProxy（127.0.0.1:11435）                       │   │
│  │                                                            │   │
│  │  现有路由（不变）：                                          │   │
│  │  ├─ POST /v1/responses  ←── Codex CLI / Codex Desktop      │   │
│  │  └─ WebSocket           ←── Codex CLI v0.132+              │   │
│  │                                                            │   │
│  │  新增路由（v1.3.0）：                                        │   │
│  │  ├─ GET  /anthropic/v1/models    ←── Claude Desktop        │   │
│  │  └─ POST /anthropic/v1/messages  ←── Claude Desktop        │   │
│  │            │ ① 模型名重写：claude-sonnet-* → deepseek-v4-pro│   │
│  │            │ ② SSE 字节级透传                               │   │
│  │            ▼                                                │   │
│  │     https://api.deepseek.com/anthropic/v1/messages         │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  Claude 配置注入（API Key 保存时自动触发）：                          │
│  ├─ env-writer.ts     → ~/.zshrc / ~/.bashrc / Win 用户环境变量      │
│  └─ desktop-writer.ts → ~/Library/Application Support/Claude/...   │
└────────────────────────────────────────────────────────────────────┘

请求路径：

Claude Code CLI ──→ https://api.deepseek.com/anthropic   (直连，绕过 Codex Switch)

Claude Desktop  ──→ 127.0.0.1:11435/anthropic/...
                     │ (模型名重写 + 透传)
                     ▼
                    https://api.deepseek.com/anthropic

Codex CLI/Desktop ──→ 127.0.0.1:11435/v1/responses
                       │ (Responses ↔ Chat Completions 转换，已有逻辑)
                       ▼
                      https://api.deepseek.com
```

---

## 十一、关键约束

### 11.1 Claude Code CLI 不依赖代理常驻

由于 CLI 直连 DeepSeek，用户**关闭 Codex Switch 后 Claude Code CLI 仍可工作**。
代价：API Key 必须以明文形式存于 shell profile（详见 §4.1 安全考量）。

### 11.2 Claude Desktop 必须保持 Codex Switch 运行

代理是必需中间层，关闭 Codex Switch 后 Claude Desktop 请求会失败。
GUI 应在代理停止时**通过托盘图标变红 + Notification** 警告。

### 11.3 端口变化的连锁反应

若端口从 11435 变为 11436（端口占用自动 +1），仅影响 Claude Desktop（CLI 直连无关）。
启动时检查 `claude_desktop_config.json` 中的 URL 与当前端口是否一致；不一致则自动重写。

### 11.4 Windows 环境变量

Windows 无统一 shell profile。Claude Code CLI 在 Windows 上通过用户级环境变量生效：

- 通过 `setx` 写入 9 个变量（一次性，提示用户重启终端）
- 不支持 `0600` 等 POSIX 权限；GUI 应明确告知 Windows 上 API Key 写入用户环境变量是更宽松的存储

### 11.5 Claude Desktop 版本要求

`inferenceProvider: "gateway"` 需要 Claude Desktop v0.10+ ，旧版用户需先升级 Claude Desktop。

---

## 十二、实施步骤（按优先级）

| #   | 内容                                                       | 优先级 |
| --- | ---------------------------------------------------------- | ------ |
| 1   | `electron/claude/detect.ts` + `paths.ts`                   | 🔴 P0  |
| 2   | `env-writer.ts`（macOS/Linux profile + Windows setx）      | 🔴 P0  |
| 3   | `desktop-writer.ts`（写/备份/还原）                        | 🔴 P0  |
| 4   | `proxy/anthropic-relay.ts` + 在 `server.ts` 注册路由       | 🔴 P0  |
| 5   | `config/store.ts` schema 追加 + `migrations.ts`            | 🔴 P0  |
| 6   | API Key 保存钩子：触发自动应用                             | 🔴 P0  |
| 7   | Dashboard 三卡片 UI + 状态轮询                             | 🔴 P0  |
| 8   | Settings 高级设置页（修改模型映射、卸载）                  | 🟡 P1  |
| 9   | 端口变化自动修复 desktop config URL                        | 🟡 P1  |
| 10  | 单元测试 + Playwright E2E（向导→检测→自动应用→显示绿卡片） | 🟡 P1  |
| 11  | 文档：用户手册更新 Claude 章节                             | 🟢 P2  |

---

## 十三、与 cc-switch 的对比

| 维度            | cc-switch                          | Codex Switch v1.3.0                |
| --------------- | ---------------------------------- | ---------------------------------- |
| 定位            | 多工具多供应商管理平台             | 单供应商（DeepSeek）零配置体验     |
| Claude Code CLI | 通过本地网关                       | **直连 DeepSeek 官方端点（更轻）** |
| Claude Desktop  | 多模式（Direct + Mapping）+ 多协议 | 单一模式（轻量代理 + 模型名重写）  |
| 代理端口        | 独立 15721                         | 复用 11435                         |
| 配置数据库      | SQLite + atomic writes             | electron-store JSON（足够小）      |
| 用户配置项      | 50+ 供应商，每个多种模式           | 仅 1 个 API Key，其余默认          |
| 技术栈          | Tauri + Rust                       | Electron + Node                    |

---

## 十四、版本规划

- **v1.3.0**：交付本方案全部 P0 + P1 项；用户只需配 API Key 即可同时驱动 Codex / Claude Code CLI / Claude Desktop
- 后续可考虑：支持 OpenAI 兼容供应商扩展（需新增供应商配置）

---

_v0.3 修订要点：强调 Codex Desktop 主力地位与 "不动存量" 原则；新增安装顺序无关性设计（§5.4）；补齐 Settings / Logs / Help 的变更说明（§5.5）。_
