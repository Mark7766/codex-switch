# DESIGN: 供应商零中断切换

> 状态：提案  
> 日期：2026-06-19  
> 版本：v1.0  
> 原则：Codex 和 Codex Switch 都不重启，切供应商瞬间生效

---

## 1. 问题

当前的供应商切换需要两步：

1. 用户点"保存并应用" → 写入 `~/.codex/config.toml`（`model = "agnes-2.0-flash"`）
2. **Codex 需要重启**才能读到新 model。Codex 是启动时一次性加载 config.toml，不动态重载

切一次供应商就要重启 Codex，体验不好。

---

## 2. 设计：中间模型 + 动态映射

### 核心思路

`~/.codex/config.toml` 里的 model **永远不变**。写死一个"中间模型名"，Codex 每次请求都带它。代理收到请求后，动态查找这个中间模型"当前生效的映射"——决定发给 DeepSeek 还是 Agnes。

```
config.toml 固定写入:
  model = "codex-switch"       ← 永远不变

Codex 发请求:
  { model: "codex-switch" }

代理收到请求:
  "codex-switch" → 查生效映射表 → 当前指向 deepseek-v4-flash @ DeepSeek
                                → 或指向 agnes-2.0-flash @ Agnes
```

用户切换供应商 → 只改内存里的映射表 → 下一条请求立即生效。

### Codex 不重启，代理不重启

- config.toml 从来没变过，Codex 不需要重读
- 代理端口没变过，不需要 rebind
- 映射表在内存里，改了就生效

---

## 3. 生效映射（Active Mapping）

在 `electron/config/store.ts` 中新增一个字段：

```typescript
interface UserPreferences {
  provider: 'deepseek' | 'agnes'; // 当前选择的供应商
  activeMapping: Record<
    string,
    {
      // 中间模型 → 实际模型 + 供应商
      model: string;
      provider: 'deepseek' | 'agnes';
    }
  >;
}
```

默认值：

```typescript
activeMapping: {
  'codex-switch': {
    model: 'deepseek-v4-flash',
    provider: 'deepseek',
  },
}
```

用户切换供应商时，只更新 `activeMapping`：

```typescript
// 用户选 Agnes
activeMapping: {
  'codex-switch': {
    model: 'agnes-2.0-flash',
    provider: 'agnes',
  },
}

// 用户选回 DeepSeek
activeMapping: {
  'codex-switch': {
    model: 'deepseek-v4-flash',
    provider: 'deepseek',
  },
}
```

---

## 4. 请求处理流程

```
Codex Desktop 发请求:
  { model: "codex-switch", messages: [...], ... }
       │
       ▼
代理 resolveModel():
  1. 查 modelMapping（gpt-5-codex → codex-switch）  ← 不变
  2. 拿到中间模型 "codex-switch"
  3. 查 activeMapping["codex-switch"]
     → { model: "deepseek-v4-flash", provider: "deepseek" }
  4. 选 API Key: provider === 'deepseek' → deepseekKey
                provider === 'agnes'   → agnesKey
  5. 选上游:    provider === 'deepseek' → api.deepseek.com
                provider === 'agnes'   → apihub.agnes-ai.com
  6. 实际请求:  POST https://api.deepseek.com/v1/chat/completions
               { model: "deepseek-v4-flash", messages: [...] }
```

**Codes 到 DeepSeek/Agnes 的映射是两层**：

```
第一层（不变）:   gpt-5-codex → codex-switch
第二层（动态）:   codex-switch → deepseek-v4-flash @ DeepSeek
                             → agnes-2.0-flash @ Agnes   （切换后）
```

---

## 5. config.toml 写入策略

`codex/writer.ts` 的 TEMPLATE 中，model 字段固定写 `codex-switch`：

```toml
model_provider = "custom"
model = "codex-switch"       ← 永远不变
model_reasoning_effort = "xhigh"
```

**不再根据供应商改变**。用户切换供应商时不触发 config.toml 重写。

---

## 6. 兼容性

### 存量用户（config.toml 里 model 是 "deepseek-v4-flash"）

代理收到 `model: "deepseek-v4-flash"` → 查 `activeMapping` 中是否有 `"deepseek-v4-flash"` 的条目 → 没有 → **回退到旧行为**：按 model 名直接路由。

处理逻辑：

```
resolveModel():
  查 activeMapping[requestedModel]
    → 有: 用映射的 model + provider
    → 无: 直接返回 requestedModel，用默认 provider（deepseek）
```

这样存量用户不写 `codex-switch` 也能正常工作，不会断。

### 升级建议

新配置写 `codex-switch`，存量继续用 `deepseek-v4-flash`。用户下次"保存并应用"时自动升级到 `codex-switch`。

---

## 7. Settings UI

供应商下拉框下面，显示**当前生效的映射**（只读）：

```
AI 供应商:  [DeepSeek ▼]

当前生效映射:
  codex-switch → deepseek-v4-flash (DeepSeek)

切换供应商:
  立即生效，无需重启 Codex ✅
```

点"保存并应用"时：

1. 写 `store.set('activeMapping', newMapping)`
2. 调 `proxy.updateOptions({ apiKey, upstreamBase })`
3. **不写 config.toml**（model 没变）
4. **不重启代理**（端口没变）
5. 返回 `{ restarted: false }`

---

## 8. 模块变更

| 模块           | 改动                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `store.ts`     | +`activeMapping` 字段                                                                            |
| `server.ts`    | `resolveModel` 增加 activeMapping 查询层                                                         |
| `main.ts`      | `applyPreferencesTransaction` 移除 providerChanged 重启逻辑；切供应商只调 `updateOptions` 不重启 |
| `writer.ts`    | TEMPLATE model 改为 `codex-switch`                                                               |
| `Settings.tsx` | 供应商切换时更新 activeMapping；显示当前映射（只读）                                             |

改动量：~40 行。

---

## 9. 一句话

> config.toml 写死中间模型 `codex-switch`，代理在内存里动态路由。切供应商只改映射表，Codex 和代理都不重启，下一条消息就走新供应商。
