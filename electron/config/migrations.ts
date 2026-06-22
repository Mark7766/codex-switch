import fs from 'node:fs/promises';
import log from 'electron-log';

import { getPreferences, setPreferences } from './store';
import { getAgnesKey, getGlmKey, getApiKey, getPackyCodeKey } from './secrets';
import { detectAll } from '../claude/detect';
import {
  writeClaudeCliConfig,
  resolveEnvVars,
  readCurrentCliEnvVars,
  inferProviderFromModel,
} from '../claude/env-writer';
import { writeClaudeDesktopConfig, PROFILE_ID } from '../claude/desktop-writer';
import { claudeDesktopProfilePath } from '../claude/paths';

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

  setPreferences({ migrations: { v130_claude: true } });
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
        setPreferences({ migrations: { v160_claudeDesktopDirect: true } });
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
      setPreferences({ migrations: { v160_claudeDesktopDirect: true } });
      log.info('[migrations] v1.6.0 完成（profile 已指向外部端点，无需迁移）');
      return true;
    }

    await writeClaudeDesktopConfig(apiKey);
    log.info('[migrations] v1.6.0 Claude Desktop profile 已迁移至直连 DeepSeek');
  } catch (e) {
    log.warn('[migrations] v1.6.0 Claude Desktop 迁移失败：', (e as Error).message);
  }

  setPreferences({ migrations: { v160_claudeDesktopDirect: true } });
  log.info('[migrations] v1.6.0 Claude Desktop 直连迁移完成');
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

    const ck =
      cp === 'agnes'
        ? await getAgnesKey()
        : cp === 'glm'
          ? await getGlmKey()
          : cp === 'packycode'
            ? await getPackyCodeKey()
            : await getApiKey();
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
    const dk =
      dp === 'agnes'
        ? await getAgnesKey()
        : dp === 'glm'
          ? await getGlmKey()
          : dp === 'packycode'
            ? await getPackyCodeKey()
            : await getApiKey();
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
