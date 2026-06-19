# DESIGN: Claude Desktop / Claude Code CLI 接入 Agnes AI + Settings 重构

> 状态：提案  
> 日期：2026-06-19  
> 版本：v2.0  
> 原则：每个工具有自己的供应商设置，清晰独立，互不干扰

---

## 1. Settings 页面新布局

```
┌─────────────────────────────────────────────────┐
│  设置                                           │
├─────────────────────────────────────────────────┤
│  🔑 AI 供应商设置                                │
│  ┌─────────────────────────────────────────────┐│
│  │ 供应商  [DeepSeek ▼]                        ││
│  │ API Key 当前 sk-3…99ca                      ││
│  │ 新的 [_______________] [保存]               ││
│  │ 在 platform.deepseek.com 获取 API Key       ││
│  └─────────────────────────────────────────────┘│
│                                                  │
│  📟 Codex 接入                                   │
│  ┌─────────────────────────────────────────────┐│
│  │ 接入状态 ● DeepSeek                         ││
│  │ 供应商  [DeepSeek ▼]                        ││
│  │ 默认模型 [DeepSeek V4 Flash ▼]              ││
│  │ 端口     [11435]                            ││
│  │ ☑ 拦截后台建议请求                           ││
│  │ [切换到 OpenAI 官方]      [保存并应用]       ││
│  └─────────────────────────────────────────────┘│
│                                                  │
│  🖥  Claude Desktop 接入                          │
│  ┌─────────────────────────────────────────────┐│
│  │ 接入状态 ● DeepSeek                         ││
│  │ 供应商  [DeepSeek ▼]                        ││
│  │ 默认模型 [Claude Sonnet → deepseek-v4-pro]  ││
│  │          [管理模型映射…]                     ││
│  │ [保存并应用]  重启 Claude Desktop 生效       ││
│  └─────────────────────────────────────────────┘│
│                                                  │
│  ⌨️  Claude Code CLI 接入                        │
│  ┌─────────────────────────────────────────────┐│
│  │ 接入状态 ● DeepSeek                         ││
│  │ 供应商  [DeepSeek ▼]                        ││
│  │ 默认模型 [Claude Sonnet → deepseek-v4-pro]  ││
│  │          [管理模型映射…]                     ││
│  │ [保存并应用]  新终端窗口生效                  ││
│  └─────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

---

## 2. 三张卡片的设计

### 2.1 AI 供应商设置（全局）

就是现在的供应商下拉 + API Key 输入。选中哪个供应商，下面 API Key 框跟着切。

- 选 DeepSeek → 显示 DeepSeek Key 输入
- 选 Agnes → 显示 Agnes Key 输入
- 两个 Key 都存在钥匙串里，切换时不需重填

### 2.2 Codex 接入卡片

| 元素               | 说明                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------- |
| 接入状态           | 只读标签：当前实际生效的供应商（OpenAI / DeepSeek / Agnes）                               |
| 供应商             | 下拉框：DeepSeek / Agnes。和 AI 供应商设置联动——那边改这里跟着变                          |
| 默认模型           | 下拉框，根据供应商联动——DeepSeek 时显示 V4 Flash/V4 Pro，Agnes 时显示 Agnes 2.0/1.5 Flash |
| 端口               | 数字输入，默认 11435                                                                      |
| 拦截建议请求       | 勾选框                                                                                    |
| 切换到 OpenAI 官方 | 按钮。仅在有 `install-original` 备份时显示，点击切回 api.openai.com                       |
| 保存并应用         | 写入 config.toml + 启动/重启代理。**供应商切换时不重写 config.toml，不重启**              |

**接入状态的判断逻辑**：

- `~/.codex/config.toml` 的 `base_url` 包含 `127.0.0.1` 且当前供应商是 DeepSeek → 显示 "DeepSeek"
- 包含 `127.0.0.1` 且当前供应商是 Agnes → 显示 "Agnes"
- 不包含 `127.0.0.1` → 显示 "OpenAI 官方"

### 2.3 Claude Desktop 接入卡片

| 元素       | 说明                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| 接入状态   | 只读标签：DeepSeek / Agnes（检测 `Claude-3p/configLibrary/<PROFILE_ID>.json` 的 `inferenceGatewayBaseUrl`） |
| 供应商     | 下拉框：DeepSeek / Agnes                                                                                    |
| 默认模型   | 显示当前映射关系，如 `Claude Sonnet → deepseek-v4-pro`。点击「管理模型映射」弹出小窗                        |
| 保存并应用 | 重写 3P profile，提示「重启 Claude Desktop 生效」                                                           |

**模型映射弹窗**：一个小浮层，列出 Claude 模型 → 实际模型的对应关系：

```
Claude Opus 4   → [deepseek-v4-pro     ▼]
Claude Sonnet 4 → [deepseek-v4-flash   ▼]
Claude Haiku 4  → [deepseek-v4-flash   ▼]
```

每行右边的下拉框可选的值根据供应商联动：

- DeepSeek: `deepseek-v4-pro`, `deepseek-v4-flash`
- Agnes: `agnes-2.0-flash`, `agnes-1.5-flash`

用户可逐行修改，关闭弹窗自动保存到内存。点「保存并应用」时随 3P profile 一起写入。

### 2.4 Claude Code CLI 接入卡片

和 Claude Desktop 一样：接入状态 + 供应商 + 默认模型映射 + 保存并应用。

区别：保存时写 `~/.claude/settings.json`，提示「新终端窗口生效」。

---

## 3. 供应商 + 模型联动

一个关键规则：**供应商切换时，默认模型和模型映射自动跟着变。**

```
用户把 Codex 卡片的供应商从 DeepSeek 切到 Agnes
  → 默认模型自动变成 Agnes 2.0 Flash
  → 下面的模型列表也跟着变

Claude Desktop / CLI 同理
  → 模型映射弹窗里的可选模型从 DeepSeek 系列变成 Agnes 系列
```

联动逻辑在前端完成——供应商 `onChange` 事件触发对应卡片的状态更新。

---

## 4. 接入状态判断

### 4.1 Codex

```
读 ~/.codex/config.toml
  base_url 含 127.0.0.1 且 activeModelMapping['codex-switch'].provider === 'deepseek' → DeepSeek
  base_url 含 127.0.0.1 且 activeModelMapping['codex-switch'].provider === 'agnes'   → Agnes
  base_url 不含 127.0.0.1 → OpenAI 官方
```

### 4.2 Claude Desktop

```
读 Claude-3p/configLibrary/<PROFILE_ID>.json
  inferenceGatewayBaseUrl 含 api.deepseek.com → DeepSeek
  inferenceGatewayBaseUrl 含 apihub.agnes-ai.com → Agnes
  无此文件或无 inferenceGatewayBaseUrl → 未配置
```

### 4.3 Claude Code CLI

```
读 ~/.claude/settings.json
  env.ANTHROPIC_BASE_URL 含 api.deepseek.com → DeepSeek
  env.ANTHROPIC_BASE_URL 含 apihub.agnes-ai.com → Agnes
  无此文件 → 未配置
```

---

## 5. 数据流

```
用户操作 Codex 卡片：切供应商 → 选模型 → 点保存并应用
  │
  ├─ 写 activeModelMapping['codex-switch'] → { model, provider }
  ├─ 如果端口变了 → 重启代理
  ├─ 如果供应商变了 → proxy.updateOptions({ apiKey, upstreamBase })
  ├─ config.toml 不重写（中间模型 codex-switch 不变）
  └─ 仪表盘状态更新

用户操作 Claude Desktop 卡片：切供应商 → 选模型映射 → 点保存并应用
  │
  ├─ 重写 3P profile
  │   inferenceGatewayBaseUrl → https://<provider-host>/anthropic
  │   inferenceGatewayApiKey → <provider-key>
  │   inferenceModels → 对应供应商的模型名
  └─ 仪表盘状态更新
```

---

## 6. 和旧方案的差异

| 旧方案（v1.13.0 当前）                | 新方案（本设计）           |
| ------------------------------------- | -------------------------- |
| 一个全局 AI 供应商下拉，全家桶统一    | 每个工具有自己的供应商选择 |
| Claude Desktop/CLI 的供应商不可独立选 | 每张卡片独立选供应商和模型 |
| 没有接入状态显示                      | 每张卡片顶部有状态指示灯   |
| 切换供应商时模型不同步                | 供应商 + 模型联动          |

---

## 7. 一句话

> 每张卡片管一个工具。Codex、Claude Desktop、Claude Code CLI 各管各的供应商和模型，互不干扰，清晰独立。
