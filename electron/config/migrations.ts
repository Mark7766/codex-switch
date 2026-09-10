import fs from 'node:fs/promises';
import log from 'electron-log';

import { getPreferences, setPreferences, setMigrationFlag } from './store';
import { getKey } from './secrets';
import { getProvider } from './providers';
import { detectAll } from '../claude/detect';
import {
  writeClaudeCliConfig,
  resolveEnvVars,
  readCurrentCliEnvVars,
  inferProviderFromModel,
} from '../claude/env-writer';
import { writeClaudeDesktopConfig, PROFILE_ID } from '../claude/desktop-writer';
import { claudeDesktopProfilePath } from '../claude/paths';
import { configTomlPath } from '../codex/paths';
import { writeCodexConfig } from '../codex/writer';

/**
 * Run the v1.3.0 one-time migration:
 * - Detect installed Claude tools
 * - Auto-apply config for any that are already installed
 * - Mark migration as done so it never re-runs
 *
 * Returns whether the migration actually ran (false if already done).
 */
export async function runV130ClaudeMigration(apiKey: string): Promise<boolean> {
  const prefs = getPreferences();
  if (prefs.migrations?.v130_claude) return false;

  log.info('[migrations] 运行 v1.3.0 Claude 迁移…');

  try {
    if (apiKey) {
      const result = await detectAll();

      if (result.claudeCli.installed && !result.claudeCli.configApplied) {
        try {
          await writeClaudeCliConfig(apiKey, prefs.claudeCli.envVars);
          log.info('[migrations] 已为 Claude Code CLI 写入环境变量');
        } catch (e) {
          log.warn('[migrations] Claude Code CLI 配置写入失败：', (e as Error).message);
        }
      }

      if (result.claudeDesktop.installed && !result.claudeDesktop.configApplied) {
        try {
          await writeClaudeDesktopConfig(apiKey);
          log.info('[migrations] 已为 Claude Desktop 写入 claude_desktop_config.json');
        } catch (e) {
          log.warn('[migrations] Claude Desktop 配置写入失败：', (e as Error).message);
        }
      }
    }
  } catch (e) {
    log.warn('[migrations] v1.3.0 检测阶段失败：', (e as Error).message);
  }

  setMigrationFlag('v130_claude');
  log.info('[migrations] v1.3.0 Claude 迁移完成');
  return true;
}

/**
 * v1.6.0 one-time migration: rewrite existing Claude Desktop gateway profiles
 * that point to the local proxy (127.0.0.1 / localhost) to point directly to
 * api.deepseek.com/anthropic with the real DeepSeek API key.
 *
 * Also adds the __codexSwitch:"managed" marker so the newer remove logic works.
 */
export async function runV160ClaudeDesktopMigration(apiKey: string): Promise<boolean> {
  const prefs = getPreferences();
  if (prefs.migrations?.v160_claudeDesktopDirect) return false;

  log.info('[migrations] 运行 v1.6.0 Claude Desktop 直连迁移…');

  try {
    if (!apiKey) {
      log.info('[migrations] v1.6.0 跳过 — 尚无 API Key');
      return false;
    }

    const profilePath = claudeDesktopProfilePath(PROFILE_ID);
    let profile: Record<string, unknown>;
    try {
      const raw = await fs.readFile(profilePath, 'utf-8');
      profile = JSON.parse(raw) as Record<string, unknown>;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        setMigrationFlag('v160_claudeDesktopDirect');
        log.info('[migrations] v1.6.0 完成（profile 不存在，无需迁移）');
        return true;
      }
      throw e;
    }

    const currentUrl =
      typeof profile['inferenceGatewayBaseUrl'] === 'string'
        ? profile['inferenceGatewayBaseUrl']
        : '';
    const needsMigration =
      currentUrl.includes('127.0.0.1') ||
      currentUrl.includes('localhost') ||
      !profile['__codexSwitch'];

    if (!needsMigration) {
      setMigrationFlag('v160_claudeDesktopDirect');
      log.info('[migrations] v1.6.0 完成（profile 已指向外部端点，无需迁移）');
      return true;
    }

    await writeClaudeDesktopConfig(apiKey);
    log.info('[migrations] v1.6.0 Claude Desktop profile 已迁移至直连 DeepSeek');
  } catch (e) {
    log.warn('[migrations] v1.6.0 Claude Desktop 迁移失败：', (e as Error).message);
  }

  setMigrationFlag('v160_claudeDesktopDirect');
  log.info('[migrations] v1.6.0 Claude Desktop 直连迁移完成');
  return true;
}

/**
 * v3.0.0 one-time migration: rewrite a Codex `config.toml` that still points at the
 * **local proxy** (`127.0.0.1` / `localhost`) to the current provider's direct template.
 * Flag-guarded, never re-runs.
 *
 * 为什么这条迁移在 v3.0.0 是最关键的一条：本地代理已整个删除，而 GLM 在 v3.0.0 之前
 * **走的就是本地代理**（`http://127.0.0.1:<port>/v1`）。所以存量 GLM 用户的 config.toml
 * 指向一个已不存在的端口——不迁移的话他们的 Codex 直接不可用。DeepSeek 用户在 v2.0.0 已
 * 迁过，通常已是直连（此迁移对他们是 no-op）；v1.9.x 及更早的用户则借此一并修好。
 *
 * 迁移前照例备份（`writeCodexConfig` 内部做），并且只做「改写为当前供应商的直连配置」，
 * 不动用户 vs 选择。
 */
export async function runV300DirectMigration(): Promise<boolean> {
  const prefs = getPreferences();
  if (prefs.migrations?.v300_direct) return false;

  const provider = getProvider(prefs.provider);
  log.info('[migrations] 运行 v3.0.0 直连迁移（供应商=%s）…', provider.id);

  try {
    const apiKey = await getKey(provider).catch(() => '');
    if (apiKey) {
      let current = '';
      try {
        current = await fs.readFile(configTomlPath(), 'utf8');
      } catch {
        // config.toml 不存在 → 无需迁移
      }
      const stillProxy = current.includes('127.0.0.1') || current.includes('localhost');
      if (stillProxy) {
        await writeCodexConfig({
          model: prefs.defaultModel,
          apiKey,
          provider: provider.id,
          customCodexBaseUrl: prefs.customProvider?.codexBaseUrl,
          maxBackupsPerFile: prefs.maxBackupsPerFile,
        });
        log.info('[migrations] Codex config 已迁移为 %s 直连', provider.label);
      }
    }
  } catch (e) {
    log.warn('[migrations] v3.0.0 直连迁移失败：', (e as Error).message);
  }

  setMigrationFlag('v300_direct');
  log.info('[migrations] v3.0.0 直连迁移完成');
  return true;
}

/**
 * Startup auto-apply: runs on every app launch (not one-time).
 * Re-applies Claude CLI / Desktop configs if the user has them enabled,
 * ensuring the config is always present even if external tools overwrote it.
 *
 * v1.14.0: reads per-tool provider pref and fetches the matching API key,
 * so GLM/Agnes users don't get silently overwritten to DeepSeek on restart.
 */
export async function startupApplyClaude(): Promise<void> {
  const prefs = getPreferences();
  const result = await detectAll();

  if (prefs.claudeCli.enabled && result.claudeCli.installed) {
    // 从 ~/.claude/settings.json 读取用户实际使用的模型，
    // 防止偏好丢失（如重装）后用默认值覆盖用户自定义的模型（如 glm-5.1 → glm-5.2）
    const currentEnvVars = await readCurrentCliEnvVars();
    let envVarsToUse = prefs.claudeCli.envVars;
    let cp = prefs.claudeCliProvider ?? 'deepseek';

    if (currentEnvVars?.anthropicModel) {
      const actualProvider = inferProviderFromModel(currentEnvVars.anthropicModel);
      // 偏好中的供应商与实际模型不匹配（偏好丢失/重装场景）→ 用实际模型修正
      if (actualProvider && actualProvider !== cp) {
        log.info(
          '[startup] claudeCliProvider 不匹配：偏好=%s，实际模型=%s → 修正为 %s',
          cp,
          currentEnvVars.anthropicModel,
          actualProvider,
        );
        cp = actualProvider;
        setPreferences({ claudeCliProvider: cp });
      }
      // 偏好中的 envVars 与实际 settings.json 不一致 → 用 settings.json 值修正
      if (currentEnvVars.anthropicModel !== prefs.claudeCli.envVars?.anthropicModel) {
        log.info(
          '[startup] envVars 不一致：偏好=%s，settings.json=%s → 用 settings.json 值修正',
          prefs.claudeCli.envVars?.anthropicModel,
          currentEnvVars.anthropicModel,
        );
        envVarsToUse = currentEnvVars;
        setPreferences({ claudeCli: { enabled: true, envVars: currentEnvVars } });
      }
    }

    // v3.0.0: 取 Key 走注册表。⚠️ 必须 .catch：此前这里没有兜底，keytar 抛错会冒泡到
    // main.ts 的调用点，把两个工具的启动配置**一起**静默跳过。
    const ck = await getKey(cp).catch(() => '');
    if (ck) {
      try {
        // v1.14.1: 只在 envVars 为空或属于其他供应商时才用默认值，保护用户手动选择的模型
        const { envVars, changed } = resolveEnvVars(envVarsToUse, cp);
        if (changed) {
          setPreferences({ claudeCli: { enabled: true, envVars } });
        }
        await writeClaudeCliConfig(ck, envVars, cp);
        log.info('[startup] 已为 Claude Code CLI 重新写入配置（provider=%s）', cp);
      } catch (e) {
        log.warn('[startup] Claude Code CLI 配置写入失败：', (e as Error).message);
      }
    }
  }

  if (prefs.claudeDesktop.enabled && result.claudeDesktop.installed) {
    const dp = prefs.claudeDesktopProvider ?? 'deepseek';
    const dk = await getKey(dp).catch(() => '');
    if (dk) {
      try {
        await writeClaudeDesktopConfig(dk, dp);
        log.info('[startup] 已为 Claude Desktop 重新写入配置（provider=%s）', dp);
      } catch (e) {
        log.warn('[startup] Claude Desktop 配置写入失败：', (e as Error).message);
      }
    }
  }
}
