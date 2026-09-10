import fs from 'node:fs/promises';
import path from 'node:path';

import { getPreferences, type UserPreferences } from '../config/store';
import { getProvider, resolveClaudeBaseUrl, type ProviderId } from '../config/providers';

import { writeJsonWithBackup } from '../config/file-write';
import {
  claudeDesktopConfigPath,
  claudeDesktop3pConfigPath,
  claudeDesktopConfigLibraryDir,
  claudeDesktopProfilePath,
  claudeDesktopMetaPath,
  claudeDesktopDir,
  claudeDesktop3pDir,
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

/**
 * 写 JSON 配置（0o600）。v3.0.0: 走 config/file-write 的共用实现——**内容相同则跳过**，
 * 并按 `maxBackupsPerFile` 滚动修剪备份。此前这里每次都无条件备份+写入，而
 * `startupApplyClaude()` 每次启动都会调用它，导致用户家目录堆积数百份 `.bak.<ts>`。
 */
async function writeJsonObject(p: string, obj: unknown, keep: number): Promise<void> {
  await writeJsonWithBackup(p, obj, keep, { mode: 0o600 });
}

// ─── Deployment-mode flag (1p ↔ 3p) ──────────────────────────────────────────

async function setDeploymentMode(p: string, mode: '1p' | '3p', keep: number): Promise<void> {
  const cfg = await readJsonObject(p);
  cfg['deploymentMode'] = mode;
  await writeJsonObject(p, cfg, keep);
}

// ─── _meta.json (entry list + appliedId) ─────────────────────────────────────

async function writeMeta(
  applied: string | null,
  name: string = PROFILE_NAME,
  keep = 5,
): Promise<void> {
  const metaPath = claudeDesktopMetaPath();
  const meta = await readJsonObject(metaPath);
  const existingEntries = Array.isArray(meta['entries'])
    ? (meta['entries'] as Array<Record<string, unknown>>)
    : [];
  const filtered = existingEntries.filter((entry) => entry['id'] !== PROFILE_ID);

  if (applied !== null) {
    // v3.0.0: 条目名跟随当前供应商（此前写死 'DeepSeek'，GLM 用户在 Claude Desktop
    // 的配置列表里看到的也是「DeepSeek」）。仅显示用，PROFILE_ID 才是识别依据。
    filtered.push({ id: PROFILE_ID, name });
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
  await writeJsonObject(metaPath, meta, keep);
}

// ─── Profile JSON (the actual gateway settings Claude Desktop reads) ─────────

function buildGatewayProfile(
  prefs: UserPreferences,
  apiKey: string,
  provider: ProviderId = 'deepseek',
): Record<string, unknown> {
  const descriptor = getProvider(provider);
  const baseUrl = resolveClaudeBaseUrl(descriptor, prefs);
  // 档位默认模型名直接取注册表；自定义供应商透传 Claude 原生名。
  // 注意：Desktop 3P gateway 实际只把 claude-* 路由名发给上游，labelOverride 仅显示，
  // 真实模型由上游服务端按 claude-* 档位路由决定（见 ADR-029/030）。
  const roles = descriptor.claude.roleDefaults;
  // 读取用户在模型映射弹窗中自定义的映射，覆盖默认值
  const mm = prefs.claudeDesktop?.modelMap ?? {};
  const models: Array<{ labelOverride: string; name: string }> = descriptor.claude.slots
    // v1.16.0: 自定义供应商不配置 Haiku（仅 Opus + Sonnet）
    .filter((slot) => descriptor.claude.includeHaiku || slot.tier !== 'haiku')
    .map((slot) => ({
      labelOverride: mm[slot.id] ?? roles[slot.tier],
      name: slot.id,
    }));
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
  provider?: ProviderId,
): Promise<void> {
  const cfg1p = claudeDesktopConfigPath();
  const cfg3p = claudeDesktop3pConfigPath();

  // 每次操作只读一次偏好快照：既保证视图一致，也避免同一操作内反复读盘
  const prefs = getPreferences();
  const keep = prefs.maxBackupsPerFile ?? 5;
  await setDeploymentMode(cfg1p, '3p', keep);
  await setDeploymentMode(cfg3p, '3p', keep);

  await fs.mkdir(claudeDesktopConfigLibraryDir(), { recursive: true });
  const profilePath = claudeDesktopProfilePath(PROFILE_ID);
  await writeJsonObject(profilePath, buildGatewayProfile(prefs, apiKey, provider), keep);

  await writeMeta(PROFILE_ID, getProvider(provider).label, keep);
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
  const keep = getPreferences().maxBackupsPerFile ?? 5;
  await setDeploymentMode(claudeDesktopConfigPath(), '1p', keep);
  await setDeploymentMode(claudeDesktop3pConfigPath(), '1p', keep);

  // Remove our profile JSON
  try {
    await fs.unlink(profilePath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }

  // Remove our entry from _meta.json
  await writeMeta(null, PROFILE_NAME, keep);
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
