import { useEffect, useMemo, useState } from 'react';
import { useAppStore, type LogEntry } from '../lib/store';

type Filter = 'all' | 'error' | 'warn';

export function Logs(): JSX.Element {
  const logs = useAppStore((s) => s.logs);
  const setLogs = useAppStore((s) => s.setLogs);
  const pushToast = useAppStore((s) => s.pushToast);
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showBlocked, setShowBlocked] = useState(false);
  const [stats, setStatsBytes] = useState<{ files: number; totalBytes: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const persisted = (await window.codexSwitch.loadPersistedLogs(500)) as LogEntry[];
        if (persisted && persisted.length > 0) {
          // 合并：把持久化的旧日志放在内存日志之前
          setLogs([...persisted, ...useAppStore.getState().logs]);
        }
        setStatsBytes(await window.codexSwitch.getLogsStats());
      } catch {
        /* ignore */
      }
    })();
  }, [setLogs]);

  const onClear = async (): Promise<void> => {
    await window.codexSwitch.clearPersistedLogs();
    setLogs([]);
    setStatsBytes(await window.codexSwitch.getLogsStats());
    pushToast({ kind: 'success', message: '已清空日志' });
  };

  const onOpenDir = async (): Promise<void> => {
    await window.codexSwitch.openLogsFolder();
  };

  const filtered = useMemo(() => {
    if (filter === 'all') return logs;
    return logs.filter((l) => l.level === filter);
  }, [logs, filter]);

  const groups = useMemo(() => {
    const all = groupByReqId(filtered);
    return showBlocked ? all : all.filter((g) => g.outcome !== 'blocked');
  }, [filtered, showBlocked]);

  const allGroups = useMemo(() => groupByReqId(filtered), [filtered]);
  const groupStats = useMemo(() => {
    let success = 0;
    let error = 0;
    let blocked = 0;
    for (const g of allGroups) {
      if (g.outcome === 'success') success++;
      else if (g.outcome === 'error') error++;
      else if (g.outcome === 'blocked') blocked++;
    }
    return { groups: allGroups.filter((g) => g.outcome !== 'blocked').length, success, error, blocked };
  }, [allGroups]);

  return (
    <div className="p-10 max-w-5xl">
      <h1 className="text-2xl font-semibold mb-2">日志</h1>
      <p className="text-sm text-slate-400 mb-3">
        每次请求按 <code className="bg-slate-900 px-1 rounded">req_xxxxx</code> 编号分组，
        点击展开看完整时间线。日志中的 API Key 已自动脱敏。
      </p>
      {stats && (
        <p className="text-xs text-slate-500 mb-3">
          已持久化 {stats.files} 个日志文件，共{' '}
          {stats.totalBytes < 1024
            ? `${stats.totalBytes} B`
            : stats.totalBytes < 1024 * 1024
              ? `${(stats.totalBytes / 1024).toFixed(1)} KB`
              : `${(stats.totalBytes / 1024 / 1024).toFixed(1)} MB`}
        </p>
      )}

      <div className="flex items-center gap-3 mb-4 text-sm">
        <span className="text-slate-400">共 {groupStats.groups} 组请求</span>
        <span className="text-emerald-400">{groupStats.success} 实调 DeepSeek</span>
        <span className="text-slate-400" title="Codex Desktop 后台轮询 / 空 warm-up被本地拦截，未调用 DeepSeek、未消耗 token">
          {groupStats.blocked} 已拦截
        </span>
        <span className="text-red-400">{groupStats.error} 失败</span>
        <div className="flex-1" />
        <button
          onClick={onOpenDir}
          className="text-xs px-2.5 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700"
        >
          打开日志目录
        </button>
        <button
          onClick={onClear}
          className="text-xs px-2.5 py-1 rounded bg-red-700 text-white hover:bg-red-600"
        >
          清空
        </button>
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
  outcome: 'success' | 'error' | 'pending' | 'misc' | 'blocked';
  durationMs?: number;
  model?: string;
  requestedModel?: string;
  statusCode?: number;
  errorReason?: string;
  errorAction?: string;
  blockedReason?: string;
  inputTokens?: number;
  outputTokens?: number;
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
      const fr = l.finishReason ?? '';
      if (fr.startsWith('blocked-')) {
        g.outcome = 'blocked';
        g.blockedReason = fr;
      } else {
        g.outcome = 'success';
        if (l.inputTokens !== undefined) g.inputTokens = l.inputTokens;
        if (l.outputTokens !== undefined) g.outputTokens = l.outputTokens;
      }
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
        : group.outcome === 'blocked'
          ? 'bg-slate-400'
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
            `✓ ${group.requestedModel ?? ''}→${group.model ?? ''} · ${group.durationMs ?? '?'}ms${
              group.inputTokens !== undefined
                ? ` · ↑${group.inputTokens} ↓${group.outputTokens ?? 0} tokens`
                : ''
            }`}
          {group.outcome === 'blocked' && (
            <span className="text-slate-400">
              ⌫ 本地拦截，未调用 DeepSeek（未消耗 token）· {group.blockedReason}
            </span>
          )}
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
