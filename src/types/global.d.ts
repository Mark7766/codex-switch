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

interface PortHolder {
  pid: number;
  command: string;
}

interface ProxyErrorInfo {
  kind: 'port-conflict' | 'runtime' | 'auto-recover-failed';
  port: number;
  message: string;
  recoverable: boolean;
}

interface LifetimeStats {
  requestCount: number;
  uptimeSec: number;
  firstStartAt: string;
  inputTokens: number;
  outputTokens: number;
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
    updateMirror: 'server' | 'auto' | 'github' | 'ghproxy' | 'custom';
    customMirrorUrl: string;
    serverUrl: string;
    telemetryEnabled: boolean;
    clientId: string;
    hasSeenOnboarding: boolean;
    lifetimeRequestCount: number;
    lifetimeUptimeSec: number;
    lifetimeFirstStartAt: string;
    lastErrorMessage: string;
    lastErrorAt: number;
    blockBackgroundSuggestions: boolean;
    claudeCli?: { enabled: boolean; envVars: Record<string, string> };
    claudeDesktop?: { enabled: boolean };
    migrations?: { v130_claude: boolean; v160_claudeDesktopDirect: boolean };
  }>;
  setPreferences: (patch: Record<string, unknown>) => Promise<unknown>;
  applyPreferences: (
    patch: Record<string, unknown> & { codexModel?: string },
  ) => Promise<{ prefs: unknown; codexWritten: boolean; restarted: boolean; portChanged: boolean }>;
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
      inputTokens?: number;
      outputTokens?: number;
    }>;
    recentStats: {
      total: number;
      successRate: number;
      avgDurationMs: number;
      lastError: string | null;
    };
    lifetime: LifetimeStats;
    lastError: { message: string; ts: number } | null;
  }>;
  proxyLookupPort: (port: number) => Promise<PortHolder | null>;
  proxyKillPort: (port: number) => Promise<{
    ok: boolean;
    reason?: string;
    holder?: PortHolder;
    method?: string;
  }>;
  onProxyStatus: (cb: (status: string) => void) => () => void;
  onProxyLog: (cb: (entry: unknown) => void) => () => void;
  onProxyError: (cb: (info: ProxyErrorInfo) => void) => () => void;
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
  getQaImage: () => Promise<string>;
  openLogsDir: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  getDiagnostics: () => Promise<DiagnosticsBundle>;
  // 更新
  updateCheck: () => Promise<UpdateEvent>;
  updateDownload: () => Promise<void>;
  updateInstall: () => Promise<void>;
  updateSetMirror: (
    mirror: 'server' | 'auto' | 'github' | 'ghproxy' | 'custom',
    custom?: string,
  ) => Promise<void>;
  onUpdateEvent: (cb: (e: UpdateEvent) => void) => () => void;
  // 持久化日志
  loadPersistedLogs: (limit?: number) => Promise<unknown[]>;
  clearPersistedLogs: () => Promise<boolean>;
  openLogsFolder: () => Promise<void>;
  getLogsStats: () => Promise<{ files: number; totalBytes: number }>;
  // v1.3.0 Claude 接入
  claudeDetect: () => Promise<DetectResult>;
  claudeApplyAll: () => Promise<DetectResult>;
  claudeUninstallCli: () => Promise<DetectResult>;
  claudeUninstallDesktop: () => Promise<DetectResult>;
  claudeUninstallAll: () => Promise<DetectResult>;
  claudeDesktopBackups: () => Promise<string[]>;
  claudeDesktopRestore: (backupPath: string) => Promise<void>;
  // v1.7.0 Server 集成
  telemetrySetEnabled: (enabled: boolean) => Promise<void>;
  telemetryGetOnline: () => Promise<boolean>;
  serverPing: () => Promise<boolean>;
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
