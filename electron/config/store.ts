import Store from 'electron-store';

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
}

/** v2 默认映射表：覆盖 OpenAI / Codex 已知常用模型。 */
export const CURRENT_MAPPING_VERSION = 2;

export const DEFAULT_MAPPING: Record<string, string> = {
  'gpt-5-codex': 'deepseek-v4-flash',
  'gpt-5.4-mini': 'deepseek-v4-flash',
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
  if (saved >= CURRENT_MAPPING_VERSION) return;
  const userMapping = (s.get('modelMapping') as Record<string, string>) ?? {};
  const merged: Record<string, string> = { ...DEFAULT_MAPPING, ...userMapping };
  s.set('modelMapping', merged);
  s.set('modelMappingVersion', CURRENT_MAPPING_VERSION);
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
