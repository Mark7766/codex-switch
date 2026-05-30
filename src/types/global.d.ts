/** preload 暴露到 window.codexSwitch 上的类型声明（仅渲染侧使用） */
interface UpdateEvent {
  kind:
    | 'checking'
    | 'available'
    | 'not-available'
    | 'error'
    | 'download-progress'
    | 'downloaded';
  version?: string;
  notes?: string;
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
  recentLogs: Array<{
    ts: number;
    level: string;
    source: string;
    message: string;
    reqId?: string;
    phase?: string;
    statusCode?: number;
    durationMs?: number;
  }>;
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

interface CodexSwitchApi {
  getPreferences: () => Promise<{
    proxyPort: number;
    defaultModel: 'deepseek-v4-flash' | 'deepseek-v4-pro';
    modelMapping: Record<string, string>;
    autoStartProxy: boolean;
    hasCompletedSetup: boolean;
    modelMappingVersion: number;
    maxBackupsPerFile: number;
    lastSeenVersion: string;
    autoCheckUpdate: boolean;
    updateMirror: 'auto' | 'github' | 'ghproxy' | 'custom';
    customMirrorUrl: string;
    hasSeenOnboarding: boolean;
  }>;
  setPreferences: (patch: Record<string, unknown>) => Promise<unknown>;
  getApiKey: () => Promise<string>;
  setApiKey: (key: string) => Promise<boolean>;
  clearApiKey: () => Promise<boolean>;
  proxyStart: () => Promise<{ port: number; status: string }>;
  proxyStop: () => Promise<{ status: string }>;
  proxyInfo: () => Promise<{
    status: string;
    port: number;
    uptimeMs: number;
    requestCount: number;
    logs: Array<{
      ts: number;
      level: string;
      source: string;
      message: string;
      reqId?: string;
      phase?: string;
      durationMs?: number;
      model?: string;
      requestedModel?: string;
      statusCode?: number;
      errorReason?: string;
      errorAction?: string;
    }>;
    recentStats: {
      total: number;
      successRate: number;
      avgDurationMs: number;
      lastError: string | null;
    };
  }>;
  onProxyStatus: (cb: (status: string) => void) => () => void;
  onProxyLog: (cb: (entry: unknown) => void) => () => void;
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
  getQaImage: () => Promise<string>;
  openLogsDir: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  getDiagnostics: () => Promise<DiagnosticsBundle>;
  // 更新
  updateCheck: () => Promise<UpdateEvent>;
  updateDownload: () => Promise<void>;
  updateInstall: () => Promise<void>;
  updateSetMirror: (
    mirror: 'auto' | 'github' | 'ghproxy' | 'custom',
    custom?: string,
  ) => Promise<void>;
  onUpdateEvent: (cb: (e: UpdateEvent) => void) => () => void;
}

interface Window {
  codexSwitch: CodexSwitchApi;
}
