import Store from 'electron-store';

import type { ClaudeCliEnvVars } from '../claude/env-writer';
import { DEFAULT_ENV_VARS } from '../claude/env-writer';
// v1.6.0: Claude Desktop modelMap removed — profile.json carries inferenceModels directly.
// DeepSeek endpoint maps Claude model IDs to DeepSeek models by prefix.

// ─── Claude sub-schemas ───────────────────────────────────────────────────────

export interface ClaudeCliPrefs {
  /** Whether Codex Switch should auto-manage Claude Code CLI env vars. */
  enabled: boolean;
  envVars: ClaudeCliEnvVars;
}

export interface ClaudeDesktopPrefs {
  /** Whether Codex Switch should auto-manage Claude Desktop config. */
  enabled: boolean;
}

export interface MigrationFlags {
  /** True once the one-time v1.3.0 Claude bootstrap has run. */
  v130_claude?: boolean;
  /** True once the v1.6.0 Claude Desktop direct-DeepSeek migration has run. */
  v160_claudeDesktopDirect?: boolean;
}

export interface UserPreferences {
  proxyPort: number;
  defaultModel: 'deepseek-v4-flash' | 'deepseek-v4-pro';
  modelMapping: Record<string, string>;
  modelMappingVersion: number;
  autoStartProxy: boolean;
  hasCompletedSetup: boolean;
  /** 备份保留份数（每个文件独立计数）。 */
  maxBackupsPerFile: number;
  /** 上次启动应用的版本号（用于"新版亮点"弹窗）。 */
  lastSeenVersion: string;
  /** 是否启用启动时自动检查更新。 */
  autoCheckUpdate: boolean;
  /** 升级镜像策略。 */
  updateMirror: 'auto' | 'github' | 'ghproxy' | 'custom';
  /** 自定义镜像 URL（仅 updateMirror='custom' 时生效）。 */
  customMirrorUrl: string;
  /** 是否完成 Codex 入门向导。 */
  hasSeenOnboarding: boolean;
  /** §6 主面板"累计请求数"持久化（跨重启）。 */
  lifetimeRequestCount: number;
  /** §6 主面板"累计运行时长（秒）"持久化（跨重启）。 */
  lifetimeUptimeSec: number;
  /** §6 累计统计起算时间（YYYY-MM-DD），首次升级到 v1.1.0 当天写入。 */
  lifetimeFirstStartAt: string;
  /** §7 最近一次代理错误的友好原因。 */
  lastErrorMessage: string;
  /** §7 最近一次代理错误的时间戳（ms）。 */
  lastErrorAt: number;
  /** 是否拦截 Codex Desktop 后台 "hyperpersonalized suggestions" 请求（默认 true）。 */
  blockBackgroundSuggestions: boolean;
  /** 生命周期累计输入 token（不含被拦截请求）。 */
  lifetimeInputTokens: number;
  /** 生命周期累计输出 token（不含被拦截请求）。 */
  lifetimeOutputTokens: number;
  /** 预留：未来付费"token 节省"Feature 开关（默认 false）。 */
  tokenSavingEnabled: boolean;
  /** v1.3.0 Claude Code CLI 配置。 */
  claudeCli: ClaudeCliPrefs;
  /** v1.3.0 Claude Desktop 配置。 */
  claudeDesktop: ClaudeDesktopPrefs;
  /** 一次性迁移标志，防止重复执行。 */
  migrations: MigrationFlags;
}

/** v3 默认映射表：覆盖 OpenAI / Codex 已知常用模型（含 gpt-5.4 系列）。 */
export const CURRENT_MAPPING_VERSION = 3;

export const DEFAULT_MAPPING: Record<string, string> = {
  'gpt-5-codex': 'deepseek-v4-flash',
  'gpt-5.4': 'deepseek-v4-flash',
  'gpt-5.4-mini': 'deepseek-v4-flash',
  'gpt-5.4-pro': 'deepseek-v4-pro',
  'gpt-4o': 'deepseek-v4-flash',
  'gpt-4o-mini': 'deepseek-v4-flash',
  'gpt-4-turbo': 'deepseek-v4-pro',
  'gpt-4': 'deepseek-v4-pro',
  'gpt-3.5-turbo': 'deepseek-v4-flash',
  o1: 'deepseek-v4-pro',
  'o1-mini': 'deepseek-v4-flash',
  o3: 'deepseek-v4-pro',
  'o3-mini': 'deepseek-v4-flash',
};

const DEFAULTS: UserPreferences = {
  proxyPort: 11435,
  defaultModel: 'deepseek-v4-flash',
  modelMapping: DEFAULT_MAPPING,
  modelMappingVersion: CURRENT_MAPPING_VERSION,
  autoStartProxy: true,
  hasCompletedSetup: false,
  maxBackupsPerFile: 5,
  lastSeenVersion: '',
  autoCheckUpdate: true,
  updateMirror: 'auto',
  customMirrorUrl: '',
  hasSeenOnboarding: false,
  lifetimeRequestCount: 0,
  lifetimeUptimeSec: 0,
  lifetimeFirstStartAt: '',
  lastErrorMessage: '',
  lastErrorAt: 0,
  blockBackgroundSuggestions: true,
  lifetimeInputTokens: 0,
  lifetimeOutputTokens: 0,
  tokenSavingEnabled: false,
  claudeCli: {
    enabled: true,
    envVars: DEFAULT_ENV_VARS,
  },
  claudeDesktop: {
    enabled: true,
  },
  migrations: {
    v130_claude: false,
    v160_claudeDesktopDirect: false,
  },
};

let store: Store<UserPreferences> | null = null;

function getStore(): Store<UserPreferences> {
  if (!store) {
    store = new Store<UserPreferences>({
      name: 'preferences',
      defaults: DEFAULTS,
    });
    migrateIfNeeded(store);
  }
  return store;
}

/** 启动时迁移：合并新增的 default mapping key（保留用户自定义同名 key）。 */
export function migrateIfNeeded(s: Store<UserPreferences>): void {
  const saved = (s.get('modelMappingVersion') as number) ?? 0;
  if (saved < CURRENT_MAPPING_VERSION) {
    const userMapping = (s.get('modelMapping') as Record<string, string>) ?? {};
    const merged: Record<string, string> = { ...DEFAULT_MAPPING, ...userMapping };
    s.set('modelMapping', merged);
    s.set('modelMappingVersion', CURRENT_MAPPING_VERSION);
  }
  // §6: 首次进入 v1.1.0 时记录累计统计的起算日期
  if (!s.get('lifetimeFirstStartAt')) {
    const today = new Date().toISOString().slice(0, 10);
    s.set('lifetimeFirstStartAt', today);
  }
}

export function getPreferences(): UserPreferences {
  return getStore().store;
}

export function setPreferences(patch: Partial<UserPreferences>): UserPreferences {
  const s = getStore();
  const next = { ...s.store, ...patch };
  s.store = next;
  return next;
}

export function resetPreferences(): void {
  getStore().clear();
}
