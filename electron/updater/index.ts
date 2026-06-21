/**
 * electron-updater 封装 — v1.11.0 增强。
 * - 启动时按用户偏好选择 feed（github / ghproxy / custom / auto / server）
 * - 支持自动下载：Windows 走 Squirrel.Mac (NSIS)，macOS 走原生 https 下载 DMG
 * - 通过 EventEmitter 把 download-progress / update-downloaded 透出给 UI
 */
import { EventEmitter } from 'node:events';
import { app, shell, dialog, clipboard } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';

import { buildFeedUrl, pickAuto, type MirrorMode } from './mirrors';

// v1.12.2: route electron-updater internal logs through electron-log
// so we can see feed URL errors, download failures, etc. in main.log
autoUpdater.logger = log;

export interface UpdateEvent {
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

/** Download DMG to ~/Downloads, emit progress events. */
async function downloadMacDmg(
  downloadUrl: string,
  version: string,
  emit: (e: UpdateEvent) => void,
): Promise<string> {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const filename = `Codex-Switch-${version}-mac-${arch}.dmg`;
  const savePath = path.join(app.getPath('downloads'), filename);

  return new Promise((resolve, reject) => {
    // Step 1: request download URL, follow redirect to COS
    const parsed = new URL(downloadUrl);
    const mod = parsed.protocol === 'https:' ? https : http;

    const req = mod.get(downloadUrl, { timeout: 10_000, rejectUnauthorized: true }, (res) => {
      const loc = res.headers.location;
      res.resume();

      const finalUrl =
        (res.statusCode === 302 || res.statusCode === 301) && loc ? loc : downloadUrl;

      // Step 2: stream download
      const fileStream = fs.createWriteStream(savePath, { flags: 'w' });
      let received = 0;
      let lastBytes = 0;
      let lastTime = Date.now();

      const parsedFinal = new URL(finalUrl);
      const modFinal = parsedFinal.protocol === 'https:' ? https : http;

      const dlReq = modFinal.get(
        finalUrl,
        { timeout: 10 * 60_000, rejectUnauthorized: true },
        (dlRes) => {
          if (dlRes.statusCode !== 200) {
            fileStream.close();
            try {
              fs.unlinkSync(savePath);
            } catch {
              /* ok */
            }
            reject(new Error(`Download failed: HTTP ${dlRes.statusCode}`));
            return;
          }

          dlRes.on('data', (chunk: Buffer) => {
            received += chunk.length;
          });

          const interval = setInterval(() => {
            const now = Date.now();
            const elapsed = (now - lastTime) / 1000;
            const delta = received - lastBytes;
            const speed = elapsed > 0 ? delta / elapsed : 0;
            const pct = dlRes.headers['content-length']
              ? Math.round((received / parseInt(dlRes.headers['content-length'], 10)) * 100)
              : 0;

            emit({
              kind: 'download-progress',
              percent: pct,
              bytesPerSecond: Math.round(speed),
              transferred: received,
              total: dlRes.headers['content-length']
                ? parseInt(dlRes.headers['content-length'], 10)
                : undefined,
            });

            lastBytes = received;
            lastTime = now;
          }, 500);

          dlRes.pipe(fileStream);

          fileStream.on('finish', () => {
            clearInterval(interval);
            emit({ kind: 'download-progress', percent: 100, bytesPerSecond: 0 });
            // v1.14.1: write a companion fix script for macOS Gatekeeper quarantine
            writeMacFixScript(savePath);
            emit({ kind: 'downloaded', version });
            resolve(savePath);
          });

          fileStream.on('error', (e) => {
            clearInterval(interval);
            try {
              fs.unlinkSync(savePath);
            } catch {
              /* ok */
            }
            reject(e);
          });
        },
      );

      dlReq.on('error', reject);
      dlReq.on('timeout', () => {
        dlReq.destroy();
        fileStream.close();
        reject(new Error('Download timed out'));
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Redirect request timed out'));
    });
  });
}

/** v1.14.1: 在 DMG 旁写一个双击即可修复 macOS Gatekeeper 隔离的脚本 */
function writeMacFixScript(dmgPath: string): void {
  if (process.platform !== 'darwin') return;
  try {
    const scriptPath = dmgPath.replace(/\.dmg$/i, '-修复已损坏.command');
    const script = [
      '#!/bin/bash',
      'echo "🔧 正在修复 Codex Switch 的 macOS 安全隔离标记…"',
      'xattr -cr /Applications/Codex\\ Switch.app 2>/dev/null',
      'if [ $? -eq 0 ]; then',
      '  echo "✅ 修复完成！现在可以正常打开 Codex Switch 了。"',
      '  echo ""',
      '  read -p "按回车键退出…"',
      'else',
      '  echo "⚠️  未找到 /Applications/Codex Switch.app，请确认已从 DMG 拖入应用程序文件夹。"',
      '  echo ""',
      '  read -p "按回车键退出…"',
      'fi',
    ].join('\n');
    fs.writeFileSync(scriptPath, script, { mode: 0o755 });
    log.info('[updater] wrote mac fix script: %s', scriptPath);
  } catch (e) {
    log.warn('[updater] failed to write mac fix script: %s', (e as Error).message);
  }
}

export class UpdaterManager extends EventEmitter {
  private wired = false;
  private serverBaseUrl = '';
  private autoDownload = false;
  private downloadedMacDmg: string | null = null;

  constructor() {
    super();
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    // v1.12.2: wire listeners immediately so they're ready before any check.
    // Previously wire() was called lazily inside check(), which caused a race
    // where the 5s startup setTimeout could trigger checkForUpdates() before
    // listeners were registered — resulting in "Object has been destroyed".
    this.wire();
  }

  /** Set server base URL (for macOS DMG download path construction). */
  setServerUrl(url: string): void {
    this.serverBaseUrl = url.replace(/\/$/, '');
  }

  private wire(): void {
    if (this.wired) return;
    this.wired = true;
    autoUpdater.on('checking-for-update', () =>
      this.emit('event', { kind: 'checking' } satisfies UpdateEvent),
    );
    autoUpdater.on('update-available', (info) => {
      this.emit('event', {
        kind: 'available',
        version: info.version,
        notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      } satisfies UpdateEvent);

      // v1.11.0: auto-download if enabled
      if (!this.autoDownload) return;

      if (process.platform === 'win32') {
        autoUpdater.downloadUpdate().catch(() => {});
      } else if (process.platform === 'darwin' && this.serverBaseUrl) {
        const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
        const downloadUrl = `${this.serverBaseUrl}/updates/Codex-Switch-${info.version}-mac-${arch}.dmg`;
        downloadMacDmg(downloadUrl, info.version, (e) => this.emit('event', e))
          .then((filePath) => {
            this.downloadedMacDmg = filePath;
          })
          .catch((err) => {
            this.emit('event', {
              kind: 'error',
              message: `自动下载失败：${(err as Error).message}`,
            } satisfies UpdateEvent);
          });
      }
    });
    autoUpdater.on('update-not-available', () =>
      this.emit('event', { kind: 'not-available' } satisfies UpdateEvent),
    );
    autoUpdater.on('error', (err) =>
      this.emit('event', { kind: 'error', message: err.message } satisfies UpdateEvent),
    );
    autoUpdater.on('download-progress', (p) =>
      this.emit('event', {
        kind: 'download-progress',
        percent: p.percent,
        bytesPerSecond: p.bytesPerSecond,
        transferred: p.transferred,
        total: p.total,
      } satisfies UpdateEvent),
    );
    autoUpdater.on('update-downloaded', (info) =>
      this.emit('event', { kind: 'downloaded', version: info.version } satisfies UpdateEvent),
    );
  }

  async setMirror(mode: MirrorMode, customPrefix?: string, serverBaseUrl?: string): Promise<void> {
    const effective = mode === 'auto' ? await pickAuto(serverBaseUrl) : mode;
    const url = buildFeedUrl(effective, customPrefix, serverBaseUrl);
    log.info('[updater] setMirror mode=%s → feedUrl=%s', effective, url);
    autoUpdater.setFeedURL({ provider: 'generic', url });
    this.serverBaseUrl = (serverBaseUrl || '').replace(/\/$/, '');
  }

  /** 检查更新。如果 autoDownload=true，发现新版本后自动下载。 */
  async check(autoDownload = false): Promise<void> {
    if (!app.isPackaged) {
      log.info('[updater] 开发模式，跳过更新检查');
      this.emit('event', { kind: 'not-available' } satisfies UpdateEvent);
      return;
    }
    this.autoDownload = autoDownload;
    log.info('[updater] 开始检查更新，autoDownload=%s', autoDownload);
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      log.warn('[updater] 检查更新失败：%s', (e as Error).message);
      this.emit('event', { kind: 'error', message: (e as Error).message } satisfies UpdateEvent);
    }
  }

  async download(): Promise<void> {
    if (!app.isPackaged) return;
    if (process.platform === 'darwin') {
      await shell.openExternal('https://github.com/Mark7766/codex-switch/releases/latest');
      this.emit('event', { kind: 'manual-download' } satisfies UpdateEvent);
      return;
    }
    try {
      await autoUpdater.downloadUpdate();
    } catch (e) {
      this.emit('event', { kind: 'error', message: (e as Error).message } satisfies UpdateEvent);
    }
  }

  install(): void {
    if (!app.isPackaged) return;
    // macOS：退出应用并打开已下载的 DMG 文件
    if (process.platform === 'darwin') {
      // v1.14.1: 弹窗告知用户如何处理 macOS Gatekeeper "已损坏" 提示
      const command = 'xattr -cr /Applications/Codex\\ Switch.app';
      const result = dialog.showMessageBoxSync({
        type: 'info',
        title: 'Codex Switch 升级',
        message: '安装新版本后，macOS 可能会提示「已损坏，无法打开」',
        detail: [
          '这是因为应用未经过 Apple 公证签名（需 $99/年的 Apple Developer Program）。',
          '',
          '解决方法很简单（二选一）：',
          `① 双击下载文件夹里的「Codex-Switch-*-修复已损坏.command」脚本`,
          `② 或在终端运行：${command}`,
          '',
          '（命令已复制到剪贴板，直接 ⌘V 粘贴即可）',
        ].join('\n'),
        buttons: ['复制命令并退出升级', '取消升级'],
        defaultId: 0,
        cancelId: 1,
      });
      if (result === 1) return; // user cancelled
      clipboard.writeText(command);
      if (this.downloadedMacDmg) {
        app.quit();
        shell.openPath(this.downloadedMacDmg);
      } else {
        shell.openExternal('https://github.com/Mark7766/codex-switch/releases/latest');
      }
      return;
    }
    autoUpdater.quitAndInstall();
  }
}
