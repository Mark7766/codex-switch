import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';

const KIND_STYLES: Record<string, string> = {
  info: 'bg-slate-700 border-slate-500 text-slate-50',
  success: 'bg-emerald-700 border-emerald-500 text-white',
  error: 'bg-red-700 border-red-500 text-white',
};

const AUTO_DISMISS_MS = 2000;

export function ToastStack(): JSX.Element {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.id), AUTO_DISMISS_MS));
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [toasts, dismiss]);

  return (
    <div className="pointer-events-none fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded border px-4 py-2 text-sm shadow-lg ${
            KIND_STYLES[t.kind] ?? KIND_STYLES.info
          }`}
          onClick={() => dismiss(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
