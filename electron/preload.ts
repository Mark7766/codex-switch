import { contextBridge, ipcRenderer } from 'electron';

// IPC 常量内联（preload 不依赖本地 require('./ipc/channels')，
// 避免打包进 asar 后依赖加载链断裂导致 contextBridge 未执行）
const IPC = {
  providersList: 'providers:list',
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
  helpOpenLogsDir: 'help:open-logs-dir',
  helpOpenExternal: 'help:open-external',
  helpGetDiagnostics: 'help:get-diagnostics',
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  updateSetMirror: 'update:set-mirror',
  updateOnEvent: 'update:on-event',
  claudeDetect: 'claude:detect',
  claudeApplyAll: 'claude:apply-all',
  claudeUninstallCli: 'claude:uninstall-cli',
  claudeUninstallDesktop: 'claude:uninstall-desktop',
  claudeUninstallAll: 'claude:uninstall-all',
  claudeDesktopBackups: 'claude:desktop-backups',
  claudeDesktopRestore: 'claude:desktop-restore',
  telemetrySetEnabled: 'telemetry:set-enabled',
  serverPing: 'server:ping',
  codexHasOriginalBackup: 'codex:has-original-backup',
  codexRestoreOriginal: 'codex:restore-original',
  // v1.10.0 离线插件安装
  shareGetText: 'share:get-text',
  communityGetCount: 'community:get-count',
  communityGetProfile: 'community:get-profile',
} as const;

const api = {
  // 偏好
  // v3.0.0 供应商注册表（纯数据：供应商标签、模型列表、档位默认值、Key 元信息）
  getProviders: () => ipcRenderer.invoke(IPC.providersList),
  getPreferences: () => ipcRenderer.invoke(IPC.prefsGet),
  setPreferences: (patch: unknown) => ipcRenderer.invoke(IPC.prefsSet, patch),
  applyPreferences: (patch: unknown) => ipcRenderer.invoke(IPC.prefsApply, patch),
  // 密钥（v3.0.0 对供应商泛型化）
  getKey: (providerId: string) => ipcRenderer.invoke(IPC.keyGet, providerId),
  setKey: (providerId: string, key: string) => ipcRenderer.invoke(IPC.keySet, providerId, key),
  clearKey: (providerId: string) => ipcRenderer.invoke(IPC.keyClear, providerId),
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
  openLogsDir: () => ipcRenderer.invoke(IPC.helpOpenLogsDir),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.helpOpenExternal, url),
  getDiagnostics: () => ipcRenderer.invoke(IPC.helpGetDiagnostics),
  // 更新
  updateCheck: () => ipcRenderer.invoke(IPC.updateCheck),
  updateInstall: () => ipcRenderer.invoke(IPC.updateInstall),
  updateSetMirror: (mirror: string, custom?: string) =>
    ipcRenderer.invoke(IPC.updateSetMirror, mirror, custom),
  onUpdateEvent: (cb: (e: unknown) => void) => {
    const handler = (_: unknown, e: unknown) => cb(e);
    ipcRenderer.on(IPC.updateOnEvent, handler);
    return () => ipcRenderer.removeListener(IPC.updateOnEvent, handler);
  },
  // v1.3.0 Claude 接入
  claudeDetect: () => ipcRenderer.invoke(IPC.claudeDetect),
  claudeApplyAll: () => ipcRenderer.invoke(IPC.claudeApplyAll),
  claudeUninstallCli: () => ipcRenderer.invoke(IPC.claudeUninstallCli),
  claudeUninstallDesktop: () => ipcRenderer.invoke(IPC.claudeUninstallDesktop),
  claudeUninstallAll: () => ipcRenderer.invoke(IPC.claudeUninstallAll),
  claudeDesktopBackups: () => ipcRenderer.invoke(IPC.claudeDesktopBackups),
  claudeDesktopRestore: (backupPath: string) =>
    ipcRenderer.invoke(IPC.claudeDesktopRestore, backupPath),
  // v1.7.0 Server 集成
  telemetrySetEnabled: (enabled: boolean) => ipcRenderer.invoke(IPC.telemetrySetEnabled, enabled),
  serverPing: () => ipcRenderer.invoke(IPC.serverPing),
  // v1.9.0 对话记录来源切换
  codexHasOriginalBackup: () => ipcRenderer.invoke(IPC.codexHasOriginalBackup),
  codexRestoreOriginal: () => ipcRenderer.invoke(IPC.codexRestoreOriginal),
  // v1.10.0 离线插件安装
  // v1.11.0 邀请好友
  shareGetText: () => ipcRenderer.invoke(IPC.shareGetText),
  communityGetCount: () => ipcRenderer.invoke(IPC.communityGetCount),
  communityGetProfile: () => ipcRenderer.invoke(IPC.communityGetProfile),
};

contextBridge.exposeInMainWorld('codexSwitch', api);

export type CodexSwitchApi = typeof api;
