import { useEffect, useState } from 'react';

interface QaGroupModalProps {
  open: boolean;
  onClose: () => void;
}

export function QaGroupModal({ open, onClose }: QaGroupModalProps): JSX.Element | null {
  const [src, setSrc] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    window.codexSwitch.getQaImage().then((s: string) => setSrc(s));
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-lg w-full max-w-md flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="font-semibold">交流群</div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            ✕
          </button>
        </header>
        <div className="p-5 flex flex-col items-center text-sm text-slate-300 gap-3">
          <p>扫码加入用户交流群，向作者反馈问题、获取使用技巧。</p>
          {src ? (
            <img src={src} alt="二维码" className="w-64 h-64 bg-white p-2 rounded" />
          ) : (
            <div className="w-64 h-64 flex items-center justify-center text-slate-500 border border-dashed border-slate-700 rounded">
              （未提供二维码图片）
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
