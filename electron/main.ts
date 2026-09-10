import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import log from 'electron-log';

import { IPC } from './ipc/channels';
import {
  getPreferences,
  setPreferences,
  setPreferencesSerialized,
  type UserPreferences,
} from './config/store';
import { clearKey, getKey, maskKey, setKey } from './config/secrets';
import { getProvider, PROVIDER_LIST, type ProviderId } from './config/providers';
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
  runV300DirectMigration,
  startupApplyClaude,
} from './config/migrations';
import { ServerClient } from './server-client/client';
import { TelemetryClient } from './server-client/telemetry';
import { resolveServerUrl, generateClientId } from './server-client/config';

log.transports.file.level = 'info';
log.transports.console.level = 'debug';

let mainWindow: BrowserWindow | null = null;
const updater = new UpdaterManager();
updater.on('event', (e: UpdateEvent) => {
  mainWindow?.webContents.send(IPC.updateOnEvent, e);
  // v3.0.0: 不再上报 update_check / update_download —— 它们不是「配置操作」，
  // 遥测已收窄为只上报配置写入相关事件（见 ADR-032）。
});

let isInstallingUpdate = false;

// v1.7.0 Server 集成
let serverClient: ServerClient | null = null;
let telemetry: TelemetryClient | null = null;

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

/**
 * 把文件写入类异常归类成**不含任何用户数据**的枚举（v3.0.0）。
 *
 * 绝不要改成返回 `e.message`：历史上正是原始报错文本把 API Key 送进了遥测库。
 */
function classifyWriteError(e: unknown): string {
  const code = (e as NodeJS.ErrnoException)?.code;
  if (code === 'EACCES' || code === 'EPERM') return 'path-denied';
  if (code === 'ENOENT') return 'path-missing';
  if (code === 'ENOSPC') return 'disk-full';
  const msg = (e as Error)?.message ?? '';
  if (msg.includes('API Key') || msg.includes('Key')) return 'key-missing';
  return 'write-failed';
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
): Promise<{ prefs: UserPreferences; codexWritten: boolean }> {
  const before = getPreferences();
  const { codexModel, ...prefsPatch } = patch;

  // 1) 写偏好（H6: 串行化，避免并发写竞争）
  const next = await setPreferencesSerialized(prefsPatch);

  // 2) serverUrl 变化时同步 PluginManager + ServerClient（v1.10.0）
  if (prefsPatch.serverUrl !== undefined) {
    const newUrl = resolveServerUrl(next);
    if (serverClient) serverClient.setBaseUrl(newUrl);
  }

  // 3) 写 ~/.codex
  //
  // v3.0.0: 无条件写。原先有一长串 shouldWriteCodex 判断，只为在「代理模板相同的
  // agnes↔glm 切换」时省一次写入；现在每个供应商的模板都不同（base_url / providerId
  // 都不一样），而且 writeWithBackup 对内容相同的写入本来就会跳过——无条件写既更简单，
  // 也更正确（顺带自愈用户手工改坏或外部工具覆盖过的配置）。
  let codexWritten = false;
  const provider = getProvider(next.provider);
  const effectiveKey = await getKey(provider).catch(() => '');
  if (effectiveKey) {
    try {
      await writeCodexConfig({
        model: codexModel || next.defaultModel,
        apiKey: effectiveKey,
        provider: provider.id,
        customCodexBaseUrl: next.customProvider?.codexBaseUrl,
        maxBackupsPerFile: next.maxBackupsPerFile,
      });
      codexWritten = true;
    } catch (e) {
      // H6: 回滚（串行写；重新读取当前值，避免覆盖其他 IPC handler 的并发改动）
      const current = getPreferences();
      await setPreferencesSerialized({
        defaultModel: before.defaultModel,
        ...Object.fromEntries(
          Object.keys(prefsPatch).map((k) => [
            k,
            (current as unknown as Record<string, unknown>)[k],
          ]),
        ),
      } as Partial<UserPreferences>);
      throw e;
    }
  }

  return { prefs: next, codexWritten };
}

function registerIpc(): void {
  ipcMain.handle(IPC.prefsGet, () => getPreferences());
  ipcMain.handle(IPC.prefsSet, async (_e, patch: Partial<UserPreferences>) => {
    const next = setPreferences(patch);
    // sync ServerClient when user changes server URL
    if (patch.serverUrl !== undefined) {
      const newUrl = resolveServerUrl(next);
      if (serverClient) serverClient.setBaseUrl(newUrl);
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

  // ─── 供应商注册表 ────────────────────────────────────────────────────────
  // 渲染进程不能 import electron/，设置页所需的供应商元数据（标签、模型表、档位默认值、
  // Key 提示语）统一由这条通道下发。返回纯数据，见 tests/unit/providers.test.ts 的守门断言。
  ipcMain.handle(IPC.providersList, () => PROVIDER_LIST);

  // ─── API Key ─────────────────────────────────────────────────────────────
  // v3.0.0: 通道对「供应商」泛型化——原先每个供应商各一套 get/set/clear（12 个 handler、
  // 9 条通道常量，共约 195 行复制粘贴），现统一为 3 条通道 + 一个 providerId 参数。
  const requireProvider = (id: unknown): ProviderId => {
    const found = PROVIDER_LIST.find((p) => p.id === id);
    if (!found) throw new Error(`未知供应商：${String(id)}`);
    return found.id;
  };

  ipcMain.handle(IPC.keyGet, async (_e, providerId: unknown) =>
    maskKey(await getKey(requireProvider(providerId))),
  );

  ipcMain.handle(IPC.keySet, async (_e, providerId: unknown, key: string) => {
    const provider = getProvider(requireProvider(providerId));
    const raw = String(key ?? '');
    if (raw.trim().length < provider.key.minLength) {
      throw new Error(`${provider.label} Key 格式不正确：长度应至少 ${provider.key.minLength} 位`);
    }
    if (provider.key.prefix && !raw.startsWith(provider.key.prefix)) {
      throw new Error(
        `${provider.label} Key 格式不正确：应以 ${provider.key.prefix} 开头且长度至少 ${provider.key.minLength} 位`,
      );
    }
    const trimmed = raw.trim();
    await setKey(provider, trimmed);
    // 保存 Key 后，为「当前正使用该供应商」的工具补写 Claude 配置（尽力而为）
    const prefs = getPreferences();
    if (prefs.claudeCli.enabled || prefs.claudeDesktop.enabled) {
      detectAll()
        .then(async (result) => {
          if (
            prefs.claudeCli.enabled &&
            (prefs.claudeCliProvider ?? 'deepseek') === provider.id &&
            result.claudeCli.installed &&
            !result.claudeCli.configApplied
          ) {
            await writeClaudeCliConfig(
              trimmed,
              resolveEnvVars(prefs.claudeCli.envVars, provider.id).envVars,
              provider.id,
            ).catch((e) => log.warn('[main] claudeCli 自动写入失败：', (e as Error).message));
          }
          if (
            prefs.claudeDesktop.enabled &&
            (prefs.claudeDesktopProvider ?? 'deepseek') === provider.id &&
            result.claudeDesktop.installed &&
            !result.claudeDesktop.configApplied
          ) {
            await writeClaudeDesktopConfig(trimmed, provider.id).catch((e) =>
              log.warn('[main] claudeDesktop 自动写入失败：', (e as Error).message),
            );
          }
        })
        .catch((e) => log.warn('[main] 保存 key 后检测失败：', (e as Error).message));
    }
    return true;
  });

  ipcMain.handle(IPC.keyClear, async (_e, providerId: unknown) => {
    await clearKey(getProvider(requireProvider(providerId)));
    return true;
  });

  ipcMain.handle(IPC.codexWrite, async (_e, payload: { model: string }) => {
    // H5: validate payload
    if (!payload || typeof payload.model !== 'string' || payload.model.trim().length === 0) {
      throw new Error('模型名称不能为空');
    }
    const prefs = getPreferences();
    const provider = getProvider(prefs.provider);
    const apiKey = await getKey(provider).catch(() => '');
    if (!apiKey) {
      throw new Error(`请先填写 ${provider.label} API Key`);
    }
    return writeCodexConfig({
      model: payload.model || prefs.defaultModel,
      apiKey,
      provider: provider.id,
      customCodexBaseUrl: prefs.customProvider?.codexBaseUrl,
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
  ipcMain.handle(IPC.helpOpenLogsDir, () => {
    const p = log.transports.file.getFile().path;
    shell.showItemInFolder(p);
  });
  ipcMain.handle(IPC.helpOpenExternal, (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
  });
  ipcMain.handle(IPC.helpGetDiagnostics, () => {
    // v3.0.0: 代理日志与持久化日志子系统均已删除，诊断包只含版本 / 系统 / 偏好。
    // 应用自身的运行日志仍由 electron-log 写盘，可用「打开日志目录」查看。
    return {
      version: app.getVersion(),
      os: process.platform,
      arch: process.arch,
      prefs: getPreferences(),
      generatedAt: Date.now(),
    };
  });

  // ─── 自动更新 ─────────────────────────────────────────────────────────
  ipcMain.handle(IPC.updateCheck, async () => {
    await updater.check();
  });
  ipcMain.handle(IPC.updateInstall, async () => {
    log.info('用户点击升级，准备清理资源并重启安装…');
    isInstallingUpdate = true;
    // v3.0.0: 代理与持久化日志都已删除，无需再等待任何资源释放（BUG-004 的前提消失）。
    updater.install();
  });
  ipcMain.handle(
    IPC.updateSetMirror,
    async (_e, mirror: 'server' | 'github' | 'ghproxy' | 'custom', custom?: string) => {
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
  // ─── v1.3.0 Claude 接入 ──────────────────────────────────────────────
  ipcMain.handle(IPC.claudeDetect, () => detectAll());
  ipcMain.handle(IPC.claudeApplyAll, async () => {
    const prefs = getPreferences();
    const errors: string[] = [];

    // v1.13.0: Claude Desktop 和 CLI 各自独立的供应商
    // v1.14.3: 不再依赖 installed 检测（用户显式保存时即使未检测到安装也应写入配置）
    // v3.0.0: 取 Key 与展示名统一走注册表，两个工具共用同一段逻辑（原先各抄一份含 agnes 的级联）
    const applyClaudeTool = async (
      enabled: boolean,
      providerId: ProviderId,
      tool: 'claude-desktop' | 'claude-cli',
      label: string,
    ): Promise<void> => {
      if (!enabled) return;
      const provider = getProvider(providerId);
      const key = await getKey(provider).catch(() => '');
      if (!key) {
        errors.push(
          tool === 'claude-cli'
            ? `${label}：缺少 ${provider.label} API Key，请先在供应商设置中配置`
            : `缺少 ${provider.label} API Key，请先在供应商设置中配置`,
        );
        return;
      }
      try {
        if (tool === 'claude-desktop') {
          await writeClaudeDesktopConfig(key, provider.id);
        } else {
          // v1.14.1: 只在 envVars 为空或属于其他供应商时才用默认值覆盖，保护用户手选的模型
          const { envVars, changed } = resolveEnvVars(prefs.claudeCli.envVars, provider.id);
          if (changed) setPreferences({ claudeCli: { enabled: true, envVars } });
          await writeClaudeCliConfig(key, envVars, provider.id);
        }
        telemetry?.track('tool_install', { tool });
      } catch (e) {
        const msg = (e as Error).message?.slice(0, 50) ?? 'unknown';
        errors.push(`${label} 配置写入失败：${msg}`);
        // v3.0.0: 只上报**本地归类后的枚举**，绝不上报原始报错文本 ——
        // 历史上 error_code 曾把完整 API Key 送进遥测库（TASK-098），服务端至今需人工清理。
        telemetry?.track('tool_install_fail', {
          tool,
          error_kind: classifyWriteError(e),
          platform: process.platform,
          app_version: app.getVersion(),
        });
      }
    };

    await applyClaudeTool(
      prefs.claudeDesktop.enabled,
      prefs.claudeDesktopProvider ?? 'deepseek',
      'claude-desktop',
      'Claude Desktop',
    );
    await applyClaudeTool(
      prefs.claudeCli.enabled,
      prefs.claudeCliProvider ?? 'deepseek',
      'claude-cli',
      'Claude Code CLI',
    );

    if (errors.length > 0) {
      throw Object.assign(new Error(errors.join('；')), { errors });
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
  ipcMain.handle(IPC.serverPing, async () => {
    if (!serverClient) return false;
    return serverClient.ping();
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
      // v2.0.0: 侧边栏「和 X 位朋友一起使用」显示累计注册客户端数（Server 端 total_clients）；
      // Server 尚未部署该字段时回退到 active_users，避免数字消失。
      const data = res.data as {
        code?: number;
        data?: { total_clients?: number; active_users?: number };
      };
      return data?.data?.total_clients ?? data?.data?.active_users ?? 0;
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

  registerIpc();
  await createWindow();

  // v3.0.0: 不再自动启动任何本地代理（已删除）。

  // v1.3.0 一次性迁移 + v1.6.0 直连 DeepSeek 迁移
  // 这两条迁移只服务于 DeepSeek 的历史配置，故固定取 DeepSeek 的 Key
  const apiKey = await getKey('deepseek').catch(() => '');
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
  // v3.0.0: 把仍指向本地代理的 config.toml 改写为当前供应商的直连配置。
  // 对存量 GLM 用户是必需的——GLM 在 v3.0.0 之前正是走本地代理的。
  try {
    await runV300DirectMigration();
  } catch (e) {
    log.warn('v3.0.0 直连迁移失败：', (e as Error).message);
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

  // v1.11.0: 每 6 小时自动检查更新
  // v3.0.0: 原先要等「代理空闲」才检查，代理删除后该门槛一并消失
  if (prefs.autoCheckUpdate) {
    setInterval(() => {
      updater.check(Boolean(getPreferences().autoDownload)).catch(() => {});
    }, 6 * 3600_000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 全局异常**只写本地日志**。
//
// v3.0.0: 停发 error 遥测事件。它原有 error_message / error_stack（截断 500 字符），
// 报错信息里可能带用户家目录路径与配置内容片段 —— 这是整条遥测里最明确的隐私泄露面，
// 且崩溃排障看本地日志（electron-log）即可，无需上传。见 ADR-032。
process.on('uncaughtException', (err) => {
  log.error('uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection:', reason);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

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

app.on('before-quit', () => {
  // v3.0.0: 本地代理已删除，不再有任何需要等待其停止的资源，因此不再 preventDefault。
  // 保留 isInstallingUpdate 的提前返回：升级流程会自行 app.exit(0)，不能被这里干扰（BUG-004）。
  if (isInstallingUpdate) return;

  // v3.0.0: 不再上报 app_close —— 配置工具「开了多久」没有意义（打开几秒关掉是常态）。
  telemetry?.stop().catch(() => undefined);
});
