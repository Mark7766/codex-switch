/**
 * Strip Codex Switch's managed routing from a `~/.codex/config.toml` string,
 * restoring Codex to its native OpenAI default (no `model_provider`, no managed
 * provider block). Used by `restoreOriginalConfig()` (the "切换到 OpenAI 官方"
 * action) and unit-tested in isolation.
 *
 * Codex Switch currently manages two provider shapes — DeepSeek official direct
 * (`[model_providers.deepseek]`) and custom-direct / proxy (`[model_providers.custom]`).
 * Both use a provider block that must be removed wholesale. Everything the user
 * owns (marketplaces, plugins, mcp_servers, projects, desktop, notify, and any
 * other `[model_providers.X]`) is preserved byte-for-byte.
 */

type Mode = 'top' | 'features' | 'drop' | 'pass';

/** Managed top-level keys Codex Switch writes. Anchored to `\s*=` so `model`
 *  won't also match `model_provider`, and `model_provider` won't match inside a
 *  section body (those are only stripped when `mode === 'top'`). */
const MANAGED_TOP_KEY =
  /^\s*(model|model_provider|model_reasoning_effort|model_catalog_json|model_context_window|model_auto_compact_token_limit|preferred_auth_method|forced_login_method)\s*=/;

/** Managed keys inside the `[features]` section. */
const MANAGED_FEATURES_KEY = /^\s*(enable_request_compression|remote_compaction_v2)\s*=/;

/** Provider blocks Codex Switch writes (anything else is treated as user-owned). */
const MANAGED_PROVIDER_BLOCK = /^model_providers\.(deepseek|custom)$/;

/** TOML table header, allowing leading whitespace for robustness. */
const SECTION_HEADER = /^\s*\[([^\]\n]+)\]/;

export function sanitizeManagedConfig(configText: string): string {
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
      if (MANAGED_PROVIDER_BLOCK.test(section)) {
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
    out.push(line);
  }

  if (mode === 'features') flushFeatures();
  return out.join('\n');
}
