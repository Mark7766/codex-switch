/**
 * electron-updater 封装。
 * - 启动时按用户偏好选择 feed（github / ghproxy / custom / auto）
 * - 暴露 checkForUpdates / downloadUpdate / quitAndInstall
 * - 通过 EventEmitter 把 download-progress / update-downloaded 透出给 UI
 */
import { EventEmitter } from 'node:events';
import { app, shell } from 'electron';
import { autoUpdater } from 'electron-updater';

import { buildFeedUrl, pickAuto, type MirrorMode } from './mirrors';

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

export class UpdaterManager extends EventEmitter {
  private wired = false;

  constructor() {
    super();
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
  }

  private wire(): void {
    if (this.wired) return;
    this.wired = true;
    autoUpdater.on('checking-for-update', () =>
      this.emit('event', { kind: 'checking' } satisfies UpdateEvent),
    );
    autoUpdater.on('update-available', (info) =>
      this.emit('event', {
        kind: 'available',
        version: info.version,
        notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      } satisfies UpdateEvent),
    );
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

  async setMirror(mode: MirrorMode, customPrefix?: string): Promise<void> {
    const effective = mode === 'auto' ? await pickAuto() : mode;
    const url = buildFeedUrl(effective, customPrefix);
    autoUpdater.setFeedURL({ provider: 'generic', url });
  }

  /** 静默检查（不下载）。 */
  async check(): Promise<void> {
    if (!app.isPackaged) {
      this.emit('event', { kind: 'not-available' } satisfies UpdateEvent);
      return;
    }
    this.wire();
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      this.emit('event', { kind: 'error', message: (e as Error).message } satisfies UpdateEvent);
    }
  }

  async download(): Promise<void> {
    if (!app.isPackaged) return;
    // macOS 未签名构建无法走 Squirrel.Mac 原子升级（签名验证必败），改为浏览器下载 dmg + 手动拖拽安装。
    if (process.platform === 'darwin') {
      await shell.openExternal('https://github.com/Mark7766/codex-switch/releases/latest');
      this.emit('event', { kind: 'manual-download' } satisfies UpdateEvent);
      return;
    }
    this.wire();
    try {
      await autoUpdater.downloadUpdate();
    } catch (e) {
      this.emit('event', { kind: 'error', message: (e as Error).message } satisfies UpdateEvent);
    }
  }

  install(): void {
    if (!app.isPackaged) return;
    autoUpdater.quitAndInstall();
  }
}
