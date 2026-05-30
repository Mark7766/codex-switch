import { useEffect, useState } from 'react';

interface OnboardingDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function OnboardingDrawer({ open, onClose }: OnboardingDrawerProps): JSX.Element | null {
  const [steps, setSteps] = useState<OnboardingStep[]>([]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setCopiedIdx(null);
    window.codexSwitch.getOnboarding().then((list) => setSteps(list as OnboardingStep[]));
  }, [open]);

  if (!open) return null;

  const copy = async (text: string, idx: number): Promise<void> => {
    await navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-lg w-full max-w-xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="font-semibold">使用入门 · Codex Desktop 与 CLI 都能用</div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            ✕
          </button>
        </header>
        <div className="p-5 overflow-auto space-y-4 text-sm text-slate-300">
          {steps.length === 0 && <div className="text-slate-500">加载中…</div>}
          {steps.map((s, i) => (
            <div key={i} className="border border-slate-800 rounded p-3">
              <div className="font-medium text-slate-100 mb-1">{s.title}</div>
              <div className="whitespace-pre-wrap leading-relaxed text-slate-400">{s.body}</div>
              {s.copy && (
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 bg-slate-950 border border-slate-800 px-2 py-1 rounded text-xs">
                    {s.copy}
                  </code>
                  <button
                    onClick={() => copy(s.copy!, i)}
                    className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 py-1 rounded"
                  >
                    {copiedIdx === i ? '已复制 ✓' : '一键复制'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
