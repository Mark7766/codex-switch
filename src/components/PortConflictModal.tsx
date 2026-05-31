import { useState } from 'react';
import { useAppStore } from '@/lib/store';

/**
 * §2 端口冲突处置弹窗。
 * 按钮顺序：[关闭进程并重试 PORT] / [打开设置改端口…] / [取消]
 */
export function PortConflictModal(): JSX.Element | null {
  const conflict = useAppStore((s) => s.portConflict);
  const setConflict = useAppStore((s) => s.setPortConflict);
  const setPage = useAppStore((s) => s.setPage);
  const pushToast = useAppStore((s) => s.pushToast);
  const [busy, setBusy] = useState(false);

  if (!conflict) return null;

  const close = (): void => setConflict(null);

  const onKillRetry = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await window.codexSwitch.proxyKillPort(conflict.port);
      if (!res.ok) {
        pushToast({ kind: 'error', message: `关闭进程失败：${res.reason ?? '未知'}` });
        return;
      }
      // 等待端口释放
      await new Promise((r) => setTimeout(r, 600));
      try {
        await window.codexSwitch.proxyStart();
        pushToast({ kind: 'success', message: '已关闭占用进程并启动代理' });
        close();
      } catch (e) {
        pushToast({
          kind: 'error',
          message: `启动失败：${(e as Error).message ?? String(e)}`,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const onOpenSettings = (): void => {
    setPage('settings');
    close();
  };

  const holderText = conflict.holder
    ? `PID ${conflict.holder.pid}: ${conflict.holder.command}`
    : '未能识别占用进程';

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
      <div className="w-[480px] max-w-[90vw] rounded-lg bg-slate-800 p-5 text-slate-100 shadow-xl">
        <h2 className="mb-2 text-lg font-semibold">端口被占用</h2>
        <p className="mb-2 text-sm text-slate-300">
          端口 <code className="rounded bg-slate-900 px-1">{conflict.port}</code> 已被其它进程占用：
        </p>
        <pre className="mb-4 max-h-32 overflow-auto rounded bg-slate-900 p-2 text-xs text-slate-200">
          {holderText}
        </pre>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy || !conflict.holder}
            onClick={onKillRetry}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >
            关闭进程并重试 {conflict.port}
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded bg-slate-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-500"
          >
            打开设置改端口…
          </button>
          <button
            type="button"
            onClick={close}
            className="rounded bg-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
