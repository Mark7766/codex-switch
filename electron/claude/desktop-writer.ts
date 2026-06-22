import fs from 'node:fs/promises';
import path from 'node:path';

import { getPreferences } from '../config/store';

import {
  claudeDesktopConfigPath,
  claudeDesktop3pConfigPath,
  claudeDesktopConfigLibraryDir,
  claudeDesktopProfilePath,
  claudeDesktopMetaPath,
  claudeDesktopDir,
  claudeDesktop3pDir,
  backupPath as mkBackupPath,
} from './paths';

/**
 * Stable profile ID for the Codex Switch managed inference gateway.
 * UUIDv4-like; deliberately distinct from cc-switch's PROFILE_ID so the two
 * tools can coexist without overwriting each other's profile entries.
 */
export const PROFILE_ID = '00000000-0000-4000-8000-0000c0dec501';
export const PROFILE_NAME = 'DeepSeek';

/** Marker key written into the gateway profile JSON so we can identify our own entry on uninstall. */
const CS_MARKER_KEY = '__codexSwitch';
const CS_MARKER_VALUE = 'managed';

// ─── JSON helpers ────────────────────────────────────────────────────────────

async function readJsonObject(p: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(p, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    if (e instanceof SyntaxError) return {};
    throw e;
  }
}

async function writeJsonObject(p: string, obj: unknown): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
}

async function backupExisting(p: string): Promise<void> {
  try {
    const raw = await fs.readFile(p, 'utf-8');
    if (raw.length === 0) return;
    await fs.writeFile(mkBackupPath(p), raw, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}

// ─── Deployment-mode flag (1p ↔ 3p) ──────────────────────────────────────────

async function setDeploymentMode(p: string, mode: '1p' | '3p'): Promise<void> {
  const cfg = await readJsonObject(p);
  cfg['deploymentMode'] = mode;
  await writeJsonObject(p, cfg);
}

// ─── _meta.json (entry list + appliedId) ─────────────────────────────────────

async function writeMeta(applied: string | null): Promise<void> {
  const metaPath = claudeDesktopMetaPath();
  const meta = await readJsonObject(metaPath);
  const existingEntries = Array.isArray(meta['entries'])
    ? (meta['entries'] as Array<Record<string, unknown>>)
    : [];
  const filtered = existingEntries.filter((entry) => entry['id'] !== PROFILE_ID);

  if (applied !== null) {
    filtered.push({ id: PROFILE_ID, name: PROFILE_NAME });
    meta['appliedId'] = applied;
  } else {
    if (meta['appliedId'] === PROFILE_ID) {
      const next = filtered.find((entry) => typeof entry['id'] === 'string');
      if (next) {
        meta['appliedId'] = next['id'];
      } else {
        delete meta['appliedId'];
      }
    }
  }

  meta['entries'] = filtered;
  await writeJsonObject(metaPath, meta);
}

// ─── Profile JSON (the actual gateway settings Claude Desktop reads) ─────────

function buildGatewayProfile(
  apiKey: string,
  provider: 'deepseek' | 'agnes' | 'glm' | 'packycode' = 'deepseek',
): Record<string, unknown> {
  const isAgnes = provider === 'agnes';
  const isGlm = provider === 'glm';
  const isPackyCode = provider === 'packycode';
  const prefs = getPreferences();
  const proxyPort = prefs.proxyPort;
  const baseUrl = isAgnes
    ? `http://127.0.0.1:${proxyPort}`
    : isGlm
      ? 'https://open.bigmodel.cn/api/anthropic'
      : isPackyCode
        ? 'https://www.packyapi.com'
        : 'https://api.deepseek.com/anthropic';
  // 供应商默认模型名：Opus 用高端档，Sonnet/Haiku 用快速档
  // PackyCode 的 Anthropic 端点内部做模型路由，labelOverride 透传 Claude 原生名
  const label = isGlm
    ? 'glm-5.2'
    : isAgnes
      ? 'agnes-2.0-flash'
      : isPackyCode
        ? 'claude-opus-4-7'
        : 'deepseek-v4-pro';
  const labelFlash = isGlm
    ? 'glm-5.2'
    : isAgnes
      ? 'agnes-2.0-flash'
      : isPackyCode
        ? 'claude-sonnet-4-6'
        : 'deepseek-v4-flash';
  const labelHaiku = isPackyCode ? 'claude-haiku-4-5' : labelFlash;
  // 读取用户在模型映射弹窗中自定义的映射，覆盖默认值
  const mm = prefs.claudeDesktop?.modelMap ?? {};
  const models: Array<{ labelOverride: string; name: string }> = [
    { labelOverride: mm['claude-opus-4-7'] ?? label, name: 'claude-opus-4-7' },
    { labelOverride: mm['claude-sonnet-4-6'] ?? labelFlash, name: 'claude-sonnet-4-6' },
  ];
  // v1.15.0: PackyCode 不配置 Haiku（仅 Opus + Sonnet）
  if (!isPackyCode) {
    models.push({
      labelOverride: mm['claude-haiku-4-5'] ?? labelHaiku,
      name: 'claude-haiku-4-5',
    });
  }
  return {
    disableDeploymentModeChooser: true,
    inferenceGatewayApiKey: apiKey,
    inferenceGatewayAuthScheme: 'bearer',
    inferenceGatewayBaseUrl: baseUrl,
    inferenceModels: models,
    inferenceProvider: 'gateway',
    [CS_MARKER_KEY]: CS_MARKER_VALUE,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Apply the Codex Switch inference gateway profile to Claude Desktop.
 *
 * Claude Desktop reads its third-party-provider gateway from a separate
 * `Claude-3p` directory tree, NOT from the standard claude_desktop_config.json.
 * We therefore:
 *   1. Set deploymentMode="3p" in both `Claude/` and `Claude-3p/` config files
 *      (merged, preserving mcpServers and any other user fields).
 *   2. Write our gateway profile JSON to `Claude-3p/configLibrary/<id>.json`.
 *   3. Register the profile in `Claude-3p/configLibrary/_meta.json` and mark
 *      it as appliedId.
 *
 * v1.6.0: Claude Desktop now connects directly to api.deepseek.com/anthropic
 * (no local proxy relay).  The profile carries the real API key and the
 * DeepSeek URL; Codex Switch no longer intercepts or rewrites Anthropic traffic.
 * Existing files are backed up before being modified.
 */
export async function writeClaudeDesktopConfig(
  apiKey: string,
  provider?: 'deepseek' | 'agnes' | 'glm' | 'packycode',
): Promise<void> {
  const cfg1p = claudeDesktopConfigPath();
  const cfg3p = claudeDesktop3pConfigPath();

  await backupExisting(cfg1p);
  await backupExisting(cfg3p);

  await setDeploymentMode(cfg1p, '3p');
  await setDeploymentMode(cfg3p, '3p');

  await fs.mkdir(claudeDesktopConfigLibraryDir(), { recursive: true });
  const profilePath = claudeDesktopProfilePath(PROFILE_ID);
  await backupExisting(profilePath);
  await writeJsonObject(profilePath, buildGatewayProfile(apiKey, provider));

  await writeMeta(PROFILE_ID);
}

/**
 * Update the API key in our existing profile.  No-op if the profile doesn't
 * exist or the __codexSwitch marker is missing.
 */
export async function updateClaudeDesktopApiKey(apiKey: string): Promise<void> {
  const profilePath = claudeDesktopProfilePath(PROFILE_ID);
  try {
    const profile = await readJsonObject(profilePath);
    if (profile[CS_MARKER_KEY] !== CS_MARKER_VALUE) return;
    profile['inferenceGatewayApiKey'] = apiKey;
    await writeJsonObject(profilePath, profile);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}

/**
 * Remove our gateway profile and switch Claude Desktop back to 1p mode.
 * Only acts if the profile we wrote (identified by the __codexSwitch marker) is
 * still present — otherwise we leave the user's manual setup alone.
 */
export async function removeClaudeDesktopConfig(): Promise<void> {
  const profilePath = claudeDesktopProfilePath(PROFILE_ID);
  let isOurs = false;
  try {
    const profile = await readJsonObject(profilePath);
    isOurs = profile[CS_MARKER_KEY] === CS_MARKER_VALUE;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  if (!isOurs) return;

  // Switch both configs back to 1p
  await setDeploymentMode(claudeDesktopConfigPath(), '1p');
  await setDeploymentMode(claudeDesktop3pConfigPath(), '1p');

  // Remove our profile JSON
  try {
    await fs.unlink(profilePath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }

  // Remove our entry from _meta.json
  await writeMeta(null);
}

// ─── Backups ─────────────────────────────────────────────────────────────────

/**
 * List backup files for both 1p and 3p config files plus the profile JSON,
 * newest first.  Used by the "restore backup" UI.
 */
export async function listClaudeDesktopBackups(): Promise<string[]> {
  const targets = [
    claudeDesktopConfigPath(),
    claudeDesktop3pConfigPath(),
    claudeDesktopProfilePath(PROFILE_ID),
  ];
  const out: string[] = [];
  for (const target of targets) {
    const dir = path.dirname(target);
    const base = path.basename(target);
    try {
      const files = await fs.readdir(dir);
      for (const f of files) {
        if (f.startsWith(base + '.bak.')) {
          out.push(path.join(dir, f));
        }
      }
    } catch {
      /* directory doesn't exist — ignore */
    }
  }
  // Sort by trailing `.bak.<digits>` timestamp, newest first
  return out.sort((a, b) => {
    const ta = Number(a.match(/\.bak\.(\d+)$/)?.[1] ?? 0);
    const tb = Number(b.match(/\.bak\.(\d+)$/)?.[1] ?? 0);
    return tb - ta;
  });
}

/** Restore a specific backup file as the active config (matched by name). */
export async function restoreClaudeDesktopBackup(backupFilePath: string): Promise<void> {
  // H1: path traversal prevention — validate backup is within allowed directories
  const resolvedBackup = path.resolve(backupFilePath);
  const allowedDirs = [
    path.resolve(claudeDesktopDir()) + path.sep,
    path.resolve(claudeDesktop3pDir()) + path.sep,
  ];
  const withinAllowed = allowedDirs.some((dir) => resolvedBackup.startsWith(dir));
  if (!withinAllowed) {
    throw new Error(`拒绝访问 Claude Desktop 配置目录外的备份文件：${backupFilePath}`);
  }
  if (!/\.bak\.\d+$/.test(backupFilePath)) {
    throw new Error('非法的备份文件名格式');
  }
  const base = path.basename(backupFilePath);
  const originalName = base.replace(/\.bak\.\d+$/, '');
  const targetDir = path.dirname(backupFilePath);
  const targetPath = path.join(targetDir, originalName);
  const content = await fs.readFile(backupFilePath, 'utf-8');
  await fs.writeFile(targetPath, content, 'utf-8');
}
