import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import https from 'node:https';
import log from 'electron-log';

import { IPC } from './ipc/channels';
import {
  getPreferences,
  setPreferences,
  setPreferencesSerialized,
  type UserPreferences,
} from './config/store';
import {
  clearApiKey,
  getApiKey,
  setApiKey,
  getAgnesKey,
  setAgnesKey,
  clearAgnesKey,
  getGlmKey,
  setGlmKey,
  clearGlmKey,
} from './config/secrets';
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
  hasOriginalBackup,
  restoreOriginalConfig,
} from './codex/writer';
import { UpdaterManager, type UpdateEvent } from './updater';
import { redactSensitive } from './proxy/errors';
import { PersistentLog } from './proxy/persistentLog';
import { lookupPortHolder, killPid } from './proxy/portInfo';
import { detectAll } from './claude/detect';
import { writeClaudeCliConfig, removeClaudeCliConfig, resolveEnvVars } from './claude/env-writer';
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
import { ServerClient } from './server-client/client';
import { TelemetryClient } from './server-client/telemetry';
import { resolveServerUrl, generateClientId } from './server-client/config';
import { PluginManager } from './plugins/index';

log.transports.file.level = 'info';
log.transports.console.level = 'debug';

let mainWindow: BrowserWindow | null = null;
let proxy: DeepSeekProxy | null = null;
const logBuffer: ProxyLogEntry[] = [];
const LOG_BUFFER_MAX = 500;
const updater = new UpdaterManager();
updater.on('event', (e: UpdateEvent) => {
  mainWindow?.webContents.send(IPC.updateOnEvent, e);
  // v1.7.0 telemetry
  if (e.kind === 'available') {
    telemetry?.track('update_check', {
      current_version: app.getVersion(),
      has_update: true,
      mirror_mode: getPreferences().updateMirror,
    });
  } else if (e.kind === 'not-available') {
    telemetry?.track('update_check', {
      current_version: app.getVersion(),
      has_update: false,
      mirror_mode: getPreferences().updateMirror,
    });
  } else if (e.kind === 'downloaded') {
    telemetry?.track('update_download', {
      from_version: app.getVersion(),
      to_version: e.version ?? '',
      platform: process.platform,
      arch: process.arch,
    });
  }
});

let persistentLog: PersistentLog | null = null;
let lifetimeFlushTimer: NodeJS.Timeout | null = null;
let lifetimeFlushing = false;
let isInstallingUpdate = false;

// v1.7.0 Server 集成
let serverClient: ServerClient | null = null;
let telemetry: TelemetryClient | null = null;
// v1.10.0 离线插件安装
let pluginManager: PluginManager | null = null;

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
  const apiKey =
    prefs.provider === 'agnes'
      ? await getAgnesKey()
      : prefs.provider === 'glm'
        ? await getGlmKey()
        : await getApiKey();
  const upstreamBase =
    prefs.provider === 'agnes'
      ? 'apihub.agnes-ai.com'
      : prefs.provider === 'glm'
        ? 'open.bigmodel.cn'
        : 'api.deepseek.com';
  proxy = new DeepSeekProxy({
    apiKey,
    upstreamBase,
    agnesApiKey:
      prefs.provider === 'agnes'
        ? apiKey
        : prefs.provider === 'glm'
          ? ''
          : await getAgnesKey().catch(() => ''),
    agnesUpstreamBase: 'apihub.agnes-ai.com',
    activeModelMapping: prefs.activeModelMapping,
    port: prefs.proxyPort,
    modelMapping: prefs.modelMapping,
    defaultModel: prefs.defaultModel,
    blockBackgroundSuggestions: prefs.blockBackgroundSuggestions,
    // v1.14.1: 使用用户配置的缓存上限，确保与 store 一致
    cacheMaxEntries: prefs.conversationCacheLimit,
    // v1.7.0 telemetry: model_call 事件
    onModelCall: (event) => {
      telemetry?.track('model_call', event);
    },
  });
  proxy.on('status', (status: ProxyStatus) => {
    mainWindow?.webContents.send(IPC.proxyOnStatus, status);
    // v1.7.0 telemetry
    if (status === 'running') {
      telemetry?.track('proxy_start', {
        port: proxy?.getPort() ?? prefs.proxyPort,
        default_model: prefs.defaultModel,
      });
    } else if (status === 'stopped') {
      telemetry?.track('proxy_stop', {
        uptime_seconds: proxy ? Math.floor(proxy.getUptimeMs() / 1000) : 0,
        request_count: proxy?.getRequestCount() ?? 0,
      });
    }
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
    // v1.7.0 telemetry
    telemetry?.track('proxy_error', { error_kind: info.kind, port: info.port });
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
  const providerChanged =
    prefsPatch.provider !== undefined && prefsPatch.provider !== before.provider;
  const apiKey = await getApiKey();

  // 1) 写偏好（H6: serialized to prevent concurrent write races）
  const next = await setPreferencesSerialized(prefsPatch);

  // 2) 同步代理选项（不重启）
  if (proxy && !providerChanged) {
    proxy.updateOptions({
      port: next.proxyPort,
      modelMapping: next.modelMapping,
      defaultModel: next.defaultModel,
      blockBackgroundSuggestions: next.blockBackgroundSuggestions,
    });
  }
  // v1.10.0: sync PluginManager + ServerClient when serverUrl changes
  if (prefsPatch.serverUrl !== undefined) {
    const newUrl = resolveServerUrl(next);
    if (serverClient) serverClient.setBaseUrl(newUrl);
    if (pluginManager) pluginManager.setServerUrl(newUrl);
  }

  // 3) 供应商切换：更新 proxy 上游+Key + 映射（不写 config.toml，不重启）
  if (providerChanged && proxy) {
    const newKey =
      next.provider === 'agnes'
        ? await getAgnesKey()
        : next.provider === 'glm'
          ? await getGlmKey()
          : apiKey;
    const newUpstream =
      next.provider === 'agnes'
        ? 'apihub.agnes-ai.com'
        : next.provider === 'glm'
          ? 'open.bigmodel.cn'
          : 'api.deepseek.com';
    const agnesK = next.provider === 'deepseek' ? await getAgnesKey().catch(() => '') : undefined;
    const newModel =
      next.provider === 'agnes'
        ? 'agnes-2.0-flash'
        : next.provider === 'glm'
          ? 'glm-5.2'
          : 'deepseek-v4-flash';
    proxy.updateOptions({
      apiKey: newKey,
      upstreamBase: newUpstream,
      agnesApiKey: agnesK,
      defaultModel: newModel,
      activeModelMapping: {
        'codex-switch': { model: newModel, provider: next.provider },
      },
    });
  }

  // 4) 写 ~/.codex（必须有 apiKey；供应商切换时不重写）
  let codexWritten = false;
  if (!providerChanged && apiKey) {
    try {
      await writeCodexConfig({
        proxyPort: next.proxyPort,
        model: codexModel || next.defaultModel,
        apiKey,
      });
      codexWritten = true;
    } catch (e) {
      // H6: rollback with serialized write — re-read current prefs to avoid
      // overwriting concurrent changes from another IPC handler
      const current = getPreferences();
      await setPreferencesSerialized({
        proxyPort: before.proxyPort,
        defaultModel: before.defaultModel,
        modelMapping: before.modelMapping,
        blockBackgroundSuggestions: before.blockBackgroundSuggestions,
        ...Object.fromEntries(
          Object.keys(prefsPatch).map((k) => [
            k,
            (current as unknown as Record<string, unknown>)[k],
          ]),
        ),
      } as Partial<UserPreferences>);
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

  // 5) 端口变了且代理在跑则重启（供应商切换不重启）
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
    // H5: validate critical fields
    if (patch.proxyPort !== undefined) {
      if (
        typeof patch.proxyPort !== 'number' ||
        !Number.isInteger(patch.proxyPort) ||
        patch.proxyPort < 1 ||
        patch.proxyPort > 65535
      ) {
        throw new Error(`端口号无效：${patch.proxyPort}`);
      }
    }
    const next = setPreferences(patch);
    if (proxy) {
      proxy.updateOptions({
        port: next.proxyPort,
        modelMapping: next.modelMapping,
        defaultModel: next.defaultModel,
        blockBackgroundSuggestions: next.blockBackgroundSuggestions,
      });
    }
    // v1.10.0: sync PluginManager + ServerClient when user changes server URL
    if (patch.serverUrl !== undefined || patch.proxyPort !== undefined) {
      const newUrl = resolveServerUrl(next);
      if (serverClient) serverClient.setBaseUrl(newUrl);
      if (pluginManager) pluginManager.setServerUrl(newUrl);
    }
    return next;
  });
  ipcMain.handle(
    IPC.prefsApply,
    async (_e, patch: Partial<UserPreferences> & { codexModel?: string }) => {
      const result = await applyPreferencesTransaction(patch ?? {});
      // v1.7.0 telemetry
      const keys = Object.keys(patch ?? {});
      if (keys.length > 0) {
        telemetry?.track('config_write', { fields_changed: keys });
      }
      return result;
    },
  );

  ipcMain.handle(IPC.keyGet, async () => {
    const v = await getApiKey();
    return v ? `${v.slice(0, 4)}…${v.slice(-4)}` : '';
  });
  ipcMain.handle(IPC.agnesKeyGet, async () => {
    const v = await getAgnesKey();
    return v ? `${v.slice(0, 4)}…${v.slice(-4)}` : '';
  });
  ipcMain.handle(IPC.agnesKeySet, async (_e, key: string) => {
    if (typeof key !== 'string' || key.length < 4) {
      throw new Error('Agnes Key 格式不正确');
    }
    await setAgnesKey(key);
    if (proxy && getPreferences().provider === 'agnes') {
      proxy.updateOptions({ apiKey: key });
    }
    // v1.14.0: auto-apply Claude configs only for tools whose provider is Agnes.
    const prefs = getPreferences();
    if (prefs.claudeCli.enabled || prefs.claudeDesktop.enabled) {
      detectAll()
        .then(async (result) => {
          if (
            prefs.claudeCli.enabled &&
            (prefs.claudeCliProvider ?? 'deepseek') === 'agnes' &&
            result.claudeCli.installed &&
            !result.claudeCli.configApplied
          ) {
            await writeClaudeCliConfig(
              key,
              resolveEnvVars(prefs.claudeCli.envVars, 'agnes').envVars,
              'agnes',
            ).catch((e) => log.warn('[main] claudeCli 自动写入失败：', (e as Error).message));
          }
          if (
            prefs.claudeDesktop.enabled &&
            (prefs.claudeDesktopProvider ?? 'deepseek') === 'agnes' &&
            result.claudeDesktop.installed &&
            !result.claudeDesktop.configApplied
          ) {
            await writeClaudeDesktopConfig(key, 'agnes').catch((e) =>
              log.warn('[main] claudeDesktop 自动写入失败：', (e as Error).message),
            );
          }
        })
        .catch((e) => log.warn('[main] 保存 Agnes key 后检测失败：', (e as Error).message));
    }
    return true;
  });
  ipcMain.handle(IPC.agnesKeyClear, async () => {
    await clearAgnesKey();
    return true;
  });
  ipcMain.handle(IPC.glmKeyGet, async () => {
    const v = await getGlmKey();
    return v ? `${v.slice(0, 4)}…${v.slice(-4)}` : '';
  });
  ipcMain.handle(IPC.glmKeySet, async (_e, key: string) => {
    // H5: validate GLM key (JWT-style token, min 10 chars)
    if (typeof key !== 'string' || key.trim().length < 10) {
      throw new Error('GLM Key 格式不正确：长度应至少 10 位');
    }
    const trimmed = key.trim();
    await setGlmKey(trimmed);
    if (proxy && getPreferences().provider === 'glm') proxy.updateOptions({ apiKey: trimmed });
    // v1.14.0: auto-apply Claude configs only for tools whose provider is GLM.
    const prefs = getPreferences();
    if (prefs.claudeCli.enabled || prefs.claudeDesktop.enabled) {
      detectAll()
        .then(async (result) => {
          if (
            prefs.claudeCli.enabled &&
            (prefs.claudeCliProvider ?? 'deepseek') === 'glm' &&
            result.claudeCli.installed &&
            !result.claudeCli.configApplied
          ) {
            await writeClaudeCliConfig(
              trimmed,
              resolveEnvVars(prefs.claudeCli.envVars, 'glm').envVars,
              'glm',
            ).catch((e) => log.warn('[main] claudeCli 自动写入失败：', (e as Error).message));
          }
          if (
            prefs.claudeDesktop.enabled &&
            (prefs.claudeDesktopProvider ?? 'deepseek') === 'glm' &&
            result.claudeDesktop.installed &&
            !result.claudeDesktop.configApplied
          ) {
            await writeClaudeDesktopConfig(trimmed, 'glm').catch((e) =>
              log.warn('[main] claudeDesktop 自动写入失败：', (e as Error).message),
            );
          }
        })
        .catch((e) => log.warn('[main] 保存 GLM key 后检测失败：', (e as Error).message));
    }
    return true;
  });
  ipcMain.handle(IPC.glmKeyClear, async () => {
    await clearGlmKey();
    return true;
  });
  ipcMain.handle(IPC.keySet, async (_e, key: string) => {
    // H5: validate API key format
    if (typeof key !== 'string' || key.length < 10 || !key.startsWith('sk-')) {
      throw new Error('API Key 格式不正确：应以 sk- 开头且长度至少 10 位');
    }
    await setApiKey(key);
    if (proxy) proxy.updateOptions({ apiKey: key });
    // v1.14.0: auto-apply Claude configs only for tools whose provider is DeepSeek.
    const prefs = getPreferences();
    if (prefs.claudeCli.enabled || prefs.claudeDesktop.enabled) {
      detectAll()
        .then(async (result) => {
          if (
            prefs.claudeCli.enabled &&
            (prefs.claudeCliProvider ?? 'deepseek') === 'deepseek' &&
            result.claudeCli.installed &&
            !result.claudeCli.configApplied
          ) {
            await writeClaudeCliConfig(
              key,
              resolveEnvVars(prefs.claudeCli.envVars, 'deepseek').envVars,
              'deepseek',
            ).catch((e) => log.warn('[main] claudeCli 自动写入失败：', (e as Error).message));
          }
          if (
            prefs.claudeDesktop.enabled &&
            (prefs.claudeDesktopProvider ?? 'deepseek') === 'deepseek' &&
            result.claudeDesktop.installed &&
            !result.claudeDesktop.configApplied
          ) {
            await writeClaudeDesktopConfig(key, 'deepseek').catch((e) =>
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
    // H5: validate port range
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`端口号无效：${port}`);
    }
    return lookupPortHolder(port);
  });
  ipcMain.handle(IPC.proxyKillPort, async (_e, port: number) => {
    // H5: validate port range
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`端口号无效：${port}`);
    }
    const holder = await lookupPortHolder(port);
    if (!holder) return { ok: false, reason: 'no-holder' as const };
    const out = await killPid(holder.pid, holder.command);
    return { ...out, holder };
  });

  ipcMain.handle(IPC.codexWrite, async (_e, payload: { model: string }) => {
    // H5: validate payload
    if (!payload || typeof payload.model !== 'string' || payload.model.trim().length === 0) {
      throw new Error('模型名称不能为空');
    }
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
    async (_e, mirror: 'server' | 'auto' | 'github' | 'ghproxy' | 'custom', custom?: string) => {
      const prefs = getPreferences();
      const serverUrl = resolveServerUrl(prefs);
      await updater.setMirror(mirror, custom, serverUrl);
      setPreferences({ updateMirror: mirror, customMirrorUrl: custom ?? '' });
    },
  );

  // ─── 备份治理 ─────────────────────────────────────────────────────────
  ipcMain.handle(IPC.codexBackupClean, async () => ({ deleted: await cleanAllBackups() }));
  ipcMain.handle(IPC.codexBackupDelete, async (_e, p: string) => ({
    deleted: await deleteBackup(p),
  }));
  // v1.9.0 对话记录来源切换
  ipcMain.handle(IPC.codexHasOriginalBackup, () => hasOriginalBackup());
  ipcMain.handle(IPC.codexRestoreOriginal, async () => {
    await restoreOriginalConfig();
    return true;
  });

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
    const prefs = getPreferences();
    const result = await detectAll();

    // v1.13.0: Claude Desktop 和 CLI 各自独立的供应商
    if (prefs.claudeDesktop.enabled && result.claudeDesktop.installed) {
      const dp = prefs.claudeDesktopProvider ?? 'deepseek';
      const dk =
        dp === 'agnes' ? await getAgnesKey() : dp === 'glm' ? await getGlmKey() : await getApiKey();
      if (dk) {
        try {
          await writeClaudeDesktopConfig(dk, dp);
          telemetry?.track('tool_install', { tool: 'claude-desktop' });
        } catch (e) {
          telemetry?.track('tool_install_fail', {
            tool: 'claude-desktop',
            error_code: (e as Error).message?.slice(0, 50) ?? 'unknown',
          });
        }
      }
    }

    if (prefs.claudeCli.enabled && result.claudeCli.installed) {
      const cp = prefs.claudeCliProvider ?? 'deepseek';
      const ck =
        cp === 'agnes' ? await getAgnesKey() : cp === 'glm' ? await getGlmKey() : await getApiKey();
      if (ck) {
        try {
          // v1.14.1: 只在 envVars 为空或属于其他供应商时才用默认值覆盖，保护用户手动选择的模型
          const { envVars, changed } = resolveEnvVars(prefs.claudeCli.envVars, cp);
          if (changed) {
            setPreferences({ claudeCli: { enabled: true, envVars } });
          }
          await writeClaudeCliConfig(ck, envVars, cp);
          telemetry?.track('tool_install', { tool: 'claude-cli' });
        } catch (e) {
          telemetry?.track('tool_install_fail', {
            tool: 'claude-cli',
            error_code: (e as Error).message?.slice(0, 50) ?? 'unknown',
          });
        }
      }
    }

    // v1.13.0: 同步代理上游（任一 Claude 工具选 Agnes 时）
    const hasAgnesClaude =
      prefs.claudeDesktopProvider === 'agnes' || prefs.claudeCliProvider === 'agnes';
    if (proxy && hasAgnesClaude) {
      const agnesK = await getAgnesKey();
      if (agnesK) {
        proxy.updateOptions({
          upstreamBase: 'apihub.agnes-ai.com',
          apiKey: agnesK,
          defaultModel: 'agnes-2.0-flash',
        });
      }
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

  // ─── v1.7.0 Server 集成 ────────────────────────────────────────────────
  ipcMain.handle(IPC.telemetrySetEnabled, (_e, enabled: unknown) => {
    // H5: coerce to boolean to handle string "true"/"false" from renderer
    const v = Boolean(enabled);
    telemetry?.setEnabled(v);
    setPreferences({ telemetryEnabled: v });
  });
  ipcMain.handle(IPC.telemetryGetOnline, () => {
    return telemetry?.isOnline() ?? false;
  });
  ipcMain.handle(IPC.serverPing, async () => {
    if (!serverClient) return false;
    return serverClient.ping();
  });

  // ─── v1.9.0 对话缓存 ────────────────────────────────────────────────────
  ipcMain.handle(IPC.conversationCacheStats, async () => {
    if (!proxy) return { count: 0, oldestTimestamp: null };
    return proxy.getConversationCacheStats();
  });
  ipcMain.handle(IPC.conversationCacheClear, async () => {
    if (!proxy) return;
    await proxy.clearConversationCache();
  });
  ipcMain.handle(IPC.conversationCacheSetLimit, async (_e, limit: number) => {
    if (!proxy) return;
    proxy.setConversationCacheLimit(limit);
    setPreferences({ conversationCacheLimit: limit });
  });

  // ─── v1.10.0 离线插件安装 ──────────────────────────────────────────────
  ipcMain.handle(IPC.pluginsGetPackInfo, async (_e, type?: 'codex' | 'claude') => {
    if (!pluginManager) throw new Error('插件管理器未初始化');
    const effectiveUrl = resolveServerUrl(getPreferences());
    const packType = type || 'codex';
    log.info('[plugins] 获取插件包信息，type=%s，服务器：%s', packType, effectiveUrl);
    const startedAt = Date.now();
    try {
      const info = await pluginManager.getPackInfo(packType);
      telemetry?.track('plugin_pack_info_fetch', {
        success: true,
        duration_ms: Date.now() - startedAt,
        version: info.version,
        plugin_count: info.plugin_count,
      });
      return info;
    } catch (e) {
      telemetry?.track('plugin_pack_info_fetch', {
        success: false,
        duration_ms: Date.now() - startedAt,
        error: (e as Error).message?.slice(0, 100) ?? 'unknown',
      });
      throw e;
    }
  });

  ipcMain.handle(IPC.pluginsDownload, async (_e, savePath?: string, type?: 'codex' | 'claude') => {
    if (!pluginManager) throw new Error('插件管理器未初始化');
    const packType = type || 'codex';
    const effectiveUrl = resolveServerUrl(getPreferences());
    log.info('[plugins] 开始下载插件包，type=%s，服务器：%s', packType, effectiveUrl);
    const effectiveSavePath = savePath || '';
    const downloadStartedAt = Date.now();
    telemetry?.track('plugin_pack_download', { phase: 'start', type: packType });
    // Download runs async; progress/complete/error sent via webContents
    pluginManager
      .downloadPack(
        effectiveSavePath,
        (progress) => {
          mainWindow?.webContents.send('plugins:download-progress', progress);
        },
        packType,
      )
      .then((filePath) => {
        telemetry?.track('plugin_pack_download', {
          success: true,
          duration_ms: Date.now() - downloadStartedAt,
          cancelled: false,
        });
        mainWindow?.webContents.send('plugins:download-complete', filePath);
      })
      .catch((err) => {
        const msg = (err as Error).message || '下载失败';
        telemetry?.track('plugin_pack_download', {
          success: false,
          duration_ms: Date.now() - downloadStartedAt,
          cancelled: msg.includes('已取消'),
          error: msg.slice(0, 100),
        });
        mainWindow?.webContents.send('plugins:download-error', msg);
      });
    // Return immediately; actual download is async with event push
    return 'started';
  });

  ipcMain.handle(IPC.pluginsCancelDownload, async () => {
    if (pluginManager) pluginManager.cancelDownload();
  });

  ipcMain.handle(
    IPC.pluginsGetInstallCommand,
    async (
      _e,
      filePath: string,
      type?: 'codex' | 'claude',
      selectedPlugins?: string[],
      target?: 'cowork' | 'code',
    ) => {
      if (!pluginManager) throw new Error('插件管理器未初始化');
      telemetry?.track('plugin_install_command_copy', {
        type: type ?? 'codex',
        target: target ?? 'cowork',
        count: selectedPlugins?.length ?? 0,
      });
      return pluginManager.getInstallCommand(filePath, type, selectedPlugins, target);
    },
  );

  ipcMain.handle(IPC.pluginsOpenDownloadDir, async () => {
    const downloadsPath = app.getPath('downloads');
    shell.openPath(downloadsPath);
  });

  ipcMain.handle(
    IPC.pluginsCheckExistingFile,
    async (_e, savePath?: string, type?: 'codex' | 'claude') => {
      if (!pluginManager) return null;
      return pluginManager.checkExistingFile(savePath, type || 'codex');
    },
  );

  ipcMain.handle(IPC.pluginsGetLogo, async (_e, type: 'codex' | 'claude') => {
    const filename = type === 'codex' ? 'logo-codex.png' : 'logo-claude.svg';
    const isSvg = filename.endsWith('.svg');
    const mime = isSvg ? 'image/svg+xml' : 'image/png';
    const candidates = app.isPackaged
      ? [path.join(process.resourcesPath, 'build', filename)]
      : [
          path.join(__dirname, '..', '..', 'build', filename),
          path.join(process.cwd(), 'build', filename),
        ];
    for (const p of candidates) {
      try {
        const b = await fs.readFile(p);
        return `data:${mime};base64,${b.toString('base64')}`;
      } catch {
        /* try next */
      }
    }
    // Fallback: return empty (renderer will use emoji fallback)
    return '';
  });

  // ─── v1.11.0 邀请好友 ─────────────────────────────────────────────────
  ipcMain.handle(IPC.shareGetText, async () => {
    const clientId = getPreferences().clientId;
    const ref = clientId || 'unknown';
    return `让 AI 编程触手可及

不用翻墙，不用注册海外账号，
Codex Switch 帮你突破网络限制，
在国内流畅使用 Codex 和 Claude。

✅ 无需翻墙，本地安全
✅ 接入 DeepSeek，免费快速
✅ 一键安装 173 个精选插件

上手指南：https://www.codex-switch.cloud/guide?ref=${ref}`;
  });

  ipcMain.handle(IPC.communityGetCount, async () => {
    if (!serverClient) return 0;
    try {
      const res = await serverClient.get('/client/community');
      const data = res.data as { code?: number; data?: { active_users?: number } };
      return data?.data?.active_users ?? 0;
    } catch {
      return 0;
    }
  });

  ipcMain.handle(IPC.communityGetProfile, async () => {
    const prefs = getPreferences();
    const localDate = prefs.lifetimeFirstStartAt;
    // 本地兜底：lifetimeFirstStartAt < v1.11.0 发布日期
    let localEarly = !!(localDate && localDate < '2026-06-16');
    // 补充检测：install-original 备份文件时间戳 < v1.11.0 → 早期安装
    if (!localEarly) {
      try {
        const { stat: fsStat } = await import('node:fs/promises');
        const { join } = await import('node:path');
        const { homedir } = await import('node:os');
        const bak = join(homedir(), '.codex', 'config.toml.bak.install-original');
        const s = await fsStat(bak).catch(() => null);
        if (s && new Date(s.mtimeMs).toISOString().slice(0, 10) < '2026-06-16') {
          localEarly = true;
        }
      } catch {
        /* ignore */
      }
    }
    const localFallback =
      localDate || localEarly
        ? { is_early_member: localEarly, joined_date: localDate || '', invite_count: 0 }
        : null;

    const clientId = prefs.clientId;
    if (!clientId || !serverClient) return localFallback;
    try {
      const res = await serverClient.get(`/client/${clientId}/profile`);
      const data = res.data as {
        code?: number;
        data?: {
          client_number?: number;
          is_early_member?: boolean;
          joined_date?: string;
          invite_count?: number;
        };
      };
      return data?.data ?? localFallback;
    } catch {
      return localFallback;
    }
  });

  // ─── v1.13.0 智能搜索 ─────────────────────────────────────────────────
  ipcMain.handle(IPC.searchAsk, async (_e, query: string) => {
    if (!query?.trim()) return { answer: '请输入问题' };
    const apiKey = await getApiKey();
    if (!apiKey) return { answer: '请先在设置中填写 DeepSeek API Key' };

    const startedAt = Date.now();
    const truncatedQuery = query.length > 80 ? query.slice(0, 80) + '…' : query;

    // Emit log start
    const searchEntry: ProxyLogEntry = {
      ts: Date.now(),
      level: 'info',
      source: 'search',
      message: `→ 智能搜索 query="${truncatedQuery}"`,
      model: 'deepseek-v4-flash',
      phase: 'start',
    };
    logBuffer.push(searchEntry);
    if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
    mainWindow?.webContents.send(IPC.proxyOnLog, searchEntry);
    persistentLog?.append(searchEntry);

    try {
      // Build knowledge base from local help files
      const faqText = await readHelpJson('faq.json');
      const onboardingText = await readHelpJson('onboarding.json');
      const contextParts: string[] = [];

      if (Array.isArray(faqText)) {
        contextParts.push(
          '--- FAQ ---\n' +
            faqText
              .map(
                (item: { question: string; answer: string }) =>
                  `Q: ${item.question}\nA: ${item.answer}`,
              )
              .join('\n\n'),
        );
      }

      if (Array.isArray(onboardingText)) {
        contextParts.push(
          '--- 上手指南 ---\n' +
            onboardingText
              .map((item: { title: string; body: string }) => `## ${item.title}\n${item.body}`)
              .join('\n\n'),
        );
      }

      const context = contextParts.join('\n\n');

      const prompt = `你是 Codex Switch 的智能助手。Codex Switch 是一款桌面应用，
帮助国内用户使用 Codex Desktop、Codex CLI、Claude Desktop 和 Claude Code CLI 接入 DeepSeek、智谱 GLM 和 Agnes AI（免费模型）。

用户问"免费""省钱""不要钱""哪个模型免费"等问题时，优先推荐 Agnes AI——在设置中的【Codex 接入】卡片切换供应商为 Agnes AI 即可。
用户问"国内""中文""GLM""智谱""zhipu"等问题时，推荐智谱 GLM——在设置中的【Codex 接入】卡片切换供应商为「智谱 GLM」即可，支持 glm-5.2 / glm-5.1 / glm-4.7 三个版本。

请根据以下知识库回答用户问题，注意格式：
- 每个要点之间用空行分隔，保持整体结构清晰可读
- 需要步骤时，每步单独一行，如 "1. 打开设置页面"
- 涉及按钮或页面时，用【】标注，如【设置】→【保存并应用】
- 回答控制在 5-8 句，简洁有料
- 知识库没有覆盖的，诚实说明并给出排查方向
- 涉及外部安装步骤（Node.js、Git 等），引导访问 https://www.codex-switch.cloud/guide

---知识库---
${context}

---用户问题---
${query}`;

      // Call DeepSeek API
      const {
        hostname,
        port,
        path: reqPath,
      } = (() => {
        const u = new URL('https://api.deepseek.com/v1/chat/completions');
        return {
          hostname: u.hostname,
          port: 443,
          path: u.pathname + u.search,
        };
      })();

      const dsResult = await new Promise<{
        status: number;
        body: string;
      }>((resolve, reject) => {
        const body = JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 800,
          temperature: 0.3,
        });

        const req = https.request(
          {
            hostname,
            port,
            path: reqPath,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              Authorization: `Bearer ${apiKey}`,
            },
            timeout: 15_000,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () =>
              resolve({ status: res.statusCode ?? 500, body: Buffer.concat(chunks).toString() }),
            );
            res.on('error', reject);
          },
        );
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('请求超时'));
        });
        req.write(body);
        req.end();
      });

      if (dsResult.status !== 200) {
        throw new Error(`DeepSeek API 返回 ${dsResult.status}`);
      }

      const parsed = JSON.parse(dsResult.body) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const answer = parsed.choices?.[0]?.message?.content || '抱歉，未能生成回答，请重试。';

      const durationMs = Date.now() - startedAt;
      const usage = parsed.usage;

      // Emit log success
      const successEntry: ProxyLogEntry = {
        ts: Date.now(),
        level: 'info',
        source: 'search',
        message: `✓ 智能搜索完成 耗时=${durationMs}ms ↑${usage?.prompt_tokens ?? '?'}↓${usage?.completion_tokens ?? '?'}`,
        model: 'deepseek-v4-flash',
        phase: 'success',
        durationMs,
        meta: {
          queryLength: query.length,
          inputTokens: usage?.prompt_tokens,
          outputTokens: usage?.completion_tokens,
        },
      };
      logBuffer.push(successEntry);
      if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
      mainWindow?.webContents.send(IPC.proxyOnLog, successEntry);
      persistentLog?.append(successEntry);

      // Telemetry
      telemetry?.track('smart_search', {
        query_length: query.length,
        duration_ms: durationMs,
        success: true,
      });

      return { answer };
    } catch (e) {
      const durationMs = Date.now() - startedAt;

      // Emit log error
      const errorEntry: ProxyLogEntry = {
        ts: Date.now(),
        level: 'error',
        source: 'search',
        message: `✗ 智能搜索失败 ${(e as Error).message}`,
        phase: 'error',
      };
      logBuffer.push(errorEntry);
      if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
      mainWindow?.webContents.send(IPC.proxyOnLog, errorEntry);
      persistentLog?.append(errorEntry);

      telemetry?.track('smart_search', {
        query_length: query.length,
        duration_ms: durationMs,
        success: false,
      });

      return { answer: `搜索失败：${(e as Error).message}，请重试或浏览帮助页面` };
    }
  });
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
  const prefs = getPreferences();

  // ─── v1.7.0 Server 集成：初始化客户端 ──────────────────────────────────
  if (!prefs.clientId) {
    setPreferences({ clientId: generateClientId() });
  }
  const effectivePrefs = getPreferences();
  const serverBaseUrl = resolveServerUrl(effectivePrefs);
  log.info(
    '[server-client] resolved server URL: %s (isPackaged=%s)',
    serverBaseUrl,
    app.isPackaged,
  );
  serverClient = new ServerClient(serverBaseUrl);
  pluginManager = new PluginManager(serverBaseUrl);
  telemetry = new TelemetryClient(
    serverClient,
    {
      baseUrl: serverBaseUrl,
      telemetryEnabled: effectivePrefs.telemetryEnabled ?? true,
      clientId: effectivePrefs.clientId,
    },
    app.getVersion(),
  );
  if (effectivePrefs.telemetryEnabled) {
    telemetry.start();
  }
  telemetry.track('app_start', { first_run: !effectivePrefs.hasCompletedSetup });

  // ─── 持久化日志 ────────────────────────────────────────────────────────
  try {
    persistentLog = new PersistentLog({ dir: path.join(app.getPath('userData'), 'logs') });
    await persistentLog.prune();
  } catch (e) {
    log.warn('持久化日志初始化失败：', (e as Error).message);
  }

  registerIpc();
  await createWindow();

  const hasApiKey = (await getApiKey().catch(() => '')).length > 0;
  if ((prefs.hasCompletedSetup || hasApiKey) && prefs.autoStartProxy) {
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
    await startupApplyClaude();
  } catch (e) {
    log.warn('Startup Claude auto-apply 失败：', (e as Error).message);
  }

  if (prefs.autoCheckUpdate) {
    try {
      await updater.setMirror(prefs.updateMirror, prefs.customMirrorUrl, serverBaseUrl);
      // v1.11.0: 启动后 5s 自动检查，传入 autoDownload 决定是否自动下载
      setTimeout(() => {
        updater
          .check(Boolean(prefs.autoDownload))
          .catch((e) => log.warn('检查更新失败：', (e as Error).message));
      }, 5000);
    } catch (e) {
      log.warn('更新初始化失败：', (e as Error).message);
    }
  }

  lifetimeFlushTimer = setInterval(() => {
    flushLifetime().catch(() => undefined);
  }, 30_000);

  // v1.11.0: 每 6 小时自动检查更新
  if (prefs.autoCheckUpdate) {
    setInterval(() => {
      // 仅在代理空闲时检查（无进行中的请求）
      if (!proxy || proxy.getRecentStats().total === 0) {
        updater.check(Boolean(getPreferences().autoDownload)).catch(() => {});
      }
    }, 6 * 3600_000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// v1.7.0 全局异常上报
process.on('uncaughtException', (err) => {
  log.error('uncaughtException:', err);
  telemetry?.track('error', { error_type: 'uncaughtException', source: err.name ?? 'Error' });
});
process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection:', reason);
  telemetry?.track('error', { error_type: 'unhandledRejection', source: 'unhandledRejection' });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let quitInProgress = false;
app.on('before-quit', (e) => {
  if (isInstallingUpdate) {
    return;
  }
  if (quitInProgress) return;

  // v1.7.0 telemetry: 记录关闭事件
  telemetry?.track('app_close', {
    uptime_seconds: Math.floor(process.uptime()),
    request_count: proxy?.getRequestCount() ?? 0,
  });

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
          // v1.7.0: 停止遥测（仅在线时 flush）
          await telemetry?.stop();
        } catch {
          /* ignore */
        }
        try {
          await persistentLog?.close();
        } catch {
          /* ignore */
        }
        app.exit(0);
      });
  } else {
    if (lifetimeFlushTimer) clearInterval(lifetimeFlushTimer);
    // v1.7.0: 无代理运行中，直接停止遥测
    telemetry?.stop().catch(() => undefined);
  }
});
