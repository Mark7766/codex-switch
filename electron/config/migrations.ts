import log from 'electron-log';

import { getPreferences, setPreferences } from './store';
import { getApiKey } from './secrets';
import { detectAll } from '../claude/detect';
import { writeClaudeCliConfig } from '../claude/env-writer';
import { writeClaudeDesktopConfig } from '../claude/desktop-writer';

/**
 * Run the v1.3.0 one-time migration:
 * - Detect installed Claude tools
 * - Auto-apply config for any that are already installed
 * - Mark migration as done so it never re-runs
 *
 * Returns whether the migration actually ran (false if already done).
 */
export async function runV130ClaudeMigration(port: number): Promise<boolean> {
  const prefs = getPreferences();
  if (prefs.migrations?.v130_claude) return false;

  log.info('[migrations] 运行 v1.3.0 Claude 迁移…');

  try {
    const apiKey = await getApiKey();
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
          await writeClaudeDesktopConfig(port);
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
 * Startup auto-apply: runs on every app launch (not one-time).
 * Re-applies Claude CLI / Desktop configs if the user has them enabled,
 * ensuring the config is always present even if external tools overwrote it.
 */
export async function startupApplyClaude(port: number): Promise<void> {
  const prefs = getPreferences();
  const apiKey = await getApiKey();
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
      await writeClaudeDesktopConfig(port);
      log.info('[startup] 已为 Claude Desktop 重新写入配置');
    } catch (e) {
      log.warn('[startup] Claude Desktop 配置写入失败：', (e as Error).message);
    }
  }
}
