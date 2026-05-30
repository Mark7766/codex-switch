import { useEffect, useState } from 'react';

interface ReportIssueModalProps {
  open: boolean;
  onClose: () => void;
}

const ISSUE_URL = 'https://github.com/Mark7766/codex-switch/issues/new';

export function ReportIssueModal({ open, onClose }: ReportIssueModalProps): JSX.Element | null {
  const [bundle, setBundle] = useState<string>('生成中…');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    window.codexSwitch.getDiagnostics().then((d: DiagnosticsBundle) => {
      const lines: string[] = [];
      lines.push(`**版本**: ${d.version}`);
      lines.push(`**操作系统**: ${d.os} ${d.arch}`);
      lines.push(`**生成时间**: ${new Date(d.generatedAt).toISOString()}`);
      lines.push('');
      lines.push('**偏好（已脱敏）**:');
      lines.push('```json');
      lines.push(JSON.stringify(d.prefs, null, 2));
      lines.push('```');
      lines.push('');
      lines.push('**最近 100 条日志（已脱敏）**:');
      lines.push('```');
      for (const l of d.recentLogs) {
        const ts = new Date(l.ts).toISOString();
        const id = l.reqId ? `[${l.reqId}] ` : '';
        lines.push(`${ts} ${l.level.toUpperCase()} ${l.source} ${id}${l.message}`);
      }
      lines.push('```');
      setBundle(lines.join('\n'));
    });
  }, [open]);

  if (!open) return null;

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(bundle);
    setCopied(true);
  };
  const openIssue = (): void => {
    window.codexSwitch.openExternal(ISSUE_URL);
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-lg w-full max-w-3xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="font-semibold">报告问题</div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            ✕
          </button>
        </header>
        <div className="p-4 text-sm text-slate-300 space-y-3 overflow-auto">
          <p>
            为了帮我们更快定位问题，我们生成了一份诊断信息（<strong>已自动脱敏</strong>，不包含 API
            Key）。请把它粘贴到 GitHub issue 里。
          </p>
          <textarea
            readOnly
            value={bundle}
            className="w-full h-72 bg-slate-950 border border-slate-800 rounded p-2 text-xs font-mono"
          />
        </div>
        <footer className="px-5 py-3 border-t border-slate-800 flex items-center gap-3 justify-end">
          <button
            onClick={copy}
            className="bg-slate-700 hover:bg-slate-600 text-white text-sm px-4 py-1.5 rounded"
          >
            {copied ? '已复制 ✓' : '复制诊断信息'}
          </button>
          <button
            onClick={openIssue}
            className="bg-brand-600 hover:bg-brand-500 text-white text-sm px-4 py-1.5 rounded"
          >
            打开 GitHub Issues
          </button>
        </footer>
      </div>
    </div>
  );
}
