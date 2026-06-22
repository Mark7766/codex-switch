# DESIGN: PackyCode 供应商接入方案

> 状态：提案
> 日期：2026-06-22
> 方案版本：v1.0
> 目标软件版本：v1.15.0
> 原则：改动量最小，参照 cc-switch 的直接配置注入模式，不经过本地代理翻译

---

## 1. 调研结论

### 1.1 PackyCode 是什么

PackyCode（[packyapi.com](https://www.packyapi.com)）是一个第三方 AI API 聚合服务，**原生同时支持 OpenAI Responses API 和 Anthropic Messages API** 两种协议。这意味着它不需要协议翻译层——Codex 和 Claude 工具都可以直接连接。

| 项目                     | 值                                                                           |
| ------------------------ | ---------------------------------------------------------------------------- |
| 官网                     | <https://www.packyapi.com>                                                   |
| API Key 获取             | <https://www.packyapi.com/register?aff=cc-switch>                            |
| Codex 端点（Responses）  | `https://www.packyapi.com/v1`（主）、`https://api-slb.packyapi.com/v1`（备） |
| Claude 端点（Anthropic） | `https://www.packyapi.com`（主）、`https://api-slb.packyapi.com`（备）       |
| 默认模型                 | `gpt-5.5`（Codex）、透传 Claude 模型名（Claude）                             |
| 协议                     | OpenAI Responses API + Anthropic Messages API 双协议原生支持                 |
| 类型                     | 第三方 API 聚合（third_party）                                               |

### 1.2 与现有供应商的关键差异

| 维度               | DeepSeek / GLM / Agnes                          | PackyCode                                                               |
| ------------------ | ----------------------------------------------- | ----------------------------------------------------------------------- |
| Codex 协议         | Chat Completions（需代理翻译 Responses → Chat） | **Responses API 原生**（无需翻译）                                      |
| Claude 协议        | Anthropic Messages（直连）                      | **Anthropic Messages 原生**（直连）                                     |
| 代理角色           | 必要（协议翻译）                                | **不必要**（双方说同一语言）                                            |
| cc-switch 接入模式 | —                                               | **直接配置注入**（Codex config.toml 指向 packyapi.com，不经过本地代理） |

### 1.3 核心洞察

> PackyCode 和 DeepSeek/GLM/Agnes 的根本区别：后者讲 Chat Completions，需要 codex-switch 代理做 Responses → Chat 翻译；前者讲 Responses，Codex 可以直接和它对话。

这意味着 PackyCode 的接入模式天然不同于现有供应商——**不需要代理翻译层**。

---

## 2. 接入策略：直接配置注入（对齐 cc-switch）

### 2.1 核心思路

```
现有模式（DeepSeek/GLM/Agnes）：
  Codex ──Responses──▶ 代理(127.0.0.1:11435) ──Chat──▶ 上游
                        ▲
                        │ 翻译层（必需）

PackyCode 模式（新增）：
  Codex ──Responses──▶ packyapi.com/v1
                        ▲
                        │ 直连，无翻译层
```

- **Codex**：`~/.codex/config.toml` 直接写 `base_url = "https://www.packyapi.com/v1"`，绕过本地代理
- **Claude Desktop**：3P gateway profile 指向 `https://www.packyapi.com`（Anthropic 格式，直连）
- **Claude Code CLI**：`~/.claude/settings.json` 写 `ANTHROPIC_BASE_URL = "https://www.packyapi.com"`（直连）

### 2.2 为什么不用代理

| 方案                                  | 改动量                              | 复杂度                                              | 风险                                 |
| ------------------------------------- | ----------------------------------- | --------------------------------------------------- | ------------------------------------ |
| **A. 直接配置注入（cc-switch 模式）** | 小（~8 文件，约 120 行）            | 低。只是多一个供应商选项，写不同的 config.toml 内容 | 低。cc-switch 已大规模验证此模式可用 |
| B. 代理透传（不改翻译层，直接转发）   | 中（需改 proxy 路由和数据流）       | 中。要在现有翻译管道中开一个"跳过翻译"分支          | 中。两种 code path 叠加增加维护成本  |
| C. 代理完整支持（和 DeepSeek 同级）   | 大（需在 proxy 中实现无操作翻译层） | 高。Responses → Responses 翻译是多余的              | 高。无意义的抽象层                   |

> **选择方案 A**。理由：PackyCode 讲 Responses，代理的翻译层对它无用。直接配置注入改动最小、最安全、cc-switch 已验证。

### 2.3 代理生命周期

选择 PackyCode 时，本地代理的行为取决于 Claude 工具是否也选了 PackyCode：

| Codex 供应商       | Claude Desktop 供应商 | Claude CLI 供应商  | 代理行为                       |
| ------------------ | --------------------- | ------------------ | ------------------------------ |
| PackyCode          | PackyCode             | PackyCode          | **代理不启动**（所有工具直连） |
| PackyCode          | DeepSeek/GLM/Agnes    | DeepSeek/GLM/Agnes | 代理启动（Claude 工具经代理）  |
| DeepSeek/GLM/Agnes | 任意                  | 任意               | 代理启动（Codex 经代理）       |

> 当三工具全部选择 PackyCode 时，`ensureProxy()` 跳过代理启动，Dashboard 显示"PackyCode 直连模式 · 无需本地代理"。

---

## 3. 三工具接入详述

### 3.1 Codex（直连 PackyCode Responses API）

直接写 `~/.codex/config.toml`，Codex 绕过代理直连 PackyCode。

**config.toml 模板（PackyCode）：**

```toml
# Codex CLI 配置（由 Codex Switch 自动生成 · PackyCode 直连模式）

model_provider = "custom"
model = "gpt-5.5"
model_reasoning_effort = "xhigh"

model_context_window = 1000000
model_auto_compact_token_limit = 900000

[model_providers.custom]
name = "PackyCode"
base_url = "https://www.packyapi.com/v1"
wire_api = "responses"
requires_openai_auth = true
```

**与当前 DeepSeek 模板的差异：**

| 字段                            | DeepSeek 模板（当前）          | PackyCode 模板（新增）          |
| ------------------------------- | ------------------------------ | ------------------------------- |
| `model`                         | `codex-switch`（代理内部路由） | `gpt-5.5`（PackyCode 默认模型） |
| `base_url`                      | `http://127.0.0.1:{port}/v1`   | `https://www.packyapi.com/v1`   |
| `[model_providers.custom].name` | `Codex Switch`                 | `PackyCode`                     |
| `auth.json`                     | DeepSeek/Agnes/GLM Key         | PackyCode API Key               |

**关键行为差异**：

- 代理不参与 Codex ↔ PackyCode 通信
- Dashboard 中 Codex 状态显示"PackyCode 直连"
- 日志中不包含 Codex 请求（直连不经代理），但 Settings 中保存操作本身记录日志
- Token 统计不包含 Codex 消耗（数据在 PackyCode 侧）
- 切换回 DeepSeek/GLM/Agnes 时，config.toml 恢复代理指向

### 3.2 Claude Desktop（直连 PackyCode Anthropic 端点）

3P gateway profile 写 PackyCode 的 Anthropic 端点。

| 配置项                            | 值                                                                   |
| --------------------------------- | -------------------------------------------------------------------- |
| `inferenceGatewayBaseUrl`         | `https://www.packyapi.com`                                           |
| `inferenceGatewayApiKey`          | `<PackyCode Key>`                                                    |
| `inferenceGatewayAuthScheme`      | `bearer`                                                             |
| `inferenceModels[].name`          | `claude-opus-4-7` / `claude-sonnet-4-6` / `claude-haiku-4-5`         |
| `inferenceModels[].labelOverride` | 透传 Claude 模型名（PackyCode 内部路由，用户可在模型映射弹窗中修改） |
| `disableDeploymentModeChooser`    | `true`                                                               |

**实现方式**：在 `desktop-writer.ts` 的 `buildGatewayProfile()` 中新增 `provider === 'packycode'` 分支，base URL 写 `https://www.packyapi.com`，`inferenceModels[].labelOverride` 默认透传 Claude 原生模型名（PackyCode 的 Anthropic 端点内部做模型映射）。

### 3.3 Claude Code CLI（直连 PackyCode Anthropic 端点）

`~/.claude/settings.json` 写 PackyCode 的 Anthropic 端点。

| 配置项                                     | 值                                                |
| ------------------------------------------ | ------------------------------------------------- |
| `ANTHROPIC_BASE_URL`                       | `https://www.packyapi.com`                        |
| `ANTHROPIC_AUTH_TOKEN`                     | `<PackyCode Key>`                                 |
| `ANTHROPIC_MODEL`                          | `claude-sonnet-4-6`（用户可在模型映射弹窗中修改） |
| `ANTHROPIC_DEFAULT_OPUS_MODEL`             | `claude-opus-4-7`                                 |
| `ANTHROPIC_DEFAULT_SONNET_MODEL`           | `claude-sonnet-4-6`                               |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL`            | `claude-haiku-4-5`                                |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | `1`                                               |

**实现方式**：在 `env-writer.ts` 的 `resolveEnvVars()` 中新增 `provider === 'packycode'` 分支。模型名透传 Claude 原生名，因为 PackyCode 的 Anthropic 端点内部做模型路由。

---

## 4. 改动范围

### 4.1 文件级变更清单

| 文件                                | 变更类型    | 行数估计    | 说明                                                                                |
| ----------------------------------- | ----------- | ----------- | ----------------------------------------------------------------------------------- |
| `electron/config/store.ts`          | 修改        | +3          | Provider 类型联合新增 `'packycode'`（4 处类型声明 + 默认值）                        |
| `electron/config/secrets.ts`        | 修改        | +12         | 新增 `getPackyCodeKey()` / `setPackyCodeKey()` / `deletePackyCodeKey()`             |
| `electron/codex/writer.ts`          | 修改        | +25         | 新增 `PACKYCODE_TEMPLATE` 常量 + `provider` 参数支持                                |
| `electron/claude/desktop-writer.ts` | 修改        | +12         | `buildGatewayProfile()` 新增 `packycode` 分支                                       |
| `electron/claude/env-writer.ts`     | 修改        | +12         | `resolveEnvVars()` 新增 `packycode` 分支                                            |
| `electron/ipc/channels.ts`          | 修改        | +3          | 新增 `packycode:key-get` / `packycode:key-set` / `packycode:key-clear`              |
| `electron/preload.ts`               | 修改        | +5          | 暴露 3 个 PackyCode Key API                                                         |
| `electron/main.ts`                  | 修改        | +40         | `ensureProxy()` PackyCode 分支 + 3 个 key handler + `claudeApplyAll` PackyCode 分支 |
| `src/pages/Settings.tsx`            | 修改        | +20         | 三张卡片供应商下拉各新增「PackyCode」选项 + Key 输入框动态切换                      |
| `src/types/global.d.ts`             | 修改        | +5          | 类型扩展                                                                            |
| **合计**                            | **10 文件** | **~137 行** |                                                                                     |

### 4.2 不需要改动的模块

以下模块**零改动**：

| 模块                             | 原因                                                 |
| -------------------------------- | ---------------------------------------------------- |
| `electron/proxy/server.ts`       | 代理不参与 PackyCode 通信                            |
| `electron/proxy/stream.ts`       | 不需要上游 API 调用                                  |
| `electron/proxy/translate.ts`    | 不需要协议翻译                                       |
| `electron/proxy/http-handler.ts` | 不经过代理                                           |
| `electron/proxy/ws-handler.ts`   | 不经过代理                                           |
| `electron/proxy/http-routes.ts`  | 不经过代理                                           |
| `src/pages/Dashboard.tsx`        | PackyCode 直连模式下代理不启动，Dashboard 自适应显示 |
| `src/pages/Logs.tsx`             | 直连不产生代理日志                                   |

### 4.3 需要微调的模块

| 模块                                 | 原因                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `electron/main.ts` — `ensureProxy()` | 当三工具全选 PackyCode 时跳过代理启动；否则正常启动（Claude 工具可能需要代理） |

---

## 5. 详细设计

### 5.1 store.ts — Provider 类型扩展

```typescript
// 修改前（4 处）
provider: 'deepseek' | 'agnes' | 'glm';
claudeDesktopProvider: 'deepseek' | 'agnes' | 'glm';
claudeCliProvider: 'deepseek' | 'agnes' | 'glm';
activeModelMapping: Record<string, { model: string; provider: 'deepseek' | 'agnes' | 'glm' }>;

// 修改后
provider: 'deepseek' | 'agnes' | 'glm' | 'packycode';
claudeDesktopProvider: 'deepseek' | 'agnes' | 'glm' | 'packycode';
claudeCliProvider: 'deepseek' | 'agnes' | 'glm' | 'packycode';
activeModelMapping: Record<
  string,
  { model: string; provider: 'deepseek' | 'agnes' | 'glm' | 'packycode' }
>;
```

默认值不变（仍为 `'deepseek'`）。

### 5.2 secrets.ts — PackyCode Key 存储

完全复用 Agnes/GLM Key 的 keytar 存储模式：

```typescript
const PACKYCODE_KEY_SERVICE = 'codex-switch';
const PACKYCODE_KEY_ACCOUNT = 'packycode-api-key';

export async function getPackyCodeKey(): Promise<string | null> {
  /* keytar.getPassword */
}
export async function setPackyCodeKey(key: string): Promise<void> {
  /* keytar.setPassword */
}
export async function deletePackyCodeKey(): Promise<void> {
  /* keytar.deletePassword */
}
```

### 5.3 writer.ts — PackyCode config.toml 模板

新增独立模板函数 `PACKYCODE_TEMPLATE`：

```typescript
const PACKYCODE_TEMPLATE =
  (): string => `# Codex CLI 配置（由 Codex Switch 自动生成 · PackyCode 直连模式）
# 完整配置参考: https://github.com/openai/codex

model_provider = "custom"
model = "gpt-5.5"
model_reasoning_effort = "xhigh"

model_context_window = 1000000
model_auto_compact_token_limit = 900000

[model_providers.custom]
name = "PackyCode"
base_url = "https://www.packyapi.com/v1"
wire_api = "responses"
requires_openai_auth = true
`;
```

`writeCodexConfig()` 新增可选 `provider` 参数，默认 `'deepseek'`（向后兼容）。当 `provider === 'packycode'` 时使用 `PACKYCODE_TEMPLATE`，不依赖 `proxyPort`。

**模板差异对比**：

| 字段             | 代理模板                      | PackyCode 模板                |
| ---------------- | ----------------------------- | ----------------------------- |
| `model`          | `codex-switch`                | `gpt-5.5`                     |
| `base_url`       | `http://127.0.0.1:${port}/v1` | `https://www.packyapi.com/v1` |
| `name`           | `Codex Switch`                | `PackyCode`                   |
| 依赖 `proxyPort` | 是                            | 否                            |

**auth.json**：同样需要区分——PackyCode 模式下写 PackyCode Key（而非 DeepSeek/Agnes/GLM Key）。

**备份与还原**：PackyCode 直连模式下写入的 config.toml 同样遵循先备份再写入的原则（`*.bak.<timestamp>`），还原逻辑不变。

### 5.4 desktop-writer.ts — Claude Desktop PackyCode 分支

在 `buildGatewayProfile()` 中新增：

```typescript
if (provider === 'packycode') {
  return {
    inferenceProvider: 'gateway',
    inferenceGatewayBaseUrl: 'https://www.packyapi.com',
    inferenceGatewayApiKey: apiKey,
    inferenceGatewayAuthScheme: 'bearer',
    disableDeploymentModeChooser: true,
    inferenceModels: [
      { name: 'claude-opus-4-7', labelOverride: modelMap['claude-opus-4-7'] ?? 'claude-opus-4-7' },
      {
        name: 'claude-sonnet-4-6',
        labelOverride: modelMap['claude-sonnet-4-6'] ?? 'claude-sonnet-4-6',
      },
      {
        name: 'claude-haiku-4-5',
        labelOverride: modelMap['claude-haiku-4-5'] ?? 'claude-haiku-4-5',
      },
    ],
    __codexSwitch: 'managed',
  };
}
```

**关键差异**：PackyCode 的 Anthropic 端点内部做模型路由，所以 `labelOverride` 默认透传 Claude 原生模型名（与 DeepSeek/GLM 需要覆盖为供应商模型名不同）。

### 5.5 env-writer.ts — Claude Code CLI PackyCode 分支

在 `resolveEnvVars()` 中新增：

```typescript
if (provider === 'packycode') {
  return {
    envVars: {
      ANTHROPIC_BASE_URL: 'https://www.packyapi.com',
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_MODEL: envVars.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-7',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
  };
}
```

### 5.6 main.ts — 核心逻辑变更

#### 5.6.1 ensureProxy() — PackyCode 分支

```typescript
// 现有逻辑：根据 provider 决定 upstreamBase 和 apiKey
const upstreamBase =
  prefs.provider === 'agnes'
    ? 'apihub.agnes-ai.com'
    : prefs.provider === 'glm'
      ? 'open.bigmodel.cn'
      : 'api.deepseek.com';

// 新增 PackyCode 逻辑：
// 当 Codex 供应商为 packycode 时，Codex 直连 PackyCode，不经过代理。
// 但如果 Claude 工具需要代理（选了 Agnes），代理仍需启动。
// 判断：是否需要启动代理 = Codex 供应商不是 packycode 或 Claude 工具有需要代理的
const codexNeedsProxy = prefs.provider !== 'packycode';
const claudeDesktopNeedsProxy = prefs.claudeDesktopProvider === 'agnes'; // Agnes 走代理
const claudeCliNeedsProxy = prefs.claudeCliProvider === 'agnes'; // Agnes 走代理
const needsProxy = codexNeedsProxy || claudeDesktopNeedsProxy || claudeCliNeedsProxy;

if (!needsProxy) {
  // 所有工具直连，代理无需启动
  log.info('所有工具均为直连模式（PackyCode），跳过代理启动');
  return;
}
```

#### 5.6.2 applyPreferencesTransaction() — PackyCode 分支

当 `provider === 'packycode'` 时：

- `writeCodexConfig()` 使用 PackyCode 模板（直连），不依赖 `proxyPort`
- `auth.json` 写 PackyCode Key
- 不需要 `proxy.restart()`（代理不参与 Codex 通信）

#### 5.6.3 PackyCode Key IPC handlers

完全复用 Agnes/GLM Key handler 模式：

- `IPC.packycodeKeyGet` → `getPackyCodeKey()`
- `IPC.packycodeKeySet` → 校验 trim + 最小长度 10 → `setPackyCodeKey()` → 若匹配则自动 apply
- `IPC.packycodeKeyClear` → `deletePackyCodeKey()`

#### 5.6.4 claudeApplyAll() — PackyCode 分支

当 `claudeDesktopProvider === 'packycode'` 时：

- 读取 PackyCode Key → 传入 `writeClaudeDesktopConfig(key, 'packycode')`

当 `claudeCliProvider === 'packycode'` 时：

- 读取 PackyCode Key → 传入 `resolveEnvVars(envVars, 'packycode')` → 写入 settings.json

#### 5.6.5 startupApplyClaude() — PackyCode 分支

启动时根据 `claudeDesktopProvider` / `claudeCliProvider` 读取对应 Key 并 apply。

### 5.7 Settings.tsx — UI 变更

三张卡片（Codex / Claude Desktop / Claude Code CLI）的供应商下拉框各新增一个选项：

```
供应商：[DeepSeek ▼]
        Agnes
        智谱 GLM
        PackyCode      ← 新增
```

选择 PackyCode 后：

- **API Key 输入框**切换为 PackyCode Key（通过 `packycodeKeyGet` / `packycodeKeySet`）
- **Codex 卡片**：默认模型显示 `gpt-5.5`，模型映射弹窗中的可选模型列表更新
- **Claude Desktop 卡片**：模型映射弹窗中 `labelOverride` 默认值透传 Claude 原生模型名
- **Claude Code CLI 卡片**：同上

保存时：

- Codex 选 PackyCode → 调用 `applyPreferences` → 主进程写 PackyCode config.toml
- Claude 工具选 PackyCode → 调用 `claudeApplyAll` → 主进程写 PackyCode 3P profile / settings.json

### 5.8 Dashboard 适配

当三工具全部直连时，Dashboard 的代理状态区显示：

```
🟢 PackyCode 直连模式
   所有工具直接连接 PackyCode，无需本地代理
   [停止代理] 按钮隐藏
```

当混合模式（部分工具走代理）时，代理正常运行，状态区不变。

---

## 6. 与 cc-switch 的对齐度

| 维度                 | cc-switch                                         | 本方案               | 对齐 |
| -------------------- | ------------------------------------------------- | -------------------- | ---- |
| Codex 接入方式       | 直连 packyapi.com/v1                              | 直连 packyapi.com/v1 | ✅   |
| Codex config 模板    | `model_provider="custom"`, `wire_api="responses"` | 同                   | ✅   |
| Claude Desktop 接入  | 3P profile 直连                                   | 3P profile 直连      | ✅   |
| Claude Code CLI 接入 | env vars 直连                                     | env vars 直连        | ✅   |
| 端点候选             | `www.packyapi.com` + `api-slb.packyapi.com`       | 同                   | ✅   |
| 默认模型             | `gpt-5.5`（Codex）/ 透传 Claude 名                | 同                   | ✅   |
| 代理角色             | 无（直连）                                        | 无（直连）           | ✅   |

---

## 7. 实施步骤

### Step 1：类型层（store.ts + types/global.d.ts）

- Provider 类型联合新增 `'packycode'`
- 默认值不变（向后兼容）

### Step 2：密钥层（secrets.ts + channels.ts + preload.ts）

- 新增 PackyCode Key 的 keytar 存取
- IPC 通道注册 + preload 暴露

### Step 3：配置写入层（writer.ts + desktop-writer.ts + env-writer.ts）

- `writer.ts` 新增 `PACKYCODE_TEMPLATE` + `provider` 参数
- `desktop-writer.ts` 新增 `packycode` 分支
- `env-writer.ts` 新增 `packycode` 分支

### Step 4：主进程编排（main.ts）

- `ensureProxy()` PackyCode 跳过逻辑
- `applyPreferencesTransaction()` PackyCode 分支
- 3 个 Key IPC handler
- `claudeApplyAll()` + `startupApplyClaude()` PackyCode 分支

### Step 5：前端 UI（Settings.tsx）

- 三张卡片供应商下拉新增 PackyCode 选项
- Key 输入框联动
- 模型映射弹窗适配

### Step 6：测试与验证

- 单元测试：writer / desktop-writer / env-writer 新增 PackyCode 分支用例
- 集成测试：Settings 页面 PackyCode 选项渲染
- 手动验证：选 PackyCode → 保存 → 检查 `~/.codex/config.toml` 内容 → 启动 Codex → 确认直连 packyapi.com

---

## 8. 边界情况

| 场景                                      | 处理方式                                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 用户未填写 PackyCode Key 就保存           | UI 守卫：Key 为空时"保存并应用"按钮 disabled + 红色提示"请先填写 PackyCode API Key"            |
| 从 PackyCode 切回 DeepSeek                | config.toml 恢复代理模板（`base_url = http://127.0.0.1:{port}/v1`），auth.json 写 DeepSeek Key |
| 从 PackyCode 切到 GLM                     | 同上，写 GLM 代理模板 + GLM Key                                                                |
| PackyCode Key 格式错误                    | `keySet` handler 做最小长度校验（trim + length ≥ 10），不满足则 toast 提示                     |
| Codex 选 PackyCode、Claude 选 DeepSeek    | 混合模式：代理启动（Claude 需代理），config.toml 写 PackyCode 直连（Codex 不走代理）           |
| 三工具全选 PackyCode                      | 代理不启动，Dashboard 显示直连模式                                                             |
| 代理正在运行、用户把 Codex 切到 PackyCode | 若 Claude 工具不需要代理 → 停止代理；若需要 → 代理继续运行                                     |
| PackyCode 服务不可达                      | 和现有供应商一致：显示连接错误提示，不静默失败                                                 |
| 存量用户升级（v1.14.x → v1.15.0）         | provider 默认值 `'deepseek'`，存量用户不受影响；新增 `'packycode'` 选项需用户主动选择          |

---

## 9. 风险与缓解

| 风险                                                                       | 概率 | 影响                               | 缓解                                                                           |
| -------------------------------------------------------------------------- | ---- | ---------------------------------- | ------------------------------------------------------------------------------ |
| PackyCode API 格式与 OpenAI Responses 有细微差异                           | 低   | Codex 请求失败                     | 参照 cc-switch 已验证的 config 模板，字段与 cc-switch 完全一致                 |
| 用户混淆"直连"和"代理"两种模式                                             | 中   | 用户以为代理没启动是 bug           | Settings 和 Dashboard 增加明确文案："PackyCode 直连模式 · 不经过本地代理"      |
| 直连模式下失去代理日志/token 统计                                          | 确定 | 用户看不到 Codex 请求的 token 消耗 | Dashboard 增加说明："Token 统计仅在代理模式下可用"；PackyCode 官网提供用量查询 |
| Claude Desktop 3P profile 的 `labelOverride` 透传模型名不被 PackyCode 识别 | 低   | Claude Desktop 无法选择模型        | cc-switch 已用此配置验证通过；若出问题，用户可在模型映射弹窗中手动修改         |

---

## 10. 未覆盖项（明确不做）

- **代理透传模式**（Codex → 本地代理 → PackyCode）：增加复杂度，无收益
- **PackyCode 端点自动测速切换**：v1.15.0 不做，用户可手动在 Settings 中选择主/备端点（后续版本可加）
- **PackyCode 用量统计集成**：v1.15.0 不做，用户去 PackyCode 官网查看
- **Agnes 走代理 + PackyCode 走代理同时共存**：三工具各选各的供应商已经支持，本次不改动代理路由逻辑

---

## 11. 参考

- cc-switch PackyCode Codex 预设：`src/config/codexProviderPresets.ts` L895-912
- cc-switch PackyCode Claude 预设：`src/config/claudeProviderPresets.ts` L656-675
- cc-switch PackyCode Claude Desktop 预设：`src/config/claudeDesktopProviderPresets.ts` L628-644
- codex-switch GLM 接入方案：`docs/DESIGN-glm-integration.md`
- codex-switch Agnes 接入方案：`docs/DESIGN-agnes-ai-integration.md`
