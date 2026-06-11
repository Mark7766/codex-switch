import fs from 'node:fs/promises';
import log from 'electron-log';

import { getPreferences, setPreferences } from './store';
import { detectAll } from '../claude/detect';
import { writeClaudeCliConfig } from '../claude/env-writer';
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

    const currentUrl = typeof profile['inferenceGatewayBaseUrl'] === 'string'
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
 */
export async function startupApplyClaude(apiKey: string): Promise<void> {
  const prefs = getPreferences();
  if (!apiKey) return; // No API key configured yet — Setup wizard not done

  const result = await detectAll();

  if (prefs.claudeCli.enabled && result.claudeCli.installed) {
    try {
      await writeClaudeCliConfig(apiKey, prefs.claudeCli.envVars);
      log.info('[startup] 已为 Claude Code CLI 重新写入配置');
    } catch (e) {
      log.warn('[startup] Claude Code CLI 配置写入失败：', (e as Error).message);
    }
  }

  if (prefs.claudeDesktop.enabled && result.claudeDesktop.installed) {
    try {
      await writeClaudeDesktopConfig(apiKey);
      log.info('[startup] 已为 Claude Desktop 重新写入配置');
    } catch (e) {
      log.warn('[startup] Claude Desktop 配置写入失败：', (e as Error).message);
    }
  }
}
