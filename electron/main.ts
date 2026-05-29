import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import log from 'electron-log';

import { IPC } from './ipc/channels';
import { getPreferences, setPreferences, type UserPreferences } from './config/store';
import { clearApiKey, getApiKey, setApiKey } from './config/secrets';
import { DeepSeekProxy, type ProxyLogEntry, type ProxyStatus } from './proxy/server';
import { listBackups, restoreCodexConfig, writeCodexConfig } from './codex/writer';

log.transports.file.level = 'info';
log.transports.console.level = 'debug';

let mainWindow: BrowserWindow | null = null;
let proxy: DeepSeekProxy | null = null;
const logBuffer: ProxyLogEntry[] = [];
const LOG_BUFFER_MAX = 500;

async function ensureProxy(): Promise<DeepSeekProxy> {
  if (proxy) return proxy;
  const prefs = getPreferences();
  const apiKey = await getApiKey();
  proxy = new DeepSeekProxy({
    apiKey,
    port: prefs.proxyPort,
    modelMapping: prefs.modelMapping,
    defaultModel: prefs.defaultModel,
  });
  proxy.on('status', (status: ProxyStatus) => {
    mainWindow?.webContents.send(IPC.proxyOnStatus, status);
  });
  proxy.on('log', (entry: ProxyLogEntry) => {
    logBuffer.push(entry);
    if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
    mainWindow?.webContents.send(IPC.proxyOnLog, entry);
    log.info(`[${entry.source}] ${entry.message}`);
  });
  return proxy;
}

function isDev(): boolean {
  return !app.isPackaged;
}

async function createWindow(): Promise<void> {
  // packaged 时 preload 从 asar 解包目录加载，避免 asar 内 preload 加载静默失败
  const preloadPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'electron', 'preload.js')
    : path.join(__dirname, 'preload.js');

  mainWindow = new BrowserWindow({
    width: 980,
    height: 700,
    minWidth: 800,
    minHeight: 560,
    title: 'Codex Switch',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev()) {
    await mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.prefsGet, () => getPreferences());
  ipcMain.handle(IPC.prefsSet, (_e, patch: Partial<UserPreferences>) => {
    const next = setPreferences(patch);
    if (proxy) {
      proxy.updateOptions({
        port: next.proxyPort,
        modelMapping: next.modelMapping,
        defaultModel: next.defaultModel,
      });
    }
    return next;
  });

  ipcMain.handle(IPC.keyGet, async () => {
    const v = await getApiKey();
    return v ? `${v.slice(0, 4)}…${v.slice(-4)}` : '';
  });
  ipcMain.handle(IPC.keySet, async (_e, key: string) => {
    await setApiKey(key);
    if (proxy) proxy.updateOptions({ apiKey: key });
    return true;
  });
  ipcMain.handle(IPC.keyClear, async () => {
    await clearApiKey();
    if (proxy) proxy.updateOptions({ apiKey: '' });
    return true;
  });

  ipcMain.handle(IPC.proxyStart, async () => {
    const p = await ensureProxy();
    const port = await p.start();
    return { port, status: p.getStatus() };
  });
  ipcMain.handle(IPC.proxyStop, async () => {
    if (!proxy) return { status: 'stopped' as const };
    await proxy.stop();
    return { status: proxy.getStatus() };
  });
  ipcMain.handle(IPC.proxyInfo, async () => {
    if (!proxy) return { status: 'stopped' as const, port: 0, uptimeMs: 0, requestCount: 0, logs: [] };
    return {
      status: proxy.getStatus(),
      port: proxy.getPort(),
      uptimeMs: proxy.getUptimeMs(),
      requestCount: proxy.getRequestCount(),
      logs: logBuffer.slice(-200),
    };
  });

  ipcMain.handle(IPC.codexWrite, async (_e, payload: { model: string }) => {
    const prefs = getPreferences();
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('请先填写 DeepSeek API Key');
    return writeCodexConfig({
      proxyPort: proxy?.getPort() ?? prefs.proxyPort,
      model: payload.model || prefs.defaultModel,
      apiKey,
    });
  });
  ipcMain.handle(IPC.codexBackups, () => listBackups());
  ipcMain.handle(IPC.codexRestore, (_e, backupPath: string) => restoreCodexConfig(backupPath));
  ipcMain.handle(IPC.appGetVersion, () => app.getVersion());
}

app.whenReady().then(async () => {
  registerIpc();
  await createWindow();

  const prefs = getPreferences();
  if (prefs.hasCompletedSetup && prefs.autoStartProxy) {
    try {
      const p = await ensureProxy();
      await p.start();
    } catch (e) {
      log.error('自动启动代理失败：', (e as Error).message);
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (e) => {
  if (proxy && proxy.getStatus() === 'running') {
    e.preventDefault();
    await proxy.stop();
    app.quit();
  }
});
