/**
 * UpdateBadge — v1.11.0 rewrite.
 *
 * Three visible states:
 *   idle        → hidden
 *   downloading → "↓ 45% · 2.1 MB/s"
 *   downloaded  → "💛 v1.11.0 可安装"  点击安装（Win 重启 / Mac 打开 DMG）
 */
import { useEffect, useState } from 'react';

const IS_MAC = /Mac OS X|Macintosh/.test(navigator.userAgent);

type BadgeState = 'idle' | 'downloading' | 'downloaded';

export function UpdateBadge(): JSX.Element | null {
  const [state, setState] = useState<BadgeState>('idle');
  const [progress, setProgress] = useState({ percent: 0, speed: 0 });
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const off = window.codexSwitch.onUpdateEvent((raw) => {
      const e = raw as {
        kind: string;
        version?: string;
        percent?: number;
        bytesPerSecond?: number;
      };
      switch (e.kind) {
        case 'download-progress':
          setState('downloading');
          setProgress({ percent: e.percent ?? 0, speed: e.bytesPerSecond ?? 0 });
          break;
        case 'downloaded':
          setState('downloaded');
          if (e.version) setVersion(e.version);
          break;
        case 'available':
          // macOS auto-download: show downloading immediately after 'available'
          setState('downloading');
          if (e.version) setVersion(e.version);
          break;
        case 'error':
        case 'not-available':
          setBusy(false);
          break;
      }
    });
    return off;
  }, []);

  async function handleClick(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await window.codexSwitch.updateInstall();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  if (state === 'idle') return null;

  if (state === 'downloading') {
    return (
      <span className="text-xs text-slate-400 tabular-nums">
        ↓ {progress.percent}%{progress.speed > 0 ? ` · ${formatSpeed(progress.speed)}` : ''}
      </span>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className="px-2 py-0.5 bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 rounded text-xs font-medium transition disabled:opacity-50"
    >
      {busy ? (
        <span className="inline-block h-3 w-3 rounded-full border-2 border-amber-300/30 border-t-amber-300 animate-spin mr-1" />
      ) : (
        <span className="mr-0.5">💛</span>
      )}
      v{version} {IS_MAC ? '已下载' : '可安装'}
    </button>
  );
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1_000_000) return `${(bytesPerSec / 1_000_000).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1_000) return `${(bytesPerSec / 1_000).toFixed(0)} KB/s`;
  return `${bytesPerSec} B/s`;
}
