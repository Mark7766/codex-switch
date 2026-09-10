/**
 * 剥离 `~/.codex/config.toml` 里 Codex Switch 写的**顶层受管键**与 `[features]` 受管键，
 * 让 Codex 回落到它内置的 OpenAI 官方行为。由 `restoreOriginalConfig()`（「切换到 OpenAI 官方」）
 * 调用，另有单测直接覆盖。
 *
 * ⚠️ **这里不删 `[model_providers.*]` 块，任何路径都不该删。** 两个理由：
 *   1. **Codex 是按对话记住 `model_provider` 的**（会话文件 `payload.model_provider`）——
 *      删掉某家的块，那家的历史对话再打开就报 `Model provider X not found`。
 *   2. 删块本来就多余：**未被选中的块是惰性的**，Codex 只解析 `model_provider` 指向的那一家。
 *      切回官方只需清掉顶层 `model_provider`。这正是「供应商互切」能工作的同一套机制。
 *
 * v2.3.0 的 BUG-007（点「切换到 OpenAI 官方」后 Codex 仍连着 DeepSeek，报
 * `but you passed gpt-6-astra`）**要害是顶层 `model_provider` 残留，不是块**——删顶层键就已切回官方。
 * 详见 ADR-034 / ADR-036。
 *
 * 用户自有内容（`notify` / `[mcp_servers.*]` / `[projects.*]` / `[desktop]` / 自建的
 * `[model_providers.X]`）一律逐字保留。
 */

type Mode = 'top' | 'features' | 'drop' | 'pass';

/** Managed top-level keys Codex Switch writes. Anchored to `\s*=` so `model`
 *  won't also match `model_provider`, and `model_provider` won't match inside a
 *  section body (those are only stripped when `mode === 'top'`). */
const MANAGED_TOP_KEY =
  /^\s*(model|model_provider|model_reasoning_effort|model_catalog_json|model_context_window|model_auto_compact_token_limit|preferred_auth_method|forced_login_method)\s*=/;

/** Managed keys inside the `[features]` section. */
const MANAGED_FEATURES_KEY = /^\s*(enable_request_compression|remote_compaction_v2)\s*=/;

/** TOML table header, allowing leading whitespace for robustness. */
const SECTION_HEADER = /^\s*\[([^\]\n]+)\]/;

/**
 * Codex Switch 自己写的文件头注释。切回 OpenAI 官方后留着它会误导人——文件里写着
 * 「由 Codex Switch 自动生成 · DeepSeek 直连」，实际却已改走 OpenAI。属受管内容，一并剥离。
 */
const MANAGED_HEADER_COMMENT = /^\s*#\s*Codex CLI 配置（由 Codex Switch 自动生成/;

export interface SanitizeOptions {
  /**
   * 要剥离哪些受管供应商的 `[model_providers.X]` 段，传**供应商 id**（如 `'deepseek'` /
   * `'ZAI'` / `'custom'`，即注册表里的 `codex.providerId`）。
   *
   * **默认 `[]` = 一块都不剥**，这正是「切换到 OpenAI 官方」要的（见本文件顶部说明）。
   * 写入路径传 `[当前要换掉的那一家]`。**永远不要传「全部」**——删块会让那家的历史对话失效。
   */
  stripProviderBlocks?: string[];
}

export function sanitizeManagedConfig(configText: string, opts: SanitizeOptions = {}): string {
  // 传进来的是供应商 id，而段名是 `model_providers.<id>` —— 这里补上前缀再比对
  const stripIds = new Set((opts.stripProviderBlocks ?? []).map((id) => `model_providers.${id}`));
  const shouldStripBlock = (section: string): boolean => stripIds.has(section);

  const lines = configText.split('\n');
  const out: string[] = [];
  let mode: Mode = 'top';
  let featuresHeaderWanted = false;
  let featuresBody: string[] = [];

  const flushFeatures = (): void => {
    // 只在该段仍有「有效内容」（非空行）时才保留段头；模板尾部 `\n` 分割出的
    // 空行不代表内容，不应让已被清空的管理段头残留。
    const hasContent = featuresBody.some((l) => l.trim() !== '');
    if (featuresHeaderWanted && hasContent) {
      out.push('[features]', ...featuresBody);
    }
    featuresHeaderWanted = false;
    featuresBody = [];
  };

  for (const line of lines) {
    const header = SECTION_HEADER.exec(line);
    if (header) {
      if (mode === 'features') flushFeatures();
      const section = header[1]!;
      if (shouldStripBlock(section)) {
        mode = 'drop';
        continue;
      }
      if (section === 'features') {
        mode = 'features';
        featuresHeaderWanted = true;
        continue;
      }
      mode = 'pass';
      out.push(line);
      continue;
    }

    if (mode === 'features') {
      if (MANAGED_FEATURES_KEY.test(line)) continue;
      featuresBody.push(line);
      continue;
    }
    if (mode === 'drop') continue;
    if (mode === 'top' && MANAGED_TOP_KEY.test(line)) continue;
    if (MANAGED_HEADER_COMMENT.test(line)) continue;
    out.push(line);
  }

  if (mode === 'features') flushFeatures();
  return out.join('\n');
}
