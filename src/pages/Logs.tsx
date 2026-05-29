import { useAppStore } from '../lib/store';

export function Logs(): JSX.Element {
  const logs = useAppStore((s) => s.logs);

  return (
    <div className="p-10 max-w-4xl">
      <h1 className="text-2xl font-semibold mb-6">日志</h1>
      <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 font-mono text-xs h-[480px] overflow-auto">
        {logs.length === 0 && <div className="text-slate-500">暂无日志，启动代理后再来看看。</div>}
        {logs.map((e, i) => (
          <div key={i} className="flex gap-3 py-0.5">
            <span className="text-slate-500">{new Date(e.ts).toLocaleTimeString()}</span>
            <span className={levelColor(e.level)}>{e.level.toUpperCase()}</span>
            <span className="text-slate-500">[{e.source}]</span>
            <span className="text-slate-200 break-all">{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function levelColor(level: string): string {
  if (level === 'error') return 'text-red-400';
  if (level === 'warn') return 'text-yellow-400';
  return 'text-emerald-400';
}
