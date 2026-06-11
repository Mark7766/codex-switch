import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import log from 'electron-log';

import { IPC } from './ipc/channels';
import { getPreferences, setPreferences, type UserPreferences } from './config/store';
import { clearApiKey, getApiKey, setApiKey } from './config/secrets';
import {
  DeepSeekProxy,
  type ProxyLogEntry,
  type ProxyStatus,
  type ProxyErrorInfo,
} from './proxy/server';
import {
  listBackups,
  restoreCodexConfig,
  writeCodexConfig,
  deleteBackup,
  cleanAllBackups,
} from './codex/writer';
import { UpdaterManager, type UpdateEvent } from './updater';
import { redactSensitive } from './proxy/errors';
import { PersistentLog } from './proxy/persistentLog';
import { lookupPortHolder, killPid } from './proxy/portInfo';
import { detectAll } from './claude/detect';
import { writeClaudeCliConfig, removeClaudeCliConfig } from './claude/env-writer';
import {
  writeClaudeDesktopConfig,
  removeClaudeDesktopConfig,
  listClaudeDesktopBackups,
  restoreClaudeDesktopBackup,
} from './claude/desktop-writer';
import {
  runV130ClaudeMigration,
  runV160ClaudeDesktopMigration,
  startupApplyClaude,
} from './config/migrations';

log.transports.file.level = 'info';
log.transports.console.level = 'debug';

let mainWindow: BrowserWindow | null = null;
let proxy: DeepSeekProxy | null = null;
const logBuffer: ProxyLogEntry[] = [];
const LOG_BUFFER_MAX = 500;
const updater = new UpdaterManager();
updater.on('event', (e: UpdateEvent) => {
  mainWindow?.webContents.send(IPC.updateOnEvent, e);
});

let persistentLog: PersistentLog | null = null;
let lifetimeFlushTimer: NodeJS.Timeout | null = null;
let lifetimeFlushing = false;
let isInstallingUpdate = false;

// §5 单实例锁：第二实例直接退出，主实例聚焦窗口并广播 toast。
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  mainWindow.webContents.send(IPC.appOnSecondInstance);
});

async function ensureProxy(): Promise<DeepSeekProxy> {
  if (proxy) return proxy;
  const prefs = getPreferences();
  const apiKey = await getApiKey();
  proxy = new DeepSeekProxy({
    apiKey,
    port: prefs.proxyPort,
    modelMapping: prefs.modelMapping,
    defaultModel: prefs.defaultModel,
    blockBackgroundSuggestions: prefs.blockBackgroundSuggestions,
  });
  proxy.on('status', (status: ProxyStatus) => {
    mainWindow?.webContents.send(IPC.proxyOnStatus, status);
  });
  proxy.on('log', (entry: ProxyLogEntry) => {
    logBuffer.push(entry);
    if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
    mainWindow?.webContents.send(IPC.proxyOnLog, entry);
    persistentLog?.append(entry);
    log.info(`[${entry.source}] ${entry.message}`);
  });
  proxy.on('proxy-error', (info: ProxyErrorInfo) => {
    mainWindow?.webContents.send(IPC.proxyOnError, info);
    try {
      setPreferences({ lastErrorMessage: info.message, lastErrorAt: Date.now() });
    } catch (e) {
      log.warn('记录 lastError 失败：', (e as Error).message);
    }
  });
  return proxy;
}

function isDev(): boolean {
  return !app.isPackaged;
}

async function createWindow(): Promise<void> {
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

/** §3：事务性应用偏好——store → ~/.codex → 必要时重启代理。任一步失败抛出。 */
async function applyPreferencesTransaction(
  patch: Partial<UserPreferences> & { codexModel?: string },
): Promise<{
  prefs: UserPreferences;
  codexWritten: boolean;
  restarted: boolean;
  portChanged: boolean;
}> {
  const before = getPreferences();
  const { codexModel, ...prefsPatch } = patch;
  const portChanged =
    prefsPatch.proxyPort !== undefined && prefsPatch.proxyPort !== before.proxyPort;
  const apiKey = await getApiKey();

  // 1) 写偏好
  const next = setPreferences(prefsPatch);

  // 2) 同步代理选项（不重启）
  if (proxy) {
    proxy.updateOptions({
      port: next.proxyPort,
      modelMapping: next.modelMapping,
      defaultModel: next.defaultModel,
      blockBackgroundSuggestions: next.blockBackgroundSuggestions,
    });
  }

  // 3) 写 ~/.codex（必须有 apiKey）
  let codexWritten = false;
  if (apiKey) {
    try {
      await writeCodexConfig({
        proxyPort: next.proxyPort,
        model: codexModel || next.defaultModel,
        apiKey,
      });
      codexWritten = true;
    } catch (e) {
      // 回滚 store
      setPreferences(before);
      if (proxy) {
        proxy.updateOptions({
          port: before.proxyPort,
          modelMapping: before.modelMapping,
          defaultModel: before.defaultModel,
          blockBackgroundSuggestions: before.blockBackgroundSuggestions,
        });
      }
      throw e;
    }
  }

  // 4) 端口变了且代理在跑则重启
  let restarted = false;
  if (portChanged && proxy && proxy.getStatus() === 'running') {
    await proxy.restart();
    restarted = true;
  }

  return { prefs: next, codexWritten, restarted, portChanged };
}

function registerIpc(): void {
  ipcMain.handle(IPC.prefsGet, () => getPreferences());
  ipcMain.handle(IPC.prefsSet, async (_e, patch: Partial<UserPreferences>) => {
    const next = setPreferences(patch);
    if (proxy) {
      proxy.updateOptions({
        port: next.proxyPort,
        modelMapping: next.modelMapping,
        defaultModel: next.defaultModel,
        blockBackgroundSuggestions: next.blockBackgroundSuggestions,
      });
    }
    return next;
  });
  ipcMain.handle(
    IPC.prefsApply,
    async (_e, patch: Partial<UserPreferences> & { codexModel?: string }) => {
      return applyPreferencesTransaction(patch ?? {});
    },
  );

  ipcMain.handle(IPC.keyGet, async () => {
    const v = await getApiKey();
    return v ? `${v.slice(0, 4)}…${v.slice(-4)}` : '';
  });
  ipcMain.handle(IPC.keySet, async (_e, key: string) => {
    await setApiKey(key);
    if (proxy) proxy.updateOptions({ apiKey: key });
    // Auto-apply Claude configs for any installed tools when user saves a key.
    const prefs = getPreferences();
    if (prefs.claudeCli.enabled || prefs.claudeDesktop.enabled) {
      detectAll()
        .then(async (result) => {
          if (
            prefs.claudeCli.enabled &&
            result.claudeCli.installed &&
            !result.claudeCli.configApplied
          ) {
            await writeClaudeCliConfig(key, prefs.claudeCli.envVars).catch((e) =>
              log.warn('[main] claudeCli 自动写入失败：', (e as Error).message),
            );
          }
          if (
            prefs.claudeDesktop.enabled &&
            result.claudeDesktop.installed &&
            !result.claudeDesktop.configApplied
          ) {
          await writeClaudeDesktopConfig(key).catch((e) =>
            log.warn('[main] claudeDesktop 自动写入失败：', (e as Error).message),
          );
          }
        })
        .catch((e) => log.warn('[main] 保存 key 后检测失败：', (e as Error).message));
    }
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
    const prefs = getPreferences();
    const lifetime = {
      requestCount: prefs.lifetimeRequestCount,
      uptimeSec: prefs.lifetimeUptimeSec,
      firstStartAt: prefs.lifetimeFirstStartAt,
      inputTokens: prefs.lifetimeInputTokens,
      outputTokens: prefs.lifetimeOutputTokens,
    };
    const lastError = prefs.lastErrorMessage
      ? { message: prefs.lastErrorMessage, ts: prefs.lastErrorAt }
      : null;
    if (!proxy) {
      return {
        status: 'stopped' as const,
        port: prefs.proxyPort,
        uptimeMs: 0,
        requestCount: 0,
        logs: [],
        recentStats: { total: 0, successRate: 1, avgDurationMs: 0, lastError: null },
        lifetime,
        lastError,
      };
    }
    return {
      status: proxy.getStatus(),
      port: proxy.getPort(),
      uptimeMs: proxy.getUptimeMs(),
      requestCount: proxy.getRequestCount(),
      logs: logBuffer.slice(-200),
      recentStats: proxy.getRecentStats(),
      lifetime,
      lastError,
    };
  });
  ipcMain.handle(IPC.proxyLookupPort, async (_e, port: number) => {
    return lookupPortHolder(port);
  });
  ipcMain.handle(IPC.proxyKillPort, async (_e, port: number) => {
    const holder = await lookupPortHolder(port);
    if (!holder) return { ok: false, reason: 'no-holder' as const };
    const out = await killPid(holder.pid, holder.command);
    return { ...out, holder };
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

  ipcMain.handle(IPC.appGetChangelog, async () => {
    const candidates = app.isPackaged
      ? [
          path.join(process.resourcesPath, 'CHANGELOG.md'),
          path.join(process.resourcesPath, 'app.asar.unpacked', 'CHANGELOG.md'),
        ]
      : [
          path.join(__dirname, '..', '..', 'CHANGELOG.md'),
          path.join(process.cwd(), 'CHANGELOG.md'),
        ];
    for (const p of candidates) {
      try {
        return await fs.readFile(p, 'utf-8');
      } catch {
        /* try next */
      }
    }
    return '# 更新记录\n\n（未找到 CHANGELOG.md）\n';
  });

  // ─── 帮助中心 ─────────────────────────────────────────────────────────
  ipcMain.handle(IPC.helpGetFaq, () => readHelpJson('faq.json'));
  ipcMain.handle(IPC.helpGetOnboarding, () => readHelpJson('onboarding.json'));
  ipcMain.handle(IPC.helpGetQaImage, async () => {
    const candidates = app.isPackaged
      ? [path.join(process.resourcesPath, 'docs', 'qa.png')]
      : [path.join(process.cwd(), 'docs', 'qa.png')];
    for (const p of candidates) {
      try {
        const b = await fs.readFile(p);
        return `data:image/png;base64,${b.toString('base64')}`;
      } catch {
        /* try next */
      }
    }
    return '';
  });
  ipcMain.handle(IPC.helpOpenLogsDir, () => {
    const p = log.transports.file.getFile().path;
    shell.showItemInFolder(p);
  });
  ipcMain.handle(IPC.helpOpenExternal, (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
  });
  ipcMain.handle(IPC.helpGetDiagnostics, () => {
    const prefs = getPreferences();
    const safePrefs: Record<string, unknown> = { ...prefs };
    delete (safePrefs as Record<string, unknown>).modelMapping;
    const recent = logBuffer.slice(-100).map((l) => ({
      ...l,
      message: redactSensitive(l.message),
    }));
    return {
      version: app.getVersion(),
      os: process.platform,
      arch: process.arch,
      prefs: safePrefs,
      recentLogs: recent,
      generatedAt: Date.now(),
    };
  });

  // ─── 自动更新 ─────────────────────────────────────────────────────────
  ipcMain.handle(IPC.updateCheck, async () => {
    await updater.check();
  });
  ipcMain.handle(IPC.updateDownload, async () => {
    await updater.download();
  });
  ipcMain.handle(IPC.updateInstall, async () => {
    log.info('用户点击升级，准备清理资源并重启安装…');
    isInstallingUpdate = true;
    try {
      if (lifetimeFlushTimer) clearInterval(lifetimeFlushTimer);
      if (proxy) {
        await Promise.race([
          flushLifetime(),
          new Promise((resolve) => setTimeout(resolve, 1500)), // 限时 1.5s
        ]);
        await Promise.race([
          proxy.stop(),
          new Promise((resolve) => setTimeout(resolve, 2000)), // 限时 2s
        ]);
      }
      await Promise.race([
        persistentLog?.close(),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
    } catch (e) {
      log.warn('清理资源准备更新失败：', (e as Error).message);
    }
    updater.install();
  });
  ipcMain.handle(
    IPC.updateSetMirror,
    async (_e, mirror: 'auto' | 'github' | 'ghproxy' | 'custom', custom?: string) => {
      await updater.setMirror(mirror, custom);
      setPreferences({ updateMirror: mirror, customMirrorUrl: custom ?? '' });
    },
  );

  // ─── 备份治理 ─────────────────────────────────────────────────────────
  ipcMain.handle(IPC.codexBackupClean, async () => ({ deleted: await cleanAllBackups() }));
  ipcMain.handle(IPC.codexBackupDelete, async (_e, p: string) => ({
    deleted: await deleteBackup(p),
  }));

  // ─── 持久化日志 ───────────────────────────────────────────────────────
  ipcMain.handle(IPC.logsLoadPersisted, async (_e, limit?: number) => {
    if (!persistentLog) return [];
    return persistentLog.loadTail(typeof limit === 'number' && limit > 0 ? limit : 500);
  });
  ipcMain.handle(IPC.logsClearPersisted, async () => {
    if (persistentLog) await persistentLog.clearAll();
    logBuffer.length = 0;
    return true;
  });
  ipcMain.handle(IPC.logsOpenDir, () => {
    if (persistentLog) shell.showItemInFolder(persistentLog.getFilePath());
  });
  ipcMain.handle(IPC.logsGetStats, async () => {
    if (!persistentLog) return { files: 0, totalBytes: 0 };
    return persistentLog.getStats();
  });

  // ─── v1.3.0 Claude 接入 ──────────────────────────────────────────────
  ipcMain.handle(IPC.claudeDetect, () => detectAll());
  ipcMain.handle(IPC.claudeApplyAll, async () => {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('请先填写 DeepSeek API Key');
    const prefs = getPreferences();
    const result = await detectAll();
    if (prefs.claudeCli.enabled && result.claudeCli.installed) {
      await writeClaudeCliConfig(apiKey, prefs.claudeCli.envVars);
    }
    if (prefs.claudeDesktop.enabled && result.claudeDesktop.installed) {
      await writeClaudeDesktopConfig(apiKey);
    }
    return detectAll();
  });
  ipcMain.handle(IPC.claudeUninstallCli, async () => {
    await removeClaudeCliConfig();
    return detectAll();
  });
  ipcMain.handle(IPC.claudeUninstallDesktop, async () => {
    await removeClaudeDesktopConfig();
    return detectAll();
  });
  ipcMain.handle(IPC.claudeUninstallAll, async () => {
    await Promise.allSettled([removeClaudeCliConfig(), removeClaudeDesktopConfig()]);
    return detectAll();
  });
  ipcMain.handle(IPC.claudeDesktopBackups, () => listClaudeDesktopBackups());
  ipcMain.handle(IPC.claudeDesktopRestore, (_e, backupPath: string) =>
    restoreClaudeDesktopBackup(backupPath),
  );
}

async function readHelpJson(name: string): Promise<unknown> {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'docs', 'help', name)]
    : [path.join(process.cwd(), 'docs', 'help', name)];
  for (const p of candidates) {
    try {
      const t = await fs.readFile(p, 'utf-8');
      return JSON.parse(t);
    } catch {
      /* try next */
    }
  }
  return [];
}

/** §6：每 30s 把 proxy 累计的请求增量与运行时长合并到 prefs。 */
async function flushLifetime(): Promise<void> {
  if (lifetimeFlushing) return;
  if (!proxy) return;
  lifetimeFlushing = true;
  try {
    const { requestsDelta, uptimeMs, inputTokensDelta, outputTokensDelta } =
      proxy.consumeLifetimeDelta();
    if (requestsDelta === 0 && uptimeMs === 0) return;
    const cur = getPreferences();
    setPreferences({
      lifetimeRequestCount: cur.lifetimeRequestCount + requestsDelta,
      // 仅当代理在跑时累加；uptimeMs 是当前会话累计时长，所以不能直接加
      // 这里用增量：上次 flush 时已经把 uptimeMs 记到 sessionLastUptimeMs
      lifetimeUptimeSec: cur.lifetimeUptimeSec + Math.floor(consumeUptimeDelta(uptimeMs) / 1000),
      lifetimeInputTokens: cur.lifetimeInputTokens + inputTokensDelta,
      lifetimeOutputTokens: cur.lifetimeOutputTokens + outputTokensDelta,
    });
  } catch (e) {
    log.warn('flushLifetime 失败：', (e as Error).message);
  } finally {
    lifetimeFlushing = false;
  }
}

let sessionLastUptimeMs = 0;
function consumeUptimeDelta(currentUptimeMs: number): number {
  // currentUptimeMs 为 0 表示代理已停；把 baseline 重置。
  if (currentUptimeMs === 0) {
    sessionLastUptimeMs = 0;
    return 0;
  }
  const delta = currentUptimeMs - sessionLastUptimeMs;
  sessionLastUptimeMs = currentUptimeMs;
  return delta > 0 ? delta : 0;
}

app.whenReady().then(async () => {
  // 启动持久化日志
  try {
    persistentLog = new PersistentLog({ dir: path.join(app.getPath('userData'), 'logs') });
    await persistentLog.prune();
  } catch (e) {
    log.warn('持久化日志初始化失败：', (e as Error).message);
  }

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

  // v1.3.0 一次性迁移 + v1.6.0 直连 DeepSeek 迁移
  const apiKey = await getApiKey().catch(() => '');
  try {
    if (apiKey) await runV130ClaudeMigration(apiKey);
  } catch (e) {
    log.warn('v1.3.0 Claude 迁移失败：', (e as Error).message);
  }
  try {
    if (apiKey) await runV160ClaudeDesktopMigration(apiKey);
  } catch (e) {
    log.warn('v1.6.0 Claude Desktop 迁移失败：', (e as Error).message);
  }

  // 每次启动都重新写入 Claude 配置，确保外部工具更新后仍然生效。
  try {
    if (apiKey) await startupApplyClaude(apiKey);
  } catch (e) {
    log.warn('Startup Claude auto-apply 失败：', (e as Error).message);
  }

  if (prefs.autoCheckUpdate) {
    try {
      await updater.setMirror(prefs.updateMirror, prefs.customMirrorUrl);
      setTimeout(() => {
        updater.check().catch((e) => log.warn('检查更新失败：', (e as Error).message));
      }, 3000);
    } catch (e) {
      log.warn('更新初始化失败：', (e as Error).message);
    }
  }

  lifetimeFlushTimer = setInterval(() => {
    flushLifetime().catch(() => undefined);
  }, 30_000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let quitInProgress = false;
app.on('before-quit', (e) => {
  if (isInstallingUpdate) {
    // 升级安装时已在 IPC.updateInstall 中做过异步清理，此处直接放行。
    return;
  }
  if (quitInProgress) return;
  if (proxy && proxy.getStatus() !== 'stopped') {
    e.preventDefault();
    quitInProgress = true;
    if (lifetimeFlushTimer) clearInterval(lifetimeFlushTimer);
    flushLifetime().catch(() => undefined);
    const hardTimer = setTimeout(() => {
      log.warn('代理 stop 超时，强制退出');
      app.exit(0);
    }, 3000);
    proxy
      .stop()
      .catch(() => undefined)
      .finally(async () => {
        clearTimeout(hardTimer);
        try {
          await persistentLog?.close();
        } catch {
          /* ignore */
        }
        // 使用 exit(0) 确保进程彻底退出，避免 app.quit() 被某些残留窗口事件挂起（§13 稳定性修复）
        app.exit(0);
      });
  } else {
    if (lifetimeFlushTimer) clearInterval(lifetimeFlushTimer);
  }
});

// 引用以避免 dialog 未使用警告（dialog 预留给后续 logs:exportZip 等）
void dialog;
