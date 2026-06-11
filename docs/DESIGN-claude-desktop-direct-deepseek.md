# Claude Desktop 直连 DeepSeek 整改方案

> **背景**：当前 Claude Desktop 走本地代理（127.0.0.1:11440/anthropic → DeepSeek），
> 与 Claude Code CLI 的直连模式不一致。代理层带来额外复杂度：max_tokens 穿透截断、
> SSE 流式转发延迟、工具循环探测等问题。整改目标：Claude Desktop 和 Claude Code CLI
> 一样 **直连 DeepSeek Anthropic 端点，不走本地代理**。

---

## 一、当前 vs 目标

```
┌─ 当前 ───────────────────────────────────────────────────┐
│                                                           │
│  Claude Desktop                                            │
│     │                                                     │
│     │ 3P gateway profile                                  │
│     │   inferenceGatewayBaseUrl = "http://127.0.0.1:11440/anthropic"
│     │   inferenceGatewayApiKey = "cs-internal-placeholder" │
│     ▼                                                     │
│  ┌─────────────────────────────────────┐                  │
│  │  Codex Switch 代理 (anthropic-relay) │                  │
│  │  ├─ 模型名重写                        │                  │
│  │  ├─ tools/tool_choice strip          │                  │
│  │  ├─ max_tokens clamp                 │                  │
│  │  ├─ SSE 流式转发                     │                  │
│  │  └─ API Key 替换 (placeholder→真实)   │                  │
│  └──────────────┬──────────────────────┘                  │
│                 ▼                                          │
│            DeepSeek API                                    │
│         (api.deepseek.com/anthropic)                       │
│                                                           │
└───────────────────────────────────────────────────────────┘

┌─ 目标 ───────────────────────────────────────────────────┐
│                                                           │
│  Claude Desktop                                            │
│     │                                                     │
│     │ 3P gateway profile                                  │
│     │   inferenceGatewayBaseUrl = "https://api.deepseek.com/anthropic"
│     │   inferenceGatewayApiKey = "<真实 DeepSeek API Key>" │
│     ▼                                                     │
│            DeepSeek API (直连)                             │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

---

## 二、变更范围总览

| 文件 | 操作 | 说明 |
|------|------|------|
| `electron/claude/desktop-writer.ts` | **重写** | 3P profile 指向 DeepSeek 直连 |
| `electron/proxy/anthropic-relay.ts` | **删除** | 不再需要代理转发 |
| `electron/proxy/server.ts` | **修改** | 移除 `/anthropic/v1/*` 路由 |
| `electron/main.ts` | **修改** | 移除 Claude Desktop 代理 wiring |
| `electron/config/store.ts` | **修改** | 简化 ClaudeDesktopPrefs |
| `electron/config/migrations.ts` | **修改** | 新增迁移：更新已有 profile → 直连 |
| `electron/claude/detect.ts` | **修改** | 更新检测逻辑（不再检查 127.0.0.1） |
| `electron/ipc/channels.ts` | **不变** | IPC 通道名保留 |
| `electron/preload.ts` | **不变** | 无需改动 |
| `src/components/ClaudeSettingsSection.tsx` | **修改** | 简化 Desktop 配置 UI |
| `src/types/global.d.ts` | **修改** | 移除 modelMap 类型 |
| `src/pages/Dashboard.tsx` | **修改** | Claude Desktop 卡片文案更新 |
| `src/pages/Settings.tsx` | **修改** | 小幅度适配 |

涉及 **4 个删除/重写** + **5 个修改** + **3 个不变**。`electron/proxy/anthropic-relay.ts` 整体删除（~400 行），`electron/proxy/server.ts` 删 ~20 行路由。

---

## 三、逐文件修改清单

### 3.1 `electron/claude/desktop-writer.ts` — 核心重写

**修改点 1：`buildGatewayProfile()` — 改 URL 和 API Key**

```diff
- function buildGatewayProfile(port: number): Record<string, unknown> {
+ function buildGatewayProfile(apiKey: string): Record<string, unknown> {
    return {
      disableDeploymentModeChooser: true,
-     inferenceGatewayApiKey: PLACEHOLDER_KEY,
+     inferenceGatewayApiKey: apiKey,
      inferenceGatewayAuthScheme: 'bearer',
-     inferenceGatewayBaseUrl: `http://127.0.0.1:${port}/anthropic`,
+     inferenceGatewayBaseUrl: 'https://api.deepseek.com/anthropic',
      inferenceModels: [
        { labelOverride: 'deepseek-v4-pro', name: 'claude-opus-4-7' },
        { labelOverride: 'deepseek-v4-flash', name: 'claude-sonnet-4-6' },
        { labelOverride: 'deepseek-v4-flash', name: 'claude-haiku-4-5' },
      ],
      inferenceProvider: 'gateway',
    };
  }
```

> **模型映射规则**（DeepSeek 端点根据 model name 前缀自动路由）：
>
> | Claude 模型前缀 | DeepSeek 模型 | 原因 |
> |---|---|---|
> | `claude-opus*` | `deepseek-v4-pro` | Opus 角色 → 最强模型 |
> | `claude-sonnet*` | `deepseek-v4-flash` | Sonnet 角色 → 快速模型 |
> | `claude-haiku*` | `deepseek-v4-flash` | Haiku 角色 → 快速模型 |
>
> `inferenceModels` 只需列出 Claude Desktop 模型选择器里显示的条目；
> DeepSeek 的 `/anthropic/v1/messages` 端点收到请求后根据 `model` 字段自行路由。
> 例如 Claude Desktop 发 `"model":"claude-sonnet-4-6"`，DeepSeek 匹配前缀 `claude-sonnet`
> 后路由到 `deepseek-v4-flash`。

**修改点 2：`writeClaudeDesktopConfig()` — 参数从 port 改为 apiKey**

```diff
- export async function writeClaudeDesktopConfig(port: number): Promise<void> {
+ export async function writeClaudeDesktopConfig(apiKey: string): Promise<void> {
```

**修改点 3：`updateClaudeDesktopPort()` → 改名或移除**

由于不再依赖代理端口，此函数不再需要。替换为 `updateClaudeDesktopApiKey(apiKey: string)` —
当用户在 Settings 更新 API Key 后同步到 profile JSON。

**修改点 4：`removeClaudeDesktopConfig()` — 简化标识逻辑**

当前用 `PLACEHOLDER_KEY` 判断"是我们写的"。改为在 profile 中加一个标记字段 `__codexSwitch: "managed"`（与 Claude Code CLI 的 `settings.json` 标记机制一致），卸载时只删除含该标记的 profile。

**修改点 5：常量清理**

- 移除 `PLACEHOLDER_KEY`（不再需要占位 key）
- `PROFILE_NAME` 考虑改为 `"DeepSeek"`（匹配用户在 Claude Desktop 里看到的名称）

### 3.2 `electron/proxy/anthropic-relay.ts` — 整体删除

**删除原因**：
- `handleAnthropicMessages` — SSE 转发不再需要
- `handleAnthropicModels` — 模型列表由 profile 的 `inferenceModels` 提供
- `handleAnthropicCountTokens` — DeepSeek 端点直接支持
- 所有类型定义、常量、工具函数 — 无其他模块依赖

**连带清理**：
- `package.json` 中无需为此增加/减少依赖（`https` 模块仍被 stream.ts 使用）

### 3.3 `electron/proxy/server.ts` — 移除 Anthropic 路由

```diff
- import { …, handleAnthropicMessages, handleAnthropicModels, … } from './anthropic-relay';

  // 删除以下 block（当前 L595–608）：
- if (req.method === 'GET' && url.pathname === '/anthropic/v1/models') {
-   handleAnthropicModels(res, this.anthropicRelayOpts());
-   return;
- }
- if (req.method === 'POST' && url.pathname === '/anthropic/v1/messages') {
-   handleAnthropicMessages(req, res, this.anthropicRelayOpts(), (entry) => { … });
-   return;
- }
- if (req.method === 'POST' && url.pathname === '/anthropic/v1/count_tokens') {
-   …
- }
```

**同时移除**：
- `ProxyOptions.claudeDesktop` 字段
- `anthropicRelayOpts()` 方法
- `LogSource` 类型中的 `'claude-desktop'`（或保留但标记 deprecated）

### 3.4 `electron/main.ts` — 移除 Claude Desktop 代理 wiring

```diff
- import { writeClaudeDesktopConfig, … } from './claude/desktop-writer';
+ import { writeClaudeDesktopConfig, … } from './claude/desktop-writer';  // 保留 import，config writer 仍需要

  // ensureProxy() — 移除 claudeDesktop 字段
  private ensureProxy() {
    …
-   claudeDesktop: prefs.claudeDesktop.enabled
-     ? { apiKey, modelMap: prefs.claudeDesktop.modelMap }
-     : undefined,
  }

  // applyPreferencesTransaction() — 移除 claudeDesktop 回滚/正向
-   claudeDesktop: before.claudeDesktop.enabled ? { … } : undefined,
-   claudeDesktop: next.claudeDesktop.enabled ? { … } : undefined,

  // IPC prefs:set — 移除 claudeDesktop 同步到代理
-   if (next.claudeDesktop) { … await proxy.updateOptions({ claudeDesktop }) }

  // startupApplyClaude — 参数从 port 改为 apiKey
-   await writeClaudeDesktopConfig(port);
+   await writeClaudeDesktopConfig(apiKey);

  // claudeApplyAll handler — 同上
-   await writeClaudeDesktopConfig(currentPort);
+   await writeClaudeDesktopConfig(apiKey);
```

### 3.5 `electron/config/store.ts` — 简化 Preferences

```diff
  interface ClaudeDesktopPrefs {
    enabled: boolean;
-   modelMap: Record<string, { model: string; supports1m: boolean }>;
  }
```

> **为什么 modelMap 可以移除**：profile 中的 `inferenceModels` 直接告诉 Claude Desktop
> "哪些 DeepSeek 模型对应哪些 Claude model ID"。DeepSeek 的 Anthropic 端点收到请求后
> 自行处理模型映射，不需要 Codex Switch 代劳。用户如需修改映射，改的是 profile JSON
> 中的 `inferenceModels` 列表。

### 3.6 `electron/config/migrations.ts` — 新增迁移

**场景**：已安装 v1.3.0–v1.5.x 的用户，其 Claude Desktop profile 仍指向
`http://127.0.0.1:{port}/anthropic`（走代理），需要一次性迁移到直连。

```ts
// v160_claudeDesktopDirect: 更新已有 profile 的 gateway URL 和 API Key
// 1. 读取 claudeDesktopProfilePath(PROFILE_ID)
// 2. 如果 inferenceGatewayBaseUrl 含 "127.0.0.1" 或 "localhost"
//    → 改写为 "https://api.deepseek.com/anthropic"
// 3. 如果 inferenceGatewayApiKey === PLACEHOLDER_KEY
//    → 替换为当前真实 API Key
// 4. 添加 __codexSwitch: "managed" 标记
// 5. 写回
```

### 3.7 `electron/claude/detect.ts` — 更新检测逻辑

```diff
  async function isClaudeDesktopConfigured(profilePath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(profilePath, 'utf-8');
      const cfg = JSON.parse(content) as Record<string, unknown>;
      return (
        cfg['inferenceProvider'] === 'gateway' &&
        typeof cfg['inferenceGatewayBaseUrl'] === 'string' &&
-       (cfg['inferenceGatewayBaseUrl'] as string).includes('127.0.0.1')
+       (cfg['inferenceGatewayBaseUrl'] as string).includes('deepseek.com')
      );
    } catch {
      return false;
    }
  }
```

### 3.8 前端组件 (ClaudeSettingsSection.tsx)

**Claude Desktop 分区简化**：

1. **去掉 Sonnet/Opus/Haiku 三行模型映射下拉框** — DeepSeek 端点自行处理
2. **文案改为**："Claude Desktop 直连 DeepSeek（不走本地代理）"（与 CLI 的文案对齐）
3. **`inferenceModels` 显示为只读信息**：展示 profile 中配置的三个模型映射
4. **保留**：enable 开关、配置路径展示、备份还原、一键卸载

### 3.9 `src/types/global.d.ts` — 类型清理

```diff
  interface Preferences {
-   claudeDesktop?: { enabled: boolean; modelMap: Record<string, { model: string; supports1m: boolean }> };
+   claudeDesktop?: { enabled: boolean };
  }
```

### 3.10 不动的文件

| 文件 | 原因 |
|------|------|
| `electron/ipc/channels.ts` | IPC 通道名语义不变（`claude:apply-all` 等仍有效） |
| `electron/preload.ts` | 暴露的 API 不变 |
| `electron/claude/paths.ts` | 3P config 路径不变 |
| `electron/claude/env-writer.ts` | Claude Code CLI 逻辑不变（已经是直连） |

---

## 四、向后兼容

| 场景 | 处理方式 |
|------|---------|
| **存量用户升级** | `migrations.ts` 自动将 profile 从 `127.0.0.1` 改写为 `api.deepseek.com` |
| **新用户首次安装** | `buildGatewayProfile` 直接写入 DeepSeek URL + 真实 API Key |
| **用户改 API Key** | Settings → "保存并应用" → `updateClaudeDesktopApiKey` 同步到 profile |
| **卸载** | `removeClaudeDesktopConfig` 检查 `__codexSwitch: "managed"` 标记后删除 |
| **Claude Desktop 未安装** | 和之前一样 — 配置静默写入 profile 文件，等用户安装后自动生效 |

---

## 五、涉及的测试文件

| 测试文件 | 操作 |
|----------|------|
| `tests/unit/anthropic-relay.test.ts` | **删除**（被测模块已删除） |
| `tests/unit/desktop-writer.test.ts` | **修改** — 断言从 port/127.0.0.1/PLACEHOLDER_KEY 改为 apiKey/deepseek.com/__codexSwitch |
| `tests/unit/server.test.ts` | **修改** — 移除 anthropic 路由测试 |
| `tests/unit/env-writer.test.ts` | **不变** |

---

## 六、风险 & 注意事项

1. **模型支持确认**：DeepSeek 的 `/anthropic/v1/messages` 端点已稳定支持 SSE 流式
   和 Anthropic Messages API 格式，Claude Desktop 直接调用没有问题（Claude Code CLI
   已验证同一端点）。

2. **不再需要 tools strip**：之前代理层删 `tools` / `tool_choice` 是因为 DeepSeek
   不认识 Claude 的专有工具导致工具循环。直连后 DeepSeek 端点同样不认识这些工具，
   但 DeepSeek 端点可能会正确处理（返回 error 或忽略）。如果工具循环问题仍存在，
   可能需要向 DeepSeek 团队反馈。短期不影响（之前日志显示 `end_turn` 正常）。

3. **不再需要 max_tokens clamp**：直连后 Claude Desktop 的 `max_tokens` 由
   DeepSeek 端点处理，TASK-051 修复的 max_tokens 穿透问题自然消除。

4. **API Key 安全**：profile JSON 中直接存真实 API Key（不像之前用 placeholder）。
   权限应设为 `0o600`。`desktop-writer.ts` 已使用 `writeJsonObject` 写入，但需
   显式加 `chmod 0o600` 调用。

5. **cc-switch 共存**：PROFILE_ID 仍为 `00000000-0000-4000-8000-0000c0dec501`，
   与 cc-switch 的 profile ID 不同，两者可共存。但用户若在两个工具间切换，
   同一时刻只有一个 `appliedId` 生效。

6. **配置文件大小**：改动主要在 electron 主进程侧，渲染进程仅小幅度 UI 适配。
   整体代码量 **净减少** ~400 行（删除 anthropic-relay.ts + server.ts 路由移除，
   仅 desktop-writer.ts 小改）。

---

## 七、实施顺序

1. **改 `desktop-writer.ts`**（profile 模板 + 函数签名）
2. **改 `detect.ts`**（检测条件）
3. **改 `store.ts`**（移除 modelMap）
4. **改 `main.ts`**（移除代理 wiring）
5. **改 `server.ts`**（移除 `/anthropic/*` 路由）
6. **删除 `anthropic-relay.ts`**
7. **改前端组件**（UI 文案 + 简化 Desktop 分区）
8. **改测试文件**（更新断言 + 删除 relay 测试）
9. **加 migrations.ts**（存量用户迁移）
10. **跑全量测试 + typecheck + lint**
