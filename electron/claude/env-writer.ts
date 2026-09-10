import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

import { readFileOrNull, writeJsonWithBackup, writeWithBackup } from '../config/file-write';
import {
  shellProfilePaths,
  claudeCliSettingsPath,
  claudeCliConfigJsonPath,
  claudeCliDir,
} from './paths';
import { getPreferences } from '../config/store';
import {
  getProvider,
  PROVIDER_LIST,
  resolveClaudeBaseUrl,
  type ProviderId,
} from '../config/providers';

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

/**
 * 某供应商的 Claude CLI 默认 envVars（v3.0.0：由注册表的档位默认值派生）。
 *
 * 档位 → 字段的对应关系是固定的：
 *  - 主对话模型（anthropicModel）跟随 Sonnet 档
 *  - 子代理（claudeCodeSubagentModel）跟随 Haiku 档
 * 此前每个供应商各写一份常量，同一份事实在多处重复；现在只在这里映射一次。
 */
export function defaultEnvVars(provider: ProviderId): ClaudeCliEnvVars {
  const r = getProvider(provider).claude.roleDefaults;
  return {
    anthropicModel: r.sonnet,
    anthropicDefaultOpusModel: r.opus,
    anthropicDefaultSonnetModel: r.sonnet,
    anthropicDefaultHaikuModel: r.haiku,
    claudeCodeSubagentModel: r.haiku,
  };
}

/** DeepSeek 的默认 envVars（供 store 的静态 DEFAULTS 使用）。 */
export const DEFAULT_ENV_VARS: ClaudeCliEnvVars = defaultEnvVars('deepseek');

/**
 * 根据供应商和已有配置，智能决定 Claude CLI 的模型名。
 *
 * - 已有 envVars 非空、且模型名与当前供应商匹配 → 保留用户选择（不覆盖）
 * - 已有 envVars 为空、或模型名明显属于其他供应商 → 返回当前供应商的默认值（迁移/初始化）
 */
export function resolveEnvVars(
  existing: ClaudeCliEnvVars | undefined,
  provider: ProviderId,
): { envVars: ClaudeCliEnvVars; changed: boolean } {
  const descriptor = getProvider(provider);
  const defaults = defaultEnvVars(descriptor.id);
  // 检查已有配置的模型名是否属于当前供应商
  const model = existing?.anthropicModel?.trim();
  if (!model) return { envVars: defaults, changed: true };
  // v3.0.0: 「串了供应商」= 模型名以**其他**任一供应商的前缀开头（此前是手写的组合矩阵）
  const foreign = PROVIDER_LIST.filter((p) => p.id !== descriptor.id).some((p) =>
    p.claude.acceptedModelPrefixes.some((prefix) => model.startsWith(prefix)),
  );
  if (foreign) return { envVars: defaults, changed: true };
  // 模型名与供应商匹配，保留用户配置
  return { envVars: existing!, changed: false };
}

// ─── Block builder ───────────────────────────────────────────────────────────

function buildBlock(apiKey: string, vars: ClaudeCliEnvVars, baseUrl: string): string {
  return [
    BLOCK_START,
    `export ANTHROPIC_AUTH_TOKEN="${apiKey}"`,
    `export ANTHROPIC_BASE_URL="${baseUrl}"`,
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
  baseUrl: string,
): Promise<void> {
  const content = (await readFileOrNull(profilePath)) ?? '';
  if (content === '') await fs.mkdir(path.dirname(profilePath), { recursive: true });

  const cleaned = removeBlock(content);
  const block = buildBlock(apiKey, vars, baseUrl);
  const newContent = cleaned.trimEnd() + '\n\n' + block + '\n';

  // v3.0.0: 走共用写入——内容相同则既不备份也不写（此前每次启动都新增一份 .bak），
  // 并按 maxBackupsPerFile 滚动修剪。0o600 防止同机其他用户读到 API Key。
  await writeWithBackup(profilePath, newContent, getPreferences().maxBackupsPerFile ?? 5, {
    mode: 0o600,
  });
}

// ─── Windows env-var writing ─────────────────────────────────────────────────

async function writeWindowsEnvVars(
  apiKey: string,
  vars: ClaudeCliEnvVars,
  baseUrl: string,
): Promise<void> {
  const pairs: Array<[string, string]> = [
    ['ANTHROPIC_AUTH_TOKEN', apiKey],
    ['ANTHROPIC_BASE_URL', baseUrl],
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

async function writeSettingsJson(
  apiKey: string,
  vars: ClaudeCliEnvVars,
  baseUrl: string,
): Promise<void> {
  await fs.mkdir(claudeCliDir(), { recursive: true });
  const settingsPath = claudeCliSettingsPath();

  const existing = await readSettingsJson();

  const env: Record<string, string> = { ...(existing.env ?? {}) };
  env['ANTHROPIC_AUTH_TOKEN'] = apiKey;
  env['ANTHROPIC_BASE_URL'] = baseUrl;
  env['ANTHROPIC_MODEL'] = vars.anthropicModel;
  env['ANTHROPIC_DEFAULT_OPUS_MODEL'] = vars.anthropicDefaultOpusModel;
  env['ANTHROPIC_DEFAULT_SONNET_MODEL'] = vars.anthropicDefaultSonnetModel;
  env['ANTHROPIC_DEFAULT_HAIKU_MODEL'] = vars.anthropicDefaultHaikuModel;
  env['CLAUDE_CODE_SUBAGENT_MODEL'] = vars.claudeCodeSubagentModel;
  env['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'] = '1';
  env['CLAUDE_CODE_EFFORT_LEVEL'] = 'high';

  const merged: ClaudeSettingsJson = { ...existing, env, [CS_MARKER_KEY]: CS_MARKER_VALUE };

  // v3.0.0: 共用写入——去重 + 备份修剪（此前每次调用都新增一份 .bak）
  await writeJsonWithBackup(settingsPath, merged, getPreferences().maxBackupsPerFile ?? 5, {
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
    await writeJsonWithBackup(settingsPath, cfg, getPreferences().maxBackupsPerFile ?? 5, {
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
  cfg['primaryApiKey'] = 'any';
  // v3.0.0: 共用写入（内容相同会自动跳过，故不再需要手写的 early-return）
  await writeJsonWithBackup(p, cfg, getPreferences().maxBackupsPerFile ?? 5, { mode: 0o600 });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Read the current Claude Code CLI env vars from ~/.claude/settings.json.
 * Returns null if the file doesn't exist or has no managed env keys.
 * Used by startupApplyClaude to recover user's actual model choices
 * when the electron-store preferences were lost (e.g., reinstall).
 */
export async function readCurrentCliEnvVars(): Promise<ClaudeCliEnvVars | null> {
  const settings = await readSettingsJson();
  const env = settings.env;
  if (!env || !env['ANTHROPIC_MODEL']) return null;
  return {
    anthropicModel: env['ANTHROPIC_MODEL'],
    anthropicDefaultOpusModel: env['ANTHROPIC_DEFAULT_OPUS_MODEL'] ?? env['ANTHROPIC_MODEL'],
    anthropicDefaultSonnetModel: env['ANTHROPIC_DEFAULT_SONNET_MODEL'] ?? env['ANTHROPIC_MODEL'],
    anthropicDefaultHaikuModel: env['ANTHROPIC_DEFAULT_HAIKU_MODEL'] ?? env['ANTHROPIC_MODEL'],
    claudeCodeSubagentModel: env['CLAUDE_CODE_SUBAGENT_MODEL'] ?? env['ANTHROPIC_MODEL'],
  };
}

/**
 * Infer the AI provider from a model name prefix.
 * Returns null if the model name doesn't match any known provider.
 *
 * v3.0.0: 改为遍历注册表而非手写 if 链（新增供应商自动生效）。
 */
export function inferProviderFromModel(model: string): ProviderId | null {
  for (const p of PROVIDER_LIST) {
    if (p.claude.acceptedModelPrefixes.some((prefix) => model.startsWith(prefix))) return p.id;
  }
  return null;
}

/**
 * Write Claude Code CLI environment variables.  Writes:
 *   1. ~/.claude/settings.json (canonical, no terminal restart needed)
 *   2. ~/.claude/config.json (primaryApiKey:"any" auth-bypass marker)
 *   3. shell profile (~/.zshrc etc.) — backup so child shells inherit env
 */
export async function writeClaudeCliConfig(
  apiKey: string,
  vars: ClaudeCliEnvVars = DEFAULT_ENV_VARS,
  provider: ProviderId = 'deepseek',
): Promise<void> {
  // v3.0.0: 所有供应商都是直连，端点由注册表描述（不再有 127.0.0.1 代理分支）。
  // 注意：调用方负责根据 provider 传入正确的 envVars（模型名），本函数不再内部覆盖。
  const descriptor = getProvider(provider);
  const baseUrl = resolveClaudeBaseUrl(descriptor, getPreferences());
  await writeSettingsJson(apiKey, vars, baseUrl);
  await writeAuthBypass();

  if (process.platform === 'win32') {
    await writeWindowsEnvVars(apiKey, vars, baseUrl);
    return;
  }
  const profiles = shellProfilePaths();
  for (const profilePath of profiles) {
    await writeToProfile(profilePath, apiKey, vars, baseUrl);
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
      // v3.0.0: 统一走共用写入（去重 + 备份修剪）
      await writeWithBackup(profilePath, cleaned, getPreferences().maxBackupsPerFile ?? 5);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
}
