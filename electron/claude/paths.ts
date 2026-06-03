import os from 'node:os';
import path from 'node:path';

// ─── Claude Desktop ──────────────────────────────────────────────────────────

/**
 * Root directory of the Claude Desktop "1p" (official) config.
 * macOS: ~/Library/Application Support/Claude
 * Windows: %LOCALAPPDATA%/Claude
 */
function claudeDesktopDir(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude');
  }
  if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'Claude');
  }
  return path.join(os.homedir(), '.config', 'Claude');
}

/**
 * Root directory of the Claude Desktop "3p" (third-party gateway) config.
 * Sibling of claudeDesktopDir(), with `-3p` suffix.
 */
function claudeDesktop3pDir(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude-3p');
  }
  if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'Claude-3p');
  }
  return path.join(os.homedir(), '.config', 'Claude-3p');
}

/** Path to the 1p (official) claude_desktop_config.json. */
export function claudeDesktopConfigPath(): string {
  return path.join(claudeDesktopDir(), 'claude_desktop_config.json');
}

/** Path to the 3p (third-party) claude_desktop_config.json. */
export function claudeDesktop3pConfigPath(): string {
  return path.join(claudeDesktop3pDir(), 'claude_desktop_config.json');
}

/** Directory containing 3p inference profile JSON files. */
export function claudeDesktopConfigLibraryDir(): string {
  return path.join(claudeDesktop3pDir(), 'configLibrary');
}

/** Path to the inference profile JSON for our managed gateway. */
export function claudeDesktopProfilePath(profileId: string): string {
  return path.join(claudeDesktopConfigLibraryDir(), `${profileId}.json`);
}

/** Path to _meta.json that lists all installed inference profiles. */
export function claudeDesktopMetaPath(): string {
  return path.join(claudeDesktopConfigLibraryDir(), '_meta.json');
}

/**
 * Ordered list of candidate paths where Claude Desktop may be installed.
 * Returns the first path that exists on macOS (only one location).
 * On Windows, multiple locations are tried because Anthropic has shipped
 * both Squirrel-style (AnthropicClaude\) and NSIS-style (Programs\Claude\) installers.
 */
export function claudeDesktopAppPaths(): string[] {
  if (process.platform === 'darwin') return ['/Applications/Claude.app'];
  if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local');
    return [
      // Squirrel-based installer (most common for Anthropic's official builds)
      path.join(localAppData, 'AnthropicClaude', 'claude.exe'),
      path.join(localAppData, 'AnthropicClaude', 'Claude.exe'),
      // NSIS per-user installer (electron-builder default)
      path.join(localAppData, 'Programs', 'Claude', 'Claude.exe'),
      path.join(localAppData, 'Programs', 'Anthropic', 'Claude', 'Claude.exe'),
      // Microsoft Store (AppX/MSIX) packages - they use versioned folders in WindowsApps,
      // but the LocalAppData mapping is stable.
      path.join(localAppData, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude'),
    ];
  }
  return [];
}

/** @deprecated Use claudeDesktopAppPaths() instead. */
export function claudeDesktopAppPath(): string | null {
  const candidates = claudeDesktopAppPaths();
  return candidates[0] ?? null;
}

// ─── Claude Code CLI ─────────────────────────────────────────────────────────

/** ~/.claude directory (Claude Code CLI stores state here). */
export function claudeCliDir(): string {
  return path.join(os.homedir(), '.claude');
}

/** ~/.claude/settings.json — primary Claude Code CLI config (env, model, etc.). */
export function claudeCliSettingsPath(): string {
  const clDir = claudeCliDir();
  if (process.platform === 'win32') {
    // If installed via Microsoft Store, the config might be in the sandbox.
    // However, Claude Code CLI usually stays in ~/.claude.
    // We check both if needed in detect.ts, but here we provide the standard one.
    const localAppData = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local');
    const sandboxPath = path.join(
      localAppData,
      'Packages',
      'Claude_pzs8sxrjxfjjc',
      'LocalCache',
      'Roaming',
      'Claude',
      'config.json',
    );
    // Note: Claude Desktop (Store version) config.json is in LocalCache.
  }
  return path.join(clDir, 'settings.json');
}

/** ~/.claude/config.json — Claude Code CLI auth-bypass marker (primaryApiKey). */
export function claudeCliConfigJsonPath(): string {
  return path.join(claudeCliDir(), 'config.json');
}

/**
 * Microsoft Store (AppX) sandboxed config paths for Claude Desktop.
 */
export function claudeDesktopStoreConfigPath(): string {
  const localAppData = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local');
  return path.join(
    localAppData,
    'Packages',
    'Claude_pzs8sxrjxfjjc',
    'LocalCache',
    'Roaming',
    'Claude',
    'config.json',
  );
}

/** Ordered list of shell profile files to write env vars into (macOS / Linux). */
export function shellProfilePaths(): string[] {
  if (process.platform === 'win32') return []; // Windows uses setx instead
  const home = os.homedir();
  const shell = process.env['SHELL'] ?? '';
  if (shell.includes('fish')) {
    return [path.join(home, '.config', 'fish', 'config.fish')];
  }
  if (shell.includes('bash')) {
    // bash reads .bash_profile on login shells, .bashrc on interactive shells
    return [path.join(home, '.bash_profile'), path.join(home, '.bashrc')];
  }
  // Default: zsh (macOS default since Catalina)
  return [path.join(home, '.zshrc')];
}

// ─── Codex (for detection) ───────────────────────────────────────────────────

/** ~/.codex directory. */
export function codexDir(): string {
  return path.join(os.homedir(), '.codex');
}

/**
 * Ordered list of candidate paths where Codex Desktop (OpenAI) may be installed.
 * On Windows, multiple locations are tried to handle different electron-builder
 * productName configurations used across releases.
 */
export function codexDesktopAppPaths(): string[] {
  if (process.platform === 'darwin') return ['/Applications/Codex.app'];
  if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local');
    return [
      // NSIS per-user: productName variants seen in the wild
      path.join(localAppData, 'Programs', 'OpenAI', 'Codex.exe'),
      path.join(localAppData, 'Programs', 'OpenAI Codex', 'Codex.exe'),
      path.join(localAppData, 'Programs', 'Codex', 'Codex.exe'),
      // Squirrel-style
      path.join(localAppData, 'OpenAI Codex', 'Codex.exe'),
      path.join(localAppData, 'codex', 'Codex.exe'),
      // Microsoft Store (AppX/MSIX) packages
      path.join(localAppData, 'Packages', 'OpenAI.Codex_2p2nqsd0c76g0', 'LocalCache', 'Roaming', 'Codex'),
    ];
  }
  return [];
}

/** @deprecated Use codexDesktopAppPaths() instead. */
export function codexDesktopAppPath(): string | null {
  const candidates = codexDesktopAppPaths();
  return candidates[0] ?? null;
}

// ─── Shared ──────────────────────────────────────────────────────────────────

/** Generate a timestamped backup path for any file. */
export function backupPath(originalPath: string): string {
  return `${originalPath}.bak.${Date.now()}`;
}
