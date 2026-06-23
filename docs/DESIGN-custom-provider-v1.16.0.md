# DESIGN: 自定义供应商（替代 PackyCode）— v1.16.0

> **日期**：2026-06-24
> **状态**：方案设计（待 review）
> **决策者**：用户 + AI Agent

---

## 1. 背景

v1.15.0 引入了 PackyCode 作为供应商，其 Base URL 硬编码在代码中。现在需要：

1. **不能直接以 "PackyCode" 名称出现** → 改为中性名称 "自定义"
2. **Base URL 不能预置** → 用户自己填两个 URL（Codex 和 Claude 各一个），适配任意兼容的第三方 API
3. **接入逻辑适配未知 Base URL** → 通过 provider 类型 `'custom'` 作为标识，决定使用用户填的 URL 而非硬编码值

---

## 2. 方案设计

### 2.1 一句话总结

**把 PackyCode 重命名为"自定义"，用户自己填 `codexBaseUrl` 和 `claudeBaseUrl`。存量 PackyCode 用户不做 URL 迁移，和新用户一样手动填写。**

### 2.2 核心变更

```
旧: provider = 'packycode'  →  代码中硬编码 www.packyapi.com
新: provider = 'custom'     →  读取用户填的 customProvider.codexBaseUrl / customProvider.claudeBaseUrl
```

#### Provider 类型

```
旧: 'deepseek' | 'agnes' | 'glm' | 'packycode'
新: 'deepseek' | 'agnes' | 'glm' | 'custom'
```

#### 新增配置字段（store.ts）

```typescript
/** v1.16.0: 自定义供应商配置 */
customProvider: {
  /** Codex 接入：OpenAI Responses API 兼容端点 Base URL。
   *  写入 config.toml 的 [model_providers.custom].base_url。
   *  例如 "https://api.example.com/v1" */
  codexBaseUrl: string;

  /** Claude 工具接入：Anthropic Messages API 兼容端点 Base URL。
   *  写入 Claude Desktop 3P profile 的 inferenceGatewayBaseUrl
   *  和 Claude Code CLI 的 ANTHROPIC_BASE_URL。
   *  例如 "https://api.example.com" */
  claudeBaseUrl: string;
}
```

> 两个 URL 各自独立。Codex URL 通常带 `/v1` 后缀，Claude URL 不带。用户根据 API 服务商文档自行填写。

#### Key 存储（secrets.ts）

```typescript
// 旧: packycodeApiKey / getPackyCodeKey / setPackyCodeKey / clearPackyCodeKey
// 新: customApiKey      / getCustomKey     / setCustomKey     / clearCustomKey
```

### 2.3 "特定标识"：`provider === 'custom'`

判断逻辑就是看 provider 类型：

```
如果 provider === 'custom':
  → Codex Base URL 从 customProvider.codexBaseUrl 读取
  → Claude Base URL 从 customProvider.claudeBaseUrl 读取
  → 直连模式，不经过本地代理
否则（deepseek/agnes/glm）:
  → Base URL 用各供应商已定义的硬编码值
```

### 2.4 各配置文件的 URL 来源

| 配置文件                                              | 当前 PackyCode 硬编码         | v1.16.0 改为                   |
| ----------------------------------------------------- | ----------------------------- | ------------------------------ |
| Codex `config.toml` → `base_url`                      | `https://www.packyapi.com/v1` | `customProvider.codexBaseUrl`  |
| Claude Desktop 3P profile → `inferenceGatewayBaseUrl` | `https://www.packyapi.com`    | `customProvider.claudeBaseUrl` |
| Claude CLI `ANTHROPIC_BASE_URL`                       | `https://www.packyapi.com`    | `customProvider.claudeBaseUrl` |

> 不再做 `{url}/v1` 字符串拼接。两个字段各自独立，用户填什么就写什么。

### 2.5 代理启动逻辑

和当前 PackyCode 逻辑一样，只是把 `'packycode'` 换成 `'custom'`：

```
ensureProxy():
  codexNeedsProxy   = provider !== 'custom'   // custom 直连
  desktopNeedsProxy = claudeDesktopProvider === 'agnes'
  cliNeedsProxy     = claudeCliProvider === 'agnes'

  如果三个都不需要代理 → throw NO_PROXY_NEEDED
```

### 2.6 模型映射 —— 不改

Codex 卡片默认模型下拉、ModelMappingModal 的 Claude 模型列表**全部保持不变**。具体来说：

- **Codex 卡片**：选 custom 时模型下拉还是当前 PackyCode 那 5 个（gpt-5.5 / gpt-5.4 / gpt-5.4-high / gpt-5.4-mini / codex-auto-review）+ 自定义输入
- **Claude Desktop/CLI 模型映射弹窗**：选 custom 时还是当前 PackyCode 那 7 个 Claude 模型（opus-4-8/4-7/4-6/4-5 + sonnet-4-6/4-5 + haiku-4-5）+ 自定义输入
- **env-writer.ts 默认模型名**：还是透传 Claude 原生名（`claude-sonnet-4-6` 等），和 PackyCode 一致

> 用户说不用改模型映射，那就不动。只是供应商下拉选项从 `PackyCode · 直连` 变成 `自定义 · 直连`。

---

## 3. 变更清单

### 3.1 类型 + 数据层（4 文件）

| 文件                         | 变更                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `electron/config/store.ts`   | `'packycode'` → `'custom'`（4 处类型联合）；新增 `customProvider: { codexBaseUrl: '', claudeBaseUrl: '' }` 字段                           |
| `electron/config/secrets.ts` | `packycodeApiKey` → `customApiKey`（keytar account 重命名 + fallback key 重命名）；`getPackyCodeKey/set/clear` → `getCustomKey/set/clear` |
| `electron/ipc/channels.ts`   | `packycodeKeyGet/Set/Clear` → `customKeyGet/Set/Clear`（3 行）                                                                            |
| `src/types/global.d.ts`      | provider 类型 `'packycode'` → `'custom'`（4 处）；PackyCode Key API 类型 → Custom Key API 类型；新增 `CustomProviderConfig` 类型          |

### 3.2 配置生成层（3 文件）

| 文件                                | 变更                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `electron/codex/writer.ts`          | `PACKYCODE_TEMPLATE` → `CUSTOM_TEMPLATE`；模板中 `base_url = "https://www.packyapi.com/v1"` → `base_url = customProvider.codexBaseUrl`；`name = "PackyCode"` → `name = "自定义"`；不再拼接 `/v1`                                     |
| `electron/claude/desktop-writer.ts` | `buildGatewayProfile` 中 `isPackyCode` → `isCustom`；`baseUrl = 'https://www.packyapi.com'` → `baseUrl = prefs.customProvider.claudeBaseUrl`；labelOverride 默认值保持不变（Claude 原生名）                                          |
| `electron/claude/env-writer.ts`     | `PACKYCODE_ENV_VARS` → `CUSTOM_ENV_VARS`（值不变，只改名）；`writeClaudeCliConfig` 中 `'https://www.packyapi.com'` → `prefs.customProvider.claudeBaseUrl`；`resolveEnvVars` / `inferProviderFromModel` 中 `'packycode'` → `'custom'` |

### 3.3 主进程逻辑（3 文件）

| 文件                            | 变更                                                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `electron/main.ts`              | 全局替换 `'packycode'` → `'custom'`（~15 处）；`getPackyCodeKey` → `getCustomKey`；`ensureProxy` 条件 `!== 'packycode'` → `!== 'custom'`；`claudeApplyAll` 中 PackyCode Key 加载 → Custom Key 加载；搜索提示词改写 |
| `electron/config/migrations.ts` | `startupApplyClaude` 中 `cp === 'packycode'` → `cp === 'custom'`；`getPackyCodeKey()` → `getCustomKey()`。**不新增 v1.16.0 迁移函数**                                                                              |
| `electron/preload.ts`           | `getPackyCodeKey/set/clear` → `getCustomKey/set/clear`（3 处 API 暴露）                                                                                                                                            |

### 3.4 代理层（3 文件）

| 文件                             | 变更                                                         |
| -------------------------------- | ------------------------------------------------------------ |
| `electron/proxy/server.ts`       | `activeModelMapping` 类型 `'packycode'` → `'custom'`（1 行） |
| `electron/proxy/http-handler.ts` | 同上（1 行）                                                 |
| `electron/proxy/ws-handler.ts`   | 同上（1 行）                                                 |

### 3.5 前端 UI（3 文件）

| 文件                                   | 变更                                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pages/Settings.tsx`               | ① `'packycode'` → `'custom'`（全局替换 ~30 处）；② 4 个下拉中 `<option value="packycode">PackyCode · 直连</option>` → `<option value="custom">自定义 · 直连</option>`；③ 供应商设置 Section：选中 custom 时增加 **两个 URL 输入框**：Codex Base URL（标注 `/v1` 后缀示例）+ Claude Base URL；④ 模型列表不变 |
| `src/components/ModelMappingModal.tsx` | `'packycode'` → `'custom'`（3 处类型标注）；7 个 Claude 模型列表保持不变                                                                                                                                                                                                                                    |
| `src/pages/Dashboard.tsx`              | "所有工具直接连接 PackyCode" → "所有工具直连模式，不经过本地代理"                                                                                                                                                                                                                                           |

---

## 4. 存量 PackyCode 用户处理

### 4.1 不做 URL 迁移

**存量 PackyCode 用户和新用户一样，需要手动填写 `codexBaseUrl` 和 `claudeBaseUrl`。**

升级后的处理：

```typescript
// v1.16.0 启动时：仅重命名 provider 类型，不预填 URL
if (prefs.provider === 'packycode') prefs.provider = 'custom';
if (prefs.claudeDesktopProvider === 'packycode') prefs.claudeDesktopProvider = 'custom';
if (prefs.claudeCliProvider === 'packycode') prefs.claudeCliProvider = 'custom';
```

### 4.2 存量用户体验

1. 升级到 v1.16.0 后打开设置
2. 下拉选项中不再有 `PackyCode · 直连`，变成 `自定义 · 直连`
3. Base URL 输入框为**空**，需要用户自己填写
4. API Key **不丢**（keytar 中的 `packycodeApiKey` 重命名为 `customApiKey`，值不变）
5. 打开设置时若 provider 为 `custom` 且 URL 为空，显示提示 toast："请填写自定义供应商的 Base URL"

### 4.3 理由

> 不预填 `www.packyapi.com` 是因为：选择什么供应商完全由用户自主决定。Codex Switch 不预设任何特定服务的 URL。

---

## 5. Settings UI 草图

```
┌─────────────────────────────────────────────────────────────┐
│ 🔑 供应商设置                                                 │
│                                                              │
│ 选择供应商  [自定义 · 直连 ▾]                                  │
│                                                              │
│ ───────────────────────────────────────                      │
│ Codex Base URL（OpenAI Responses API 兼容端点）:               │
│ ┌──────────────────────────────────────────────────────┐     │
│ │ https://api.example.com/v1                           │     │
│ └──────────────────────────────────────────────────────┘     │
│                                                              │
│ Claude Base URL（Anthropic Messages API 兼容端点）:            │
│ ┌──────────────────────────────────────────────────────┐     │
│ │ https://api.example.com                              │     │
│ └──────────────────────────────────────────────────────┘     │
│ 说明: 两个 URL 各自独立，请参考你的 API 服务商文档               │
│                                                              │
│ Custom Key：***已设置***                                       │
│ ┌──────────────────────────────────────┬──────┐              │
│ │ 新的 API Key                         │ 保存 │              │
│ └──────────────────────────────────────┴──────┘              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 📟 Codex 接入 · 自定义                                         │
│                                                              │
│ 供应商  [自定义 · 直连 ▾]                                       │
│ 本地端口 [11435]                                               │
│ 默认模型 [GPT-5.5 ▾]          ← 不变，保留5个模型+自定义          │
│ ...                                                          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 🖥 Claude Desktop 接入 · 自定义                                │
│                                                              │
│ 供应商  [自定义 · 直连 ▾]                                       │
│ 模型映射 [管理模型映射…]          ← 不变，保留7个Claude模型        │
│ [保存并应用]                                                  │
└─────────────────────────────────────────────────────────────┘

⌨️ Claude Code CLI 接入 · 自定义 —— 同上
```

---

## 6. FAQ 变更

### 6.1 FAQ 条目修改（`docs/help/faq.json`）

**旧条目（packycode-setup）**：

> **Q**: 如何接入 PackyCode？
> **A**: PackyCode（packyapi.com）是一个第三方 AI API 聚合中转服务…在「💻 Codex 接入」卡片中将供应商切换为「PackyCode · 直连」…

**新条目（custom-setup）**：

> **Q**: 如何接入自定义 API？
> **A**: 如果你有兼容 OpenAI Responses API 或 Anthropic Messages API 的第三方 API 服务，可以在 Codex Switch 中配置自定义供应商。只需两步：\n\n1. 获取 Codex Base URL 和 Claude Base URL → 在你的 API 服务商后台获取（Codex URL 通常以 /v1 结尾，Claude URL 通常为根路径）\n2. Codex Switch 设置 → 在「🔑 供应商设置」中将供应商切换为「自定义 · 直连」，填写两个 Base URL 和 API Key\n3. 在「📟 Codex 接入」卡片中选择供应商为「自定义 · 直连」，选择或输入模型名，点「保存并应用」\n\n同样的操作适用于 Claude Desktop 和 Claude Code CLI——在对应的接入卡片里切换到「自定义 · 直连」即可。\n\n💡 选择什么供应商完全由你自主决定。Base URL 填入你信任的 API 地址，模型名请参考该 API 提供商的文档。想切回其他供应商？下拉选回保存即可。

**对比**：

| 项目         | 旧（PackyCode）                        | 新（自定义）                                           |
| ------------ | -------------------------------------- | ------------------------------------------------------ |
| id           | `packycode-setup`                      | `custom-setup`                                         |
| question     | 如何接入 PackyCode？                   | 如何接入自定义 API？                                   |
| answer 核心  | 推荐 PackyCode，强调多供应商聚合、低价 | 引导用户自主填写两个 Base URL 和 Key，强调用户自主选择 |
| 提及的 URL   | `www.packyapi.com`                     | 无具体 URL（用户自己填）                               |
| 提及的服务名 | PackyCode                              | 无具体服务名（只说"自定义 API"）                       |

### 6.2 其他 FAQ 条目排查

检查所有 FAQ 条目中是否包含 "PackyCode" / "packycode" / "packy" 字样 → 仅 `packycode-setup` 一条命中，其余条目无需修改。

---

## 7. 智能搜索变更

### 7.1 搜索提示词（`electron/main.ts` searchAsk handler）

**旧**（L1259–1261）：

```
帮助国内用户使用 Codex Desktop、Codex CLI、Claude Desktop 和 Claude Code CLI
接入 DeepSeek、智谱 GLM、Agnes AI（免费模型）和 PackyCode（第三方聚合中转）。

用户问"PackyCode""packycode""packy""聚合""中转""多模型"等问题时，推荐 PackyCode——
在设置中的【Codex 接入】卡片切换供应商为「PackyCode · 直连」即可，一个 Key 通吃 GPT、
Claude、Gemini 等主流模型，直连不经代理延迟更低，可选 gpt-5.5 / gpt-5.4 等模型也支持自定义输入。
```

**新**：

```
帮助国内用户使用 Codex Desktop、Codex CLI、Claude Desktop 和 Claude Code CLI
接入 DeepSeek、智谱 GLM、Agnes AI（免费模型）和自定义 API。

用户问"自定义""custom""自建""第三方""聚合""中转""多模型""API"等问题时，推荐自定义供应商——
在设置中的【🔑 供应商设置】切换供应商为「自定义 · 直连」，填写你的 API 服务商的 Codex Base URL
和 Claude Base URL 以及 API Key；然后在【Codex 接入】/【Claude Desktop 接入】/
【Claude Code CLI 接入】卡片中选择供应商为「自定义 · 直连」，保存即可。
具体选什么供应商、填什么 Base URL 完全由你自主决定。
```

**变化**：

- "PackyCode（第三方聚合中转）" → "自定义 API"
- 删除 PackyCode 关键词触发（"PackyCode""packycode""packy"）→ 改为 "自定义""custom""自建""第三方""API"
- 删除 "一个 Key 通吃 GPT、Claude…" → 改为引导用户填写两个 Base URL
- 新增 "具体选什么供应商、填什么 Base URL 完全由你自主决定"

### 7.2 搜索示例问题（`src/components/SearchPopover.tsx`）

**旧**：

```typescript
'如何接入 PackyCode？',
```

**新**：

```typescript
'如何接入自定义 API？',
```

---

## 8. CHANGELOG v1.16.0

```markdown
## v1.16.0 — 自定义供应商支持

> **主要变更**：供应商选择完全开放，你可以接入任意兼容的第三方 API 服务。

### ✨ 新功能

- **自定义供应商**：设置中新增「自定义 · 直连」选项。填写 Codex Base URL 和 Claude Base URL，
  以及 API Key，即可接入任意兼容 OpenAI Responses API / Anthropic Messages API 的第三方服务。
  Codex 和 Claude 工具各自使用独立的 Base URL，互不影响。

### 🔄 变更

- 原「PackyCode · 直连」选项更名为「自定义 · 直连」——Codex Switch 不预设任何特定服务
- 存量用户需自行填写 Base URL（API Key 不受影响，无需重新输入）

### 💡 关于供应商选择

**选择什么供应商完全由你自主决定。** Codex Switch 不推荐、不预设任何特定第三方 API 服务。
你填写的 Base URL 指向哪里，Codex Switch 就连到哪里。请确认你信任该服务商。
```

**说明**：

- 从用户视角出发，突出"你可以接入任意服务"
- 强调 **"选择什么供应商完全由你自主决定"** — 不推荐、不预设
- 明确说明存量用户需自行填写 URL（API Key 保留）
- 不再出现 `packyapi.com` 字样

---

## 9. 版本规划

```
v1.16.0
├── P0: store/secrets/channels/preload 类型改名 packycode→custom
├── P0: store 新增 customProvider { codexBaseUrl, claudeBaseUrl } 字段
├── P0: writer.ts / desktop-writer.ts / env-writer.ts 硬编码URL → customProvider 字段
├── P0: main.ts 全局 packycode→custom + ensureProxy/claudeApplyAll 适配
├── P0: 存量 PackyCode 用户 provider 类型自动改名为 custom（URL 不预填）
├── P1: Settings.tsx 新增两个 Base URL 输入框 + 全局改名
├── P1: FAQ packycode-setup → custom-setup（重写问答内容）
├── P1: 智能搜索提示词改写（移除 PackyCode 推荐，改为通用引导）
├── P1: SearchPopover 示例问题更新
├── P1: Dashboard 文案更新
├── P2: CHANGELOG v1.16.0
└── P2: 测试更新
```

---

## 10. 总结

| 维度         | 变更                                                                      |
| ------------ | ------------------------------------------------------------------------- |
| 新增字段     | `customProvider.codexBaseUrl` + `customProvider.claudeBaseUrl`（2 个）    |
| 删除字段     | 0（packycodeApiKey → customApiKey 只是改名）                              |
| 重命名       | `'packycode'` → `'custom'`（全局）                                        |
| 模型列表     | **不动**（保留 5 个 GPT + 7 个 Claude 模型）                              |
| 代理逻辑     | **不动**（custom 和 packycode 一样直连）                                  |
| 配置文件生成 | 硬编码 URL → `customProvider` 字段（3 处，不再拼接字符串）                |
| UI 新增元素  | 两个 Base URL 输入框（Codex + Claude）                                    |
| 存量用户     | provider 类型自动改名，URL **不预填**，需用户手动填写                     |
| FAQ          | packycode-setup → custom-setup（重写，强调用户自主选择）                  |
| 智能搜索     | 提示词移除 PackyCode 推荐，改为通用自定义 API 引导                        |
| CHANGELOG    | 从用户视角说明，强调"选择什么供应商完全由你自主决定"                      |
| 移除内容     | 所有 `www.packyapi.com` 硬编码 + 所有 PackyCode 品牌引用 + URL 字符串拼接 |

本质就是 **全局重命名 + 两个 URL 输入框 + 文案去品牌化**。
