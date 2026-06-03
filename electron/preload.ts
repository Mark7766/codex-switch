import { contextBridge, ipcRenderer } from 'electron';

// IPC 常量内联（preload 不依赖本地 require('./ipc/channels')，
// 避免打包进 asar 后依赖加载链断裂导致 contextBridge 未执行）
const IPC = {
  proxyStart: 'proxy:start',
  proxyStop: 'proxy:stop',
  proxyInfo: 'proxy:info',
  proxyOnStatus: 'proxy:on-status',
  proxyOnLog: 'proxy:on-log',
  proxyOnError: 'proxy:on-error',
  proxyLookupPort: 'proxy:lookup-port',
  proxyKillPort: 'proxy:kill-port',
  prefsGet: 'prefs:get',
  prefsSet: 'prefs:set',
  prefsApply: 'prefs:apply',
  keyGet: 'key:get',
  keySet: 'key:set',
  keyClear: 'key:clear',
  codexWrite: 'codex:write',
  codexBackups: 'codex:backups',
  codexRestore: 'codex:restore',
  codexBackupClean: 'codex:backup-clean',
  codexBackupDelete: 'codex:backup-delete',
  appGetVersion: 'app:get-version',
  appGetChangelog: 'app:get-changelog',
  appOnSecondInstance: 'app:on-second-instance',
  helpGetFaq: 'help:get-faq',
  helpGetOnboarding: 'help:get-onboarding',
  helpGetQaImage: 'help:get-qa-image',
  helpOpenLogsDir: 'help:open-logs-dir',
  helpOpenExternal: 'help:open-external',
  helpGetDiagnostics: 'help:get-diagnostics',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  updateSetMirror: 'update:set-mirror',
  updateOnEvent: 'update:on-event',
  logsLoadPersisted: 'logs:load-persisted',
  logsClearPersisted: 'logs:clear-persisted',
  logsOpenDir: 'logs:open-dir',
  logsGetStats: 'logs:get-stats',
  claudeDetect: 'claude:detect',
  claudeApplyAll: 'claude:apply-all',
  claudeUninstallCli: 'claude:uninstall-cli',
  claudeUninstallDesktop: 'claude:uninstall-desktop',
  claudeUninstallAll: 'claude:uninstall-all',
  claudeDesktopBackups: 'claude:desktop-backups',
  claudeDesktopRestore: 'claude:desktop-restore',
} as const;

const api = {
  // 偏好
  getPreferences: () => ipcRenderer.invoke(IPC.prefsGet),
  setPreferences: (patch: unknown) => ipcRenderer.invoke(IPC.prefsSet, patch),
  applyPreferences: (patch: unknown) => ipcRenderer.invoke(IPC.prefsApply, patch),
  // 密钥
  getApiKey: () => ipcRenderer.invoke(IPC.keyGet),
  setApiKey: (key: string) => ipcRenderer.invoke(IPC.keySet, key),
  clearApiKey: () => ipcRenderer.invoke(IPC.keyClear),
  // 代理
  proxyStart: () => ipcRenderer.invoke(IPC.proxyStart),
  proxyStop: () => ipcRenderer.invoke(IPC.proxyStop),
  proxyInfo: () => ipcRenderer.invoke(IPC.proxyInfo),
  proxyLookupPort: (port: number) => ipcRenderer.invoke(IPC.proxyLookupPort, port),
  proxyKillPort: (port: number) => ipcRenderer.invoke(IPC.proxyKillPort, port),
  onProxyStatus: (cb: (status: string) => void) => {
    const handler = (_: unknown, status: string) => cb(status);
    ipcRenderer.on(IPC.proxyOnStatus, handler);
    return () => ipcRenderer.removeListener(IPC.proxyOnStatus, handler);
  },
  onProxyLog: (cb: (entry: unknown) => void) => {
    const handler = (_: unknown, entry: unknown) => cb(entry);
    ipcRenderer.on(IPC.proxyOnLog, handler);
    return () => ipcRenderer.removeListener(IPC.proxyOnLog, handler);
  },
  onProxyError: (cb: (info: unknown) => void) => {
    const handler = (_: unknown, info: unknown) => cb(info);
    ipcRenderer.on(IPC.proxyOnError, handler);
    return () => ipcRenderer.removeListener(IPC.proxyOnError, handler);
  },
  onSecondInstance: (cb: () => void) => {
    const handler = (): void => cb();
    ipcRenderer.on(IPC.appOnSecondInstance, handler);
    return () => ipcRenderer.removeListener(IPC.appOnSecondInstance, handler);
  },
  // Codex
  codexWrite: (payload: unknown) => ipcRenderer.invoke(IPC.codexWrite, payload),
  codexBackups: () => ipcRenderer.invoke(IPC.codexBackups),
  codexRestore: (backupPath: string) => ipcRenderer.invoke(IPC.codexRestore, backupPath),
  codexBackupClean: () => ipcRenderer.invoke(IPC.codexBackupClean),
  codexBackupDelete: (backupPath: string) => ipcRenderer.invoke(IPC.codexBackupDelete, backupPath),
  // 应用
  getVersion: () => ipcRenderer.invoke(IPC.appGetVersion),
  getChangelog: () => ipcRenderer.invoke(IPC.appGetChangelog),
  // 帮助
  getFaq: () => ipcRenderer.invoke(IPC.helpGetFaq),
  getOnboarding: () => ipcRenderer.invoke(IPC.helpGetOnboarding),
  getQaImage: () => ipcRenderer.invoke(IPC.helpGetQaImage),
  openLogsDir: () => ipcRenderer.invoke(IPC.helpOpenLogsDir),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.helpOpenExternal, url),
  getDiagnostics: () => ipcRenderer.invoke(IPC.helpGetDiagnostics),
  // 更新
  updateCheck: () => ipcRenderer.invoke(IPC.updateCheck),
  updateDownload: () => ipcRenderer.invoke(IPC.updateDownload),
  updateInstall: () => ipcRenderer.invoke(IPC.updateInstall),
  updateSetMirror: (mirror: string, custom?: string) =>
    ipcRenderer.invoke(IPC.updateSetMirror, mirror, custom),
  onUpdateEvent: (cb: (e: unknown) => void) => {
    const handler = (_: unknown, e: unknown) => cb(e);
    ipcRenderer.on(IPC.updateOnEvent, handler);
    return () => ipcRenderer.removeListener(IPC.updateOnEvent, handler);
  },
  // 持久化日志
  loadPersistedLogs: (limit?: number) => ipcRenderer.invoke(IPC.logsLoadPersisted, limit),
  clearPersistedLogs: () => ipcRenderer.invoke(IPC.logsClearPersisted),
  openLogsFolder: () => ipcRenderer.invoke(IPC.logsOpenDir),
  getLogsStats: () => ipcRenderer.invoke(IPC.logsGetStats),
  // v1.3.0 Claude 接入
  claudeDetect: () => ipcRenderer.invoke(IPC.claudeDetect),
  claudeApplyAll: () => ipcRenderer.invoke(IPC.claudeApplyAll),
  claudeUninstallCli: () => ipcRenderer.invoke(IPC.claudeUninstallCli),
  claudeUninstallDesktop: () => ipcRenderer.invoke(IPC.claudeUninstallDesktop),
  claudeUninstallAll: () => ipcRenderer.invoke(IPC.claudeUninstallAll),
  claudeDesktopBackups: () => ipcRenderer.invoke(IPC.claudeDesktopBackups),
  claudeDesktopRestore: (backupPath: string) =>
    ipcRenderer.invoke(IPC.claudeDesktopRestore, backupPath),
};

contextBridge.exposeInMainWorld('codexSwitch', api);

export type CodexSwitchApi = typeof api;
