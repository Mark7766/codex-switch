import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

import {
  shellProfilePaths,
  backupPath,
  claudeCliSettingsPath,
  claudeCliConfigJsonPath,
  claudeCliDir,
} from './paths';

const execFileAsync = promisify(execFile);

export const BLOCK_START =
  '# --- Codex Switch: Claude Code CLI config (auto-generated, do not edit) ---';
export const BLOCK_END = '# --- End Codex Switch ---';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ClaudeCliEnvVars {
  anthropicModel: string;
  anthropicDefaultOpusModel: string;
  anthropicDefaultSonnetModel: string;
  anthropicDefaultHaikuModel: string;
  claudeCodeSubagentModel: string;
}

export const DEFAULT_ENV_VARS: ClaudeCliEnvVars = {
  anthropicModel: 'deepseek-v4-pro',
  anthropicDefaultOpusModel: 'deepseek-v4-pro',
  anthropicDefaultSonnetModel: 'deepseek-v4-pro',
  anthropicDefaultHaikuModel: 'deepseek-v4-flash',
  claudeCodeSubagentModel: 'deepseek-v4-flash',
};

// ─── Block builder ───────────────────────────────────────────────────────────

function buildBlock(apiKey: string, vars: ClaudeCliEnvVars): string {
  return [
    BLOCK_START,
    `export ANTHROPIC_AUTH_TOKEN="${apiKey}"`,
    `export ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"`,
    `export ANTHROPIC_MODEL="${vars.anthropicModel}"`,
    `export ANTHROPIC_DEFAULT_OPUS_MODEL="${vars.anthropicDefaultOpusModel}"`,
    `export ANTHROPIC_DEFAULT_SONNET_MODEL="${vars.anthropicDefaultSonnetModel}"`,
    `export ANTHROPIC_DEFAULT_HAIKU_MODEL="${vars.anthropicDefaultHaikuModel}"`,
    `export CLAUDE_CODE_SUBAGENT_MODEL="${vars.claudeCodeSubagentModel}"`,
    `export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1"`,
    `export CLAUDE_CODE_EFFORT_LEVEL="high"`,
    BLOCK_END,
  ].join('\n');
}

function removeBlock(content: string): string {
  const start = content.indexOf(BLOCK_START);
  if (start === -1) return content;
  const end = content.indexOf(BLOCK_END, start);
  const after = end !== -1 ? content.slice(end + BLOCK_END.length) : '';
  const before = content.slice(0, start);
  // Collapse any extra blank lines left by the removal
  return (before + after).replace(/\n{3,}/g, '\n\n');
}

// ─── macOS / Linux profile writing ──────────────────────────────────────────

async function writeToProfile(
  profilePath: string,
  apiKey: string,
  vars: ClaudeCliEnvVars,
): Promise<void> {
  let content = '';
  try {
    content = await fs.readFile(profilePath, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    // File doesn't exist — create parent directories and continue with empty content
    await fs.mkdir(path.dirname(profilePath), { recursive: true });
  }

  // Back up existing non-empty file before modifying
  if (content.length > 0) {
    await fs.writeFile(backupPath(profilePath), content, { encoding: 'utf-8', mode: 0o600 });
  }

  const cleaned = removeBlock(content);
  const block = buildBlock(apiKey, vars);
  const newContent = cleaned.trimEnd() + '\n\n' + block + '\n';

  // Write with 0o600 to prevent other users on the same machine reading the API key
  await fs.writeFile(profilePath, newContent, { encoding: 'utf-8', mode: 0o600 });
}

// ─── Windows env-var writing ─────────────────────────────────────────────────

async function writeWindowsEnvVars(apiKey: string, vars: ClaudeCliEnvVars): Promise<void> {
  const pairs: Array<[string, string]> = [
    ['ANTHROPIC_AUTH_TOKEN', apiKey],
    ['ANTHROPIC_BASE_URL', 'https://api.deepseek.com/anthropic'],
    ['ANTHROPIC_MODEL', vars.anthropicModel],
    ['ANTHROPIC_DEFAULT_OPUS_MODEL', vars.anthropicDefaultOpusModel],
    ['ANTHROPIC_DEFAULT_SONNET_MODEL', vars.anthropicDefaultSonnetModel],
    ['ANTHROPIC_DEFAULT_HAIKU_MODEL', vars.anthropicDefaultHaikuModel],
    ['CLAUDE_CODE_SUBAGENT_MODEL', vars.claudeCodeSubagentModel],
    ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', '1'],
    ['CLAUDE_CODE_EFFORT_LEVEL', 'high'],
  ];
  for (const [key, value] of pairs) {
    // H2: use execFile to prevent shell injection via env var values
    // setx has a 1024-char limit per value; API keys are well within that.
    await execFileAsync('setx', [key, value]);
  }
}

async function removeWindowsEnvVars(): Promise<void> {
  const keys = [
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'CLAUDE_CODE_SUBAGENT_MODEL',
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    'CLAUDE_CODE_EFFORT_LEVEL',
  ];
  for (const key of keys) {
    try {
      // H2: use execFile to prevent shell injection
      await execFileAsync('reg', ['delete', 'HKCU\\Environment', '/v', key, '/f']);
    } catch {
      /* Key not present – ignore */
    }
  }
}

// ─── ~/.claude/settings.json (the canonical Claude Code CLI config) ─────────
//
// Claude Code CLI reads `~/.claude/settings.json` on every invocation; values
// in `settings.json.env` take precedence over OS env vars and DON'T require
// the user to restart their terminal.  This is the approach cc-switch takes
// and the most reliable way to make the switch take effect immediately.
//
// We still write to ~/.zshrc as a backup so things like child shells launched
// from VS Code or scripts still work.

const CS_MARKER_KEY = '__codexSwitch';
const CS_MARKER_VALUE = 'managed';

interface ClaudeSettingsJson {
  env?: Record<string, string>;
  [key: string]: unknown;
}

async function readSettingsJson(): Promise<ClaudeSettingsJson> {
  const p = claudeCliSettingsPath();
  try {
    const raw = await fs.readFile(p, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ClaudeSettingsJson;
    }
    return {};
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    if (e instanceof SyntaxError) return {};
    throw e;
  }
}

const MANAGED_ENV_KEYS = [
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'CLAUDE_CODE_EFFORT_LEVEL',
] as const;

async function writeSettingsJson(apiKey: string, vars: ClaudeCliEnvVars): Promise<void> {
  await fs.mkdir(claudeCliDir(), { recursive: true });
  const settingsPath = claudeCliSettingsPath();

  const existing = await readSettingsJson();

  // Back up the existing file (if any) before modifying
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    if (raw.length > 0) {
      await fs.writeFile(backupPath(settingsPath), raw, { encoding: 'utf-8', mode: 0o600 });
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }

  const env: Record<string, string> = { ...(existing.env ?? {}) };
  env['ANTHROPIC_AUTH_TOKEN'] = apiKey;
  env['ANTHROPIC_BASE_URL'] = 'https://api.deepseek.com/anthropic';
  env['ANTHROPIC_MODEL'] = vars.anthropicModel;
  env['ANTHROPIC_DEFAULT_OPUS_MODEL'] = vars.anthropicDefaultOpusModel;
  env['ANTHROPIC_DEFAULT_SONNET_MODEL'] = vars.anthropicDefaultSonnetModel;
  env['ANTHROPIC_DEFAULT_HAIKU_MODEL'] = vars.anthropicDefaultHaikuModel;
  env['CLAUDE_CODE_SUBAGENT_MODEL'] = vars.claudeCodeSubagentModel;
  env['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'] = '1';
  env['CLAUDE_CODE_EFFORT_LEVEL'] = 'high';

  const merged: ClaudeSettingsJson = { ...existing, env, [CS_MARKER_KEY]: CS_MARKER_VALUE };

  await fs.writeFile(settingsPath, JSON.stringify(merged, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

async function removeSettingsJson(): Promise<void> {
  const settingsPath = claudeCliSettingsPath();
  let content: string;
  try {
    content = await fs.readFile(settingsPath, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }

  let cfg: ClaudeSettingsJson;
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    cfg = parsed as ClaudeSettingsJson;
  } catch {
    return;
  }

  if (cfg[CS_MARKER_KEY] !== CS_MARKER_VALUE) return; // not managed by us

  if (cfg.env) {
    for (const key of MANAGED_ENV_KEYS) {
      delete cfg.env[key];
    }
    if (Object.keys(cfg.env).length === 0) delete cfg.env;
  }
  delete cfg[CS_MARKER_KEY];

  if (Object.keys(cfg).length === 0) {
    await fs.unlink(settingsPath);
  } else {
    await fs.writeFile(settingsPath, JSON.stringify(cfg, null, 2) + '\n', {
      encoding: 'utf-8',
      mode: 0o600,
    });
  }
}

/**
 * Ensure ~/.claude/config.json contains `primaryApiKey: "any"`.  Without this
 * marker, Claude Code CLI may still try to launch its OAuth login flow on
 * first run instead of honoring our env-supplied bearer token.
 */
async function writeAuthBypass(): Promise<void> {
  await fs.mkdir(claudeCliDir(), { recursive: true });
  const p = claudeCliConfigJsonPath();
  let cfg: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(p, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      cfg = parsed as Record<string, unknown>;
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e;
  }
  if (cfg['primaryApiKey'] === 'any') return;
  cfg['primaryApiKey'] = 'any';
  await fs.writeFile(p, JSON.stringify(cfg, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Write Claude Code CLI environment variables.  Writes:
 *   1. ~/.claude/settings.json (canonical, no terminal restart needed)
 *   2. ~/.claude/config.json (primaryApiKey:"any" auth-bypass marker)
 *   3. shell profile (~/.zshrc etc.) — backup so child shells inherit env
 */
export async function writeClaudeCliConfig(
  apiKey: string,
  vars: ClaudeCliEnvVars = DEFAULT_ENV_VARS,
): Promise<void> {
  await writeSettingsJson(apiKey, vars);
  await writeAuthBypass();

  if (process.platform === 'win32') {
    await writeWindowsEnvVars(apiKey, vars);
    return;
  }
  const profiles = shellProfilePaths();
  for (const profilePath of profiles) {
    await writeToProfile(profilePath, apiKey, vars);
  }
}

/**
 * Remove the Codex Switch env-var block from all shell profiles (or Windows
 * env vars), and remove the managed entries from ~/.claude/settings.json.
 */
export async function removeClaudeCliConfig(): Promise<void> {
  await removeSettingsJson();

  if (process.platform === 'win32') {
    await removeWindowsEnvVars();
    return;
  }
  const profiles = shellProfilePaths();
  for (const profilePath of profiles) {
    try {
      const content = await fs.readFile(profilePath, 'utf-8');
      if (!content.includes(BLOCK_START)) continue;
      const cleaned = removeBlock(content);
      await fs.writeFile(profilePath, cleaned, { encoding: 'utf-8' });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
}
