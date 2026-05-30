import { useEffect, useState } from 'react';

const IS_MAC = typeof navigator !== 'undefined' && /Mac OS X|Macintosh/.test(navigator.userAgent);

export function UpdateBadge(): JSX.Element | null {
  const [evt, setEvt] = useState<UpdateEvent | null>(null);

  useEffect(() => {
    const off = window.codexSwitch.onUpdateEvent((e) => setEvt(e as UpdateEvent));
    return off;
  }, []);

  if (!evt) return null;
  if (evt.kind === 'available') {
    return (
      <button
        onClick={() => window.codexSwitch.updateDownload()}
        className="text-xs bg-amber-500 hover:bg-amber-400 text-amber-950 font-medium px-3 py-1 rounded"
        title={
          IS_MAC
            ? `新版本 v${evt.version} 可用，点击前往下载页面手动下载 dmg`
            : `新版本 v${evt.version} 可用，点击下载`
        }
      >
        ↑ 新版本 v{evt.version}
      </button>
    );
  }
  if (evt.kind === 'manual-download') {
    return (
      <span
        className="text-xs text-amber-300"
        title="已在浏览器打开 GitHub Releases 页面，请下载 dmg 并拖拽到应用程序文件夹"
      >
        已打开下载页
      </span>
    );
  }
  if (evt.kind === 'download-progress') {
    const pct = Math.floor(evt.percent ?? 0);
    return (
      <div className="text-xs text-slate-300 flex items-center gap-2 min-w-[140px]">
        <span>下载中 {pct}%</span>
        <div className="flex-1 h-1.5 bg-slate-800 rounded overflow-hidden">
          <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }
  if (evt.kind === 'downloaded') {
    return (
      <button
        onClick={() => window.codexSwitch.updateInstall()}
        className="text-xs bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-medium px-3 py-1 rounded"
      >
        ✓ 立即安装并重启
      </button>
    );
  }
  return null;
}
