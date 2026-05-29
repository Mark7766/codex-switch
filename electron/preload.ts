import { contextBridge, ipcRenderer } from 'electron';

// IPC 常量内联（preload 不依赖本地 require('./ipc/channels')，
// 避免打包进 asar 后依赖加载链断裂导致 contextBridge 未执行）
const IPC = {
  proxyStart: 'proxy:start',
  proxyStop: 'proxy:stop',
  proxyInfo: 'proxy:info',
  proxyOnStatus: 'proxy:on-status',
  proxyOnLog: 'proxy:on-log',
  prefsGet: 'prefs:get',
  prefsSet: 'prefs:set',
  keyGet: 'key:get',
  keySet: 'key:set',
  keyClear: 'key:clear',
  codexWrite: 'codex:write',
  codexBackups: 'codex:backups',
  codexRestore: 'codex:restore',
  appGetVersion: 'app:get-version',
} as const;

const api = {
  // 偏好
  getPreferences: () => ipcRenderer.invoke(IPC.prefsGet),
  setPreferences: (patch: unknown) => ipcRenderer.invoke(IPC.prefsSet, patch),
  // 密钥
  getApiKey: () => ipcRenderer.invoke(IPC.keyGet),
  setApiKey: (key: string) => ipcRenderer.invoke(IPC.keySet, key),
  clearApiKey: () => ipcRenderer.invoke(IPC.keyClear),
  // 代理
  proxyStart: () => ipcRenderer.invoke(IPC.proxyStart),
  proxyStop: () => ipcRenderer.invoke(IPC.proxyStop),
  proxyInfo: () => ipcRenderer.invoke(IPC.proxyInfo),
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
  // Codex
  codexWrite: (payload: unknown) => ipcRenderer.invoke(IPC.codexWrite, payload),
  codexBackups: () => ipcRenderer.invoke(IPC.codexBackups),
  codexRestore: (backupPath: string) => ipcRenderer.invoke(IPC.codexRestore, backupPath),
  // 应用信息
  getVersion: () => ipcRenderer.invoke(IPC.appGetVersion),
};

contextBridge.exposeInMainWorld('codexSwitch', api);

export type CodexSwitchApi = typeof api;
