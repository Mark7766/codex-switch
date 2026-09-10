import Store from 'electron-store';

import type { ProviderId } from './providers';

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
  /** Per-Claude-model → actual-model mapping (e.g. claude-sonnet-4-6 → glm-4.7). */
  modelMap: Record<string, string>;
}

export interface MigrationFlags {
  /** True once the one-time v1.3.0 Claude bootstrap has run. */
  v130_claude?: boolean;
  /** True once the v1.6.0 Claude Desktop direct-DeepSeek migration has run. */
  v160_claudeDesktopDirect?: boolean;
  /** True once the v2.0.0 DeepSeek direct (official) migration has run. */
  v200_deepseekDirect?: boolean;
  /** True once the v3.0.0 direct migration (proxy → provider direct; covers GLM) has run. */
  v300_direct?: boolean;
}

/**
 * 用户偏好。
 *
 * v3.0.0 移除了全部「代理专属」字段（proxyPort / autoStartProxy / modelMapping /
 * modelMappingVersion / activeModelMapping / conversationCacheLimit /
 * blockBackgroundSuggestions / lifetime 请求与 token 计数 / lastError* /
 * tokenSavingEnabled）——本地代理已删除，这些字段再无读者。
 *
 * 存量用户的 preferences.json 里仍留着这些键；electron-store 会忽略未声明的键，
 * 因此**不做清理写入**（与「不动存量」的一贯取舍一致）。
 */
export interface UserPreferences {
  defaultModel: string;
  hasCompletedSetup: boolean;
  /** 备份保留份数（每个文件独立计数）。 */
  maxBackupsPerFile: number;
  /** 上次启动应用的版本号（用于"新版亮点"弹窗）。 */
  lastSeenVersion: string;
  /** 是否启用启动时自动检查更新。 */
  autoCheckUpdate: boolean;
  /** v1.11.0: 是否自动下载新版本（默认 true）。关闭后仅检查不下载。 */
  autoDownload: boolean;
  /** 升级镜像策略。 */
  updateMirror: 'server' | 'github' | 'ghproxy' | 'custom';
  /** 自定义镜像 URL（仅 updateMirror='custom' 时生效）。 */
  customMirrorUrl: string;
  /** v1.7.0: codex-switch-server 基础 URL。留空时使用默认值。 */
  serverUrl: string;
  /** v1.7.0: 是否参与体验优化计划（匿名遥测上报）。默认 true。 */
  telemetryEnabled: boolean;
  /** v1.7.0: 客户端唯一标识，首次启动自动生成 16 位 hex。 */
  clientId: string;
  /**
   * 首次启动日期（YYYY-MM-DD）。v3.0.0 起与代理/统计无关——它只用于判定「早期成员」
   * 徽章（见 communityGetProfile）。名字里的 lifetime* 是历史遗留，勿据此删除。
   */
  lifetimeFirstStartAt: string;
  /** v1.13.0: Codex 接入的 AI 供应商。 */
  provider: ProviderId;
  /** v1.13.0: Claude Desktop 供应商。 */
  claudeDesktopProvider: ProviderId;
  /** v1.13.0: Claude Code CLI 供应商。 */
  claudeCliProvider: ProviderId;
  /** v1.16.0: 自定义供应商配置。 */
  customProvider: {
    /** Codex 接入：OpenAI Responses API 兼容端点 Base URL。 */
    codexBaseUrl: string;
    /** Claude 工具接入：Anthropic Messages API 兼容端点 Base URL。 */
    claudeBaseUrl: string;
  };
  /** v1.3.0 Claude Code CLI 配置。 */
  claudeCli: ClaudeCliPrefs;
  /** v1.3.0 Claude Desktop 配置。 */
  claudeDesktop: ClaudeDesktopPrefs;
  /** 一次性迁移标志，防止重复执行。 */
  migrations: MigrationFlags;
}

const DEFAULTS: UserPreferences = {
  defaultModel: 'deepseek-flash',
  hasCompletedSetup: false,
  maxBackupsPerFile: 5,
  lastSeenVersion: '',
  autoCheckUpdate: true,
  autoDownload: true,
  updateMirror: 'server',
  customMirrorUrl: '',
  serverUrl: '',
  telemetryEnabled: true,
  clientId: '',
  lifetimeFirstStartAt: '',
  provider: 'deepseek',
  claudeDesktopProvider: 'deepseek',
  claudeCliProvider: 'deepseek',
  /** v1.16.0: 自定义供应商 Base URL（Codex 和 Claude 各一个）。 */
  customProvider: {
    codexBaseUrl: '',
    claudeBaseUrl: '',
  },
  claudeCli: {
    enabled: true,
    envVars: DEFAULT_ENV_VARS,
  },
  claudeDesktop: {
    enabled: true,
    modelMap: {},
  },
  migrations: {
    v130_claude: false,
    v160_claudeDesktopDirect: false,
    v200_deepseekDirect: false,
    v300_direct: false,
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

/**
 * 启动时迁移。
 *
 * v3.0.0: 删掉了「合并 DEFAULT_MAPPING / modelMappingVersion」那一段——模型映射表是
 * 本地代理用来把 Codex 发来的 OpenAI 模型名改写成上游模型名的，代理一删就没有读者了。
 * 存量 preferences.json 里残留的 modelMapping / modelMappingVersion 键不再清理
 * （electron-store 忽略未声明键，且清理属于写操作，与「不动存量」的取舍一致）。
 */
export function migrateIfNeeded(s: Store<UserPreferences>): void {
  // 记录首次启动日期（用于「早期成员」徽章，与代理无关）
  if (!s.get('lifetimeFirstStartAt')) {
    const today = new Date().toISOString().slice(0, 10);
    s.set('lifetimeFirstStartAt', today);
  }
  // v1.7.0: 存量用户迁移到 server mirror。v3.0.0 起 'auto' 模式已从类型中移除，
  // 但**这条迁移必须保留**——老用户的 preferences.json 里还存着 'auto'。
  const currentMirror = s.get('updateMirror') as string;
  if (currentMirror === 'auto') {
    s.set('updateMirror', 'server');
  }
  // v1.16.0: 存量 PackyCode 用户 provider 类型重命名为 custom
  const legacyProviders = ['packycode'] as const;
  const providerFields = ['provider', 'claudeDesktopProvider', 'claudeCliProvider'] as const;
  for (const field of providerFields) {
    const val = s.get(field) as string;
    if ((legacyProviders as readonly string[]).includes(val)) {
      s.set(field as keyof UserPreferences, 'custom');
    }
  }
}

// H6: write mutex — serializes preferences writes to prevent race conditions
// between concurrent IPC handlers (e.g., applyPreferencesTransaction rollback
// and prefsSet from another channel).
let writeMutex: Promise<void> = Promise.resolve();

export function getPreferences(): UserPreferences {
  return getStore().store;
}

export function setPreferences(patch: Partial<UserPreferences>): UserPreferences {
  const s = getStore();
  const next = { ...s.store, ...patch };
  s.store = next;
  return next;
}

/**
 * 标记某个一次性迁移已执行（v3.0.0）。
 *
 * ⚠️ **不要**直接写 `setPreferences({ migrations: { <key>: true } })`：那是**浅合并**，
 * patch 里的 `migrations` 会**整体替换**旧对象，把另外两条迁移的 flag 一并抹掉 ——
 * 于是三者互为对方的「未执行」，形成「每次启动重跑全部迁移」的循环（并连带每次都重写
 * Claude 配置、堆积备份）。这里做键级合并。
 */
export function setMigrationFlag(key: keyof MigrationFlags): void {
  const current = getPreferences().migrations ?? {};
  setPreferences({ migrations: { ...current, [key]: true } });
}

/** Serialized write — use when the caller needs to guarantee ordering. */
export async function setPreferencesSerialized(
  patch: Partial<UserPreferences>,
): Promise<UserPreferences> {
  return new Promise((resolve) => {
    writeMutex = writeMutex.then(() => {
      resolve(setPreferences(patch));
    });
  });
}
