import { useMemo, useState } from 'react';
import { useAppStore, type LogEntry } from '../lib/store';

type Filter = 'all' | 'error' | 'warn';

export function Logs(): JSX.Element {
  const logs = useAppStore((s) => s.logs);
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    if (filter === 'all') return logs;
    return logs.filter((l) => l.level === filter);
  }, [logs, filter]);

  const groups = useMemo(() => groupByReqId(filtered), [filtered]);
  const stats = useMemo(() => {
    let success = 0;
    let error = 0;
    for (const g of groups) {
      if (g.outcome === 'success') success++;
      else if (g.outcome === 'error') error++;
    }
    return { groups: groups.length, success, error };
  }, [groups]);

  return (
    <div className="p-10 max-w-5xl">
      <h1 className="text-2xl font-semibold mb-2">日志</h1>
      <p className="text-sm text-slate-400 mb-5">
        每次请求按 <code className="bg-slate-900 px-1 rounded">req_xxxxx</code> 编号分组，
        点击展开看完整时间线。日志中的 API Key 已自动脱敏。
      </p>

      <div className="flex items-center gap-3 mb-4 text-sm">
        <span className="text-slate-400">共 {stats.groups} 组请求</span>
        <span className="text-emerald-400">{stats.success} 成功</span>
        <span className="text-red-400">{stats.error} 失败</span>
        <div className="flex-1" />
        <FilterBtn cur={filter} val="all" onClick={setFilter} label="全部" />
        <FilterBtn cur={filter} val="warn" onClick={setFilter} label="警告" />
        <FilterBtn cur={filter} val="error" onClick={setFilter} label="错误" />
      </div>

      <div className="bg-slate-950 rounded-xl border border-slate-800 max-h-[560px] overflow-auto">
        {groups.length === 0 && (
          <div className="text-slate-500 text-sm p-6">暂无日志，启动代理后再来看看。</div>
        )}
        {groups.map((g) => (
          <GroupRow
            key={g.key}
            group={g}
            open={!!expanded[g.key]}
            onToggle={() => setExpanded((x) => ({ ...x, [g.key]: !x[g.key] }))}
          />
        ))}
      </div>
    </div>
  );
}

function FilterBtn(props: {
  cur: Filter;
  val: Filter;
  onClick: (f: Filter) => void;
  label: string;
}): JSX.Element {
  const active = props.cur === props.val;
  return (
    <button
      onClick={() => props.onClick(props.val)}
      className={`text-xs px-2.5 py-1 rounded ${
        active ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
      }`}
    >
      {props.label}
    </button>
  );
}

interface Group {
  key: string;
  reqId: string | undefined;
  source: string;
  startTs: number;
  outcome: 'success' | 'error' | 'pending' | 'misc';
  durationMs?: number;
  model?: string;
  requestedModel?: string;
  statusCode?: number;
  errorReason?: string;
  errorAction?: string;
  entries: LogEntry[];
}

function groupByReqId(logs: LogEntry[]): Group[] {
  const map = new Map<string, Group>();
  const misc: Group = {
    key: '__misc',
    reqId: undefined,
    source: 'proxy',
    startTs: 0,
    outcome: 'misc',
    entries: [],
  };
  for (const l of logs) {
    if (!l.reqId) {
      misc.entries.push(l);
      misc.startTs = misc.startTs || l.ts;
      continue;
    }
    let g = map.get(l.reqId);
    if (!g) {
      g = {
        key: l.reqId,
        reqId: l.reqId,
        source: l.source,
        startTs: l.ts,
        outcome: 'pending',
        entries: [],
      };
      map.set(l.reqId, g);
    }
    g.entries.push(l);
    if (l.phase === 'success') {
      g.outcome = 'success';
      g.durationMs = l.durationMs;
      g.model = l.model;
      g.requestedModel = l.requestedModel;
      g.statusCode = l.statusCode;
    } else if (l.phase === 'error') {
      g.outcome = 'error';
      g.durationMs = l.durationMs;
      g.model = l.model ?? g.model;
      g.requestedModel = l.requestedModel ?? g.requestedModel;
      g.statusCode = l.statusCode;
      g.errorReason = l.errorReason;
      g.errorAction = l.errorAction;
    }
  }
  const arr = Array.from(map.values()).sort((a, b) => b.startTs - a.startTs);
  if (misc.entries.length > 0) arr.push(misc);
  return arr;
}

function GroupRow({
  group,
  open,
  onToggle,
}: {
  group: Group;
  open: boolean;
  onToggle: () => void;
}): JSX.Element {
  if (group.outcome === 'misc') {
    return (
      <div className="border-b border-slate-800/60">
        <button
          onClick={onToggle}
          className="w-full text-left px-4 py-2 text-xs text-slate-400 hover:bg-slate-900"
        >
          系统 / 启动日志（{group.entries.length} 条）{open ? ' ▾' : ' ▸'}
        </button>
        {open && (
          <div className="px-4 pb-3 font-mono text-xs space-y-0.5">
            {group.entries.map((e, i) => (
              <Line key={i} e={e} />
            ))}
          </div>
        )}
      </div>
    );
  }
  const pillColor =
    group.outcome === 'success'
      ? 'bg-emerald-500'
      : group.outcome === 'error'
        ? 'bg-red-500'
        : 'bg-slate-500';
  return (
    <div className="border-b border-slate-800/60">
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-2.5 hover:bg-slate-900/60 flex items-center gap-3"
      >
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${pillColor}`} />
        <span className="text-xs text-slate-500 font-mono">{group.reqId}</span>
        <span className="text-xs text-slate-500">[{group.source}]</span>
        <span className="text-sm text-slate-200 flex-1 truncate">
          {group.outcome === 'success' &&
            `✓ ${group.requestedModel ?? ''}→${group.model ?? ''} · ${group.durationMs ?? '?'}ms`}
          {group.outcome === 'error' && (
            <span className="text-red-300">
              ✗ {group.errorReason ?? '未知错误'} · {group.durationMs ?? '?'}ms
            </span>
          )}
          {group.outcome === 'pending' && '处理中…'}
        </span>
        <span className="text-xs text-slate-500">
          {new Date(group.startTs).toLocaleTimeString()}
        </span>
        <span className="text-slate-500 text-xs">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-4 pb-3 font-mono text-xs space-y-0.5 bg-slate-950/40">
          {group.entries.map((e, i) => (
            <Line key={i} e={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function Line({ e }: { e: LogEntry }): JSX.Element {
  return (
    <div className="flex gap-3">
      <span className="text-slate-500">{new Date(e.ts).toLocaleTimeString()}</span>
      <span className={levelColor(e.level)}>{e.level.toUpperCase()}</span>
      <span className="text-slate-500">[{e.source}]</span>
      <span className="text-slate-200 break-all flex-1">{e.message}</span>
    </div>
  );
}

function levelColor(level: string): string {
  if (level === 'error') return 'text-red-400';
  if (level === 'warn') return 'text-yellow-400';
  return 'text-emerald-400';
}
