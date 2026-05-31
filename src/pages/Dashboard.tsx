import { useEffect, useState } from 'react';
import { useAppStore } from '../lib/store';

export function Dashboard(): JSX.Element {
  const status = useAppStore((s) => s.proxyStatus);
  const port = useAppStore((s) => s.port);
  const setPort = useAppStore((s) => s.setPort);
  const lifetime = useAppStore((s) => s.lifetime);
  const setLifetime = useAppStore((s) => s.setLifetime);
  const [busy, setBusy] = useState(false);
  const [requestCount, setRequestCount] = useState(0);
  const [uptime, setUptime] = useState(0);
  const [recent, setRecent] = useState<{
    total: number;
    successRate: number;
    avgDurationMs: number;
    lastError: string | null;
  }>({ total: 0, successRate: 1, avgDurationMs: 0, lastError: null });

  useEffect(() => {
    const t = setInterval(async () => {
      const info = await window.codexSwitch.proxyInfo();
      setRequestCount(info.requestCount);
      setUptime(info.uptimeMs);
      setRecent(info.recentStats);
      // §7：以主进程返回的真实 port 为准（修复改端口后重启不一致 bug）
      if (info.port && info.port !== port) setPort(info.port);
      if (info.lifetime) setLifetime(info.lifetime);
    }, 1500);
    return () => clearInterval(t);
  }, [port, setPort, setLifetime]);

  async function toggle(): Promise<void> {
    setBusy(true);
    try {
      if (status === 'running') {
        await window.codexSwitch.proxyStop();
      } else {
        await window.codexSwitch.proxyStart();
      }
    } finally {
      setBusy(false);
    }
  }

  const running = status === 'running';

  return (
    <div className="p-10 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-6">主面板</h1>
      <div className="bg-slate-800/50 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm text-slate-400">本地代理</div>
            <div className="text-lg mt-0.5">
              <span
                className={`inline-block w-2 h-2 rounded-full mr-2 ${
                  running ? 'bg-green-500' : 'bg-slate-500'
                }`}
              />
              {running ? `运行中 · 127.0.0.1:${port}` : '未启动'}
            </div>
          </div>
          <button
            onClick={toggle}
            disabled={busy}
            className={`px-5 py-2 rounded-md text-sm font-medium transition ${
              running ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-600 hover:bg-brand-700'
            } disabled:bg-slate-700`}
          >
            {busy ? '…' : running ? '停止代理' : '启动代理'}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-4 text-sm">
          <Stat label="处理请求" value={String(requestCount)} />
          <Stat label="运行时长" value={formatUptime(uptime)} />
          <Stat label="协议" value="HTTP + WS" />
        </div>
      </div>

      <div className="bg-slate-800/30 rounded-xl p-6 mb-6">
        <div className="text-sm font-medium mb-3">近 5 分钟</div>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <Stat label="请求数" value={String(recent.total)} />
          <Stat
            label="成功率"
            value={recent.total === 0 ? '—' : `${(recent.successRate * 100).toFixed(0)}%`}
          />
          <Stat
            label="平均耗时"
            value={recent.avgDurationMs ? `${Math.round(recent.avgDurationMs)} ms` : '—'}
          />
        </div>
        {recent.lastError && (
          <div className="mt-3 text-xs text-red-300 bg-red-900/30 border border-red-900 rounded px-3 py-2">
            最近一次错误：{recent.lastError}
          </div>
        )}
      </div>

      <div className="bg-slate-800/30 rounded-xl p-6 mb-6">
        <div className="text-sm font-medium mb-3">累计</div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <Stat label="累计请求数" value={String(lifetime.requestCount)} />
          <Stat label="累计运行时长" value={formatLifetime(lifetime.uptimeSec)} />
        </div>
        {lifetime.firstStartAt && (
          <div className="mt-2 text-xs text-slate-400">自 {lifetime.firstStartAt} 起累计</div>
        )}
      </div>

      <div className="bg-slate-800/30 rounded-xl p-6 text-sm leading-relaxed">
        <div className="font-medium mb-2">使用方式</div>
        <ol className="list-decimal list-inside text-slate-300 space-y-1">
          <li>保持本窗口打开，代理才会一直在线。</li>
          <li>
            在终端运行{' '}
            <code className="text-slate-100 bg-slate-900 px-1.5 py-0.5 rounded">codex</code> 或打开
            Codex Desktop，即可直接对话。
          </li>
          <li>想换模型或更新密钥，去左侧「设置」。</li>
        </ol>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="bg-slate-900/70 rounded-md p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-lg mt-0.5">{value}</div>
    </div>
  );
}

function formatUptime(ms: number): string {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}小时${m}分`;
  if (m) return `${m}分${sec}秒`;
  return `${sec}秒`;
}

function formatLifetime(totalSec: number): string {
  if (!totalSec) return '—';
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (d) return `${d}天${h}小时`;
  if (h) return `${h}小时${m}分`;
  return `${m}分`;
}
