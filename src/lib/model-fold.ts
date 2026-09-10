/**
 * 旧模型名折叠（v3.0.0，由 `deepseek-models.ts` 泛化而来）。
 *
 * 供应商下线的模型名仍可能留在用户的持久化配置里，而它已不在下拉选项中。若不折叠：
 *  - Codex 默认模型下拉匹配不到 option → 渲染成空白
 *  - Claude 模型映射弹窗把它当成「自定义值」→ 渲染 `✏️ 自定义…` + 输入框（还挤压布局）
 *
 * 折叠规则来自供应商描述符的 `retiredPrefixes`，此处只实现算法——
 * 描述符要经 IPC 传输，不能携带函数。
 *
 * ⚠️ **只影响显示**：存储仅在用户点保存时才更新，不会主动改写存量配置。
 * （v3.0.0 删掉了 `retiredModels` 精确匹配分支——没有任何供应商声明过它，是死代码。）
 * ⚠️ 仅对声明了折叠规则的供应商生效（如 DeepSeek）。`custom` 供应商可能合法地手填
 *   `deepseek-*` 名，其描述符不声明规则，因而不会被折叠。
 */
/** 按该供应商的规则折叠单个模型名。 */
// `ProviderDescriptor` 由 src/types/global.d.ts 全局声明（无需 import）
export function foldModel(model: string, descriptor?: ProviderDescriptor | null): string {
  if (!descriptor) return model;
  const prefix = descriptor.codex.retiredPrefixes?.find((p: string) => model.startsWith(p));
  if (prefix) {
    // 前缀规则统一折叠到该供应商的默认模型
    return descriptor.codex.defaultModel;
  }
  return model;
}

/** 按该供应商的规则折叠整份「槽位 → 模型名」映射。 */
export function foldModelMap(
  mapping: Record<string, string>,
  descriptor?: ProviderDescriptor | null,
): Record<string, string> {
  if (!descriptor) return { ...mapping };
  const out: Record<string, string> = {};
  for (const [slot, model] of Object.entries(mapping)) out[slot] = foldModel(model, descriptor);
  return out;
}
