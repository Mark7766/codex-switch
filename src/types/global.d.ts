/** preload 暴露到 window.codexSwitch 上的类型声明（仅渲染侧使用） */
interface UpdateEvent {
  kind:
    | 'checking'
    | 'available'
    | 'not-available'
    | 'error'
    | 'download-progress'
    | 'downloaded'
    | 'manual-download';
  version?: string;
  message?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
}

interface DiagnosticsBundle {
  version: string;
  os: string;
  arch: string;
  prefs: Record<string, unknown>;
  generatedAt: number;
}

interface FaqItem {
  id: string;
  question: string;
  answer: string;
  tag?: string;
}

interface OnboardingStep {
  title: string;
  body: string;
  copy?: string;
}

/**
 * v3.0.0 供应商描述符 —— **渲染层镜像**。
 *
 * 权威定义在 `electron/config/providers.ts`。渲染进程不能 import `electron/`（tsconfig 的
 * rootDir / include 各自独立），故这里手抄一份类型，数据经 `getProviders()` 通道获取。
 * 改主进程那边的形状时，务必同步这里。
 */
interface ProviderCodexConfig {
  providerId: string;
  name: string;
  baseUrl: string;
  reasoningEffort: string;
  preferredAuthMethod?: string;
  forcedLoginMethod?: string;
  bearerTokenInToml: boolean;
  requiresOpenAiAuth: boolean;
  contextWindowOverrides: boolean;
  featureFlags: boolean;
  models: string[];
  defaultModel: string;
  catalogAsset?: string;
  retiredModels?: Record<string, string>;
  retiredPrefixes?: string[];
}

interface ProviderClaudeConfig {
  baseUrl: string;
  models: string[];
  slots: Array<{ id: string; tier: 'opus' | 'sonnet' | 'haiku'; label: string }>;
  roleDefaults: Record<'opus' | 'sonnet' | 'haiku', string>;
  includeHaiku: boolean;
  acceptedModelPrefixes: string[];
}

interface ProviderKeyConfig {
  account: string;
  fallbackField: string;
  prefix?: string;
  minLength: number;
  placeholder: string;
  hint: string;
}

interface ProviderDescriptor {
  id: 'deepseek' | 'glm' | 'custom';
  label: string;
  codex: ProviderCodexConfig;
  claude: ProviderClaudeConfig;
  key: ProviderKeyConfig;
}

interface CodexSwitchApi {
  getProviders: () => Promise<ProviderDescriptor[]>;
  /** 与 `electron/config/store.ts` 的 UserPreferences 对齐（代理专属字段已于 v3.0.0 移除）。 */
  getPreferences: () => Promise<{
    defaultModel: string;
    hasCompletedSetup: boolean;
    maxBackupsPerFile: number;
    lastSeenVersion: string;
    autoCheckUpdate: boolean;
    autoDownload: boolean;
    updateMirror: 'server' | 'github' | 'ghproxy' | 'custom';
    customMirrorUrl: string;
    serverUrl: string;
    telemetryEnabled: boolean;
    clientId: string;
    /** 首次启动日期（「早期成员」徽章用），与代理统计无关。 */
    lifetimeFirstStartAt: string;
    provider: 'deepseek' | 'glm' | 'custom';
    claudeDesktopProvider: 'deepseek' | 'glm' | 'custom';
    claudeCliProvider: 'deepseek' | 'glm' | 'custom';
    customProvider?: { codexBaseUrl: string; claudeBaseUrl: string };
    claudeCli?: { enabled: boolean; envVars: Record<string, string> };
    claudeDesktop?: { enabled: boolean; modelMap: Record<string, string> };
    migrations?: { v130_claude: boolean; v160_claudeDesktopDirect: boolean };
  }>;
  setPreferences: (patch: Record<string, unknown>) => Promise<unknown>;
  applyPreferences: (
    patch: Record<string, unknown> & { codexModel?: string },
  ) => Promise<{ prefs: unknown; codexWritten: boolean }>;
  /** v3.0.0 对供应商泛型化：providerId 取自 getProviders() */
  getKey: (providerId: string) => Promise<string>;
  setKey: (providerId: string, key: string) => Promise<boolean>;
  clearKey: (providerId: string) => Promise<boolean>;
  onSecondInstance: (cb: () => void) => () => void;
  codexWrite: (payload: { model: string }) => Promise<{
    configBackup: string | null;
    authBackup: string | null;
    configPath: string;
    authPath: string;
    configSkipped: boolean;
    authSkipped: boolean;
    prunedBackups: string[];
  }>;
  codexBackups: () => Promise<{ config: string[]; auth: string[] }>;
  codexRestore: (backupPath: string) => Promise<string>;
  codexBackupClean: () => Promise<{ deleted: string[] }>;
  codexBackupDelete: (backupPath: string) => Promise<{ deleted: boolean }>;
  getVersion: () => Promise<string>;
  getChangelog: () => Promise<string>;
  // 帮助
  getFaq: () => Promise<FaqItem[]>;
  getOnboarding: () => Promise<OnboardingStep[]>;
  openLogsDir: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  getDiagnostics: () => Promise<DiagnosticsBundle>;
  // 更新
  updateCheck: () => Promise<UpdateEvent>;
  updateInstall: () => Promise<void>;
  updateSetMirror: (
    mirror: 'server' | 'github' | 'ghproxy' | 'custom',
    custom?: string,
  ) => Promise<void>;
  onUpdateEvent: (cb: (e: UpdateEvent) => void) => () => void;
  // 持久化日志
  claudeDetect: () => Promise<DetectResult>;
  claudeApplyAll: () => Promise<DetectResult>;
  claudeUninstallCli: () => Promise<DetectResult>;
  claudeUninstallDesktop: () => Promise<DetectResult>;
  claudeUninstallAll: () => Promise<DetectResult>;
  claudeDesktopBackups: () => Promise<string[]>;
  claudeDesktopRestore: (backupPath: string) => Promise<void>;
  // v1.7.0 Server 集成
  telemetrySetEnabled: (enabled: boolean) => Promise<void>;
  serverPing: () => Promise<boolean>;
  // v1.9.0 对话缓存
  codexHasOriginalBackup: () => Promise<boolean>;
  codexRestoreOriginal: () => Promise<boolean>;
  // v1.10.0 离线插件安装
  // v1.11.0 邀请好友
  shareGetText: () => Promise<string>;
  communityGetCount: () => Promise<number>;
  communityGetProfile: () => Promise<{
    client_number?: number;
    is_early_member?: boolean;
    joined_date?: string;
    invite_count?: number;
  } | null>;
}

/** 工具安装与配置状态。 */
interface ToolStatus {
  installed: boolean;
  configApplied: boolean;
  configPath?: string;
  /** Shell profile paths where env vars are injected (Claude Code CLI only). */
  profilePaths?: string[];
}

/** 四个工具的检测结果。 */
interface DetectResult {
  codexDesktop: ToolStatus;
  codexCli: ToolStatus;
  claudeCli: ToolStatus;
  claudeDesktop: ToolStatus;
}

interface Window {
  codexSwitch: CodexSwitchApi;
}
