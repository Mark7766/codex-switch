/** preload 暴露到 window.codexSwitch 上的类型声明（仅渲染侧使用） */
interface CodexSwitchApi {
  getPreferences: () => Promise<{
    proxyPort: number;
    defaultModel: 'deepseek-v4-flash' | 'deepseek-v4-pro';
    modelMapping: Record<string, string>;
    autoStartProxy: boolean;
    hasCompletedSetup: boolean;
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
    logs: Array<{ ts: number; level: string; source: string; message: string }>;
  }>;
  onProxyStatus: (cb: (status: string) => void) => () => void;
  onProxyLog: (cb: (entry: unknown) => void) => () => void;
  codexWrite: (payload: { model: string }) => Promise<{
    configBackup: string | null;
    authBackup: string | null;
    configPath: string;
    authPath: string;
  }>;
  codexBackups: () => Promise<{ config: string[]; auth: string[] }>;
  codexRestore: (backupPath: string) => Promise<string>;
  getVersion: () => Promise<string>;
}

interface Window {
  codexSwitch: CodexSwitchApi;
}
