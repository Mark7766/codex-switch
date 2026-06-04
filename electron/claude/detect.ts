import fs from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import {
  claudeDesktopAppPaths,
  claudeDesktopConfigPath,
  claudeDesktopProfilePath,
  claudeDesktopStoreConfigPath,
  claudeCliDir,
  claudeCliSettingsPath,
  codexDesktopAppPaths,
  codexDir,
  shellProfilePaths,
} from './paths';
import { PROFILE_ID } from './desktop-writer';

const execAsync = promisify(exec);

const CODEX_SWITCH_BLOCK_START =
  '# --- Codex Switch: Claude Code CLI config (auto-generated, do not edit) ---';

export interface ToolStatus {
  /** Whether the tool binary / app bundle is installed on this machine. */
  installed: boolean;
  /** Whether Codex Switch has already written its configuration for this tool. */
  configApplied: boolean;
  /** Relevant config file or directory path for display in the UI. */
  configPath?: string;
  /** Shell profile file paths where env vars are written (Claude Code CLI only). */
  profilePaths?: string[];
}

export interface DetectResult {
  codexDesktop: ToolStatus;
  codexCli: ToolStatus;
  claudeCli: ToolStatus;
  claudeDesktop: ToolStatus;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function whichExists(cmd: string): Promise<boolean> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execAsync(`where ${cmd} 2>nul`);
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }
  // First try with the current (Electron-inherited) PATH — fast path.
  try {
    const { stdout } = await execAsync(`which ${cmd} 2>/dev/null`);
    if (stdout.trim().length > 0) return true;
  } catch {
    /* not found in current PATH — fall through to login-shell check */
  }
  // Fallback: spawn a login shell so we get the user's full PATH
  // (handles nvm, pnpm, brew, .local/bin, etc. that are set in .zshrc / .bash_profile).
  const userShell = process.env['SHELL'] ?? '/bin/zsh';
  try {
    const { stdout } = await execAsync(`${userShell} -lc "which ${cmd} 2>/dev/null"`, {
      timeout: 5000,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function anyPathExists(paths: string[]): Promise<boolean> {
  for (const p of paths) {
    if (await pathExists(p)) return true;
  }
  return false;
}

/**
 * Heuristic to detect if a tool is "installed" by checking if its process is currently running.
 * Useful for Microsoft Store apps where paths are versioned and restricted.
 */
async function isProcessRunning(processName: string): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  try {
    const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq ${processName}.exe" /NH`);
    return stdout.includes(processName);
  } catch {
    return false;
  }
}

async function detectCodexDesktop(): Promise<ToolStatus> {
  const installedByPath = await anyPathExists(codexDesktopAppPaths());
  const installedByProcess = installedByPath || (await isProcessRunning('Codex'));
  const configDir = codexDir();
  const configApplied =
    (await pathExists(configDir)) && (await pathExists(`${configDir}/config.toml`));
  return { installed: installedByProcess, configApplied, configPath: configDir };
}

async function detectCodexCli(): Promise<ToolStatus> {
  const installed = await whichExists('codex');
  const configDir = codexDir();
  const configApplied =
    (await pathExists(configDir)) && (await pathExists(`${configDir}/config.toml`));
  return { installed, configApplied, configPath: configDir };
}

async function detectClaudeCli(): Promise<ToolStatus> {
  const clauDir = claudeCliDir();
  const installed = (await whichExists('claude')) || (await pathExists(clauDir));
  const configApplied = installed && (await isClaudeCliConfigApplied());
  return {
    installed,
    configApplied,
    configPath: clauDir,
    profilePaths: process.platform !== 'win32' ? shellProfilePaths() : undefined,
  };
}

/**
 * Check whether Codex Switch has applied its Claude Code CLI configuration.
 * Primary: checks ~/.claude/settings.json for the __codexSwitch marker.
 * Fallback: checks shell profile files for the CODEX_SWITCH_BLOCK_START marker.
 */
async function isClaudeCliConfigApplied(): Promise<boolean> {
  // Primary: settings.json takes effect immediately (no terminal restart needed).
  try {
    const content = await fs.readFile(claudeCliSettingsPath(), 'utf-8');
    const cfg = JSON.parse(content) as Record<string, unknown>;
    if (cfg['__codexSwitch'] === 'managed') return true;
  } catch {
    /* file does not exist or invalid JSON — fall through */
  }

  if (process.platform === 'win32') {
    try {
      const { stdout } = await execAsync(
        'reg query "HKCU\\Environment" /v ANTHROPIC_BASE_URL 2>nul',
      );
      return stdout.includes('deepseek.com');
    } catch {
      return false;
    }
  }

  // Fallback: shell profile block (written as a secondary/backup mechanism).
  const profiles = shellProfilePaths();
  for (const p of profiles) {
    try {
      const content = await fs.readFile(p, 'utf-8');
      if (content.includes(CODEX_SWITCH_BLOCK_START)) return true;
    } catch {
      /* file does not exist – skip */
    }
  }
  return false;
}

async function detectClaudeDesktop(): Promise<ToolStatus> {
  const installedByPath = await anyPathExists(claudeDesktopAppPaths());
  const installedByProcess = installedByPath || (await isProcessRunning('Claude'));

  const configPath = claudeDesktopConfigPath();
  const storeConfigPath = claudeDesktopStoreConfigPath();

  const profilePath = claudeDesktopProfilePath(PROFILE_ID);
  const configApplied =
    installedByProcess &&
    ((await isClaudeDesktopConfigured(profilePath)) ||
      (await isStoreConfigApplied(storeConfigPath)));

  return { installed: installedByProcess, configApplied, configPath };
}

/**
 * Checks if the Microsoft Store version of Claude Desktop has configuration.
 * Note: Even if we can't write to it easily via regular file API,
 * we check if it already exists or has been modified.
 */
async function isStoreConfigApplied(storeConfigPath: string): Promise<boolean> {
  // For Store apps, we might not be able to read config.json due to sandboxing
  // but if the user manually configured it or we found it, we report true.
  try {
    const stats = await fs.stat(storeConfigPath);
    return stats.size > 0;
  } catch {
    return false;
  }
}

async function isClaudeDesktopConfigured(profilePath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(profilePath, 'utf-8');
    const cfg = JSON.parse(content) as Record<string, unknown>;
    return (
      cfg['inferenceProvider'] === 'gateway' &&
      typeof cfg['inferenceGatewayBaseUrl'] === 'string' &&
      (cfg['inferenceGatewayBaseUrl'] as string).includes('127.0.0.1')
    );
  } catch {
    return false;
  }
}

/** Run all 4 detection checks in parallel and return combined results. */
export async function detectAll(): Promise<DetectResult> {
  const [codexDesktop, codexCli, claudeCli, claudeDesktop] = await Promise.all([
    detectCodexDesktop(),
    detectCodexCli(),
    detectClaudeCli(),
    detectClaudeDesktop(),
  ]);
  return { codexDesktop, codexCli, claudeCli, claudeDesktop };
}
