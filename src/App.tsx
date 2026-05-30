import { useEffect } from 'react';
import { useState } from 'react';
import { Setup } from './pages/Setup';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { Logs } from './pages/Logs';
import { ChangelogModal } from './components/ChangelogModal';
import { HeaderBar } from './components/HeaderBar';
import { useAppStore } from './lib/store';

export default function App(): JSX.Element {
  const { page, setPage, proxyStatus, setProxyStatus, setPort, pushLog, setLogs } = useAppStore();
  const [version, setVersion] = useState('');
  const [showChangelog, setShowChangelog] = useState(false);

  useEffect(() => {
    let unsubStatus: (() => void) | undefined;
    let unsubLog: (() => void) | undefined;

    (async () => {
      const prefs = await window.codexSwitch.getPreferences();
      setPort(prefs.proxyPort);
      setPage(prefs.hasCompletedSetup ? 'dashboard' : 'setup');

      const v = await window.codexSwitch.getVersion();
      setVersion(v);
      if (prefs.hasCompletedSetup && prefs.lastSeenVersion !== v) {
        setShowChangelog(true);
      }

      const info = await window.codexSwitch.proxyInfo();
      setProxyStatus(info.status);
      setLogs(info.logs);
      if (info.port) setPort(info.port);

      unsubStatus = window.codexSwitch.onProxyStatus((s) => setProxyStatus(s));
      unsubLog = window.codexSwitch.onProxyLog((entry) => pushLog(entry as never));
    })();

    return () => {
      unsubStatus?.();
      unsubLog?.();
    };
  }, [setPage, setPort, setProxyStatus, pushLog, setLogs]);

  const closeChangelog = async (): Promise<void> => {
    setShowChangelog(false);
    if (version) await window.codexSwitch.setPreferences({ lastSeenVersion: version });
  };

  return (
    <div className="flex h-full">
      <Sidebar page={page} setPage={setPage} status={proxyStatus} />
      <main className="flex-1 overflow-auto bg-slate-900 flex flex-col">
        <HeaderBar title={titleOf(page)} page={page} />
        <div className="flex-1 overflow-auto">
          {page === 'setup' && <Setup />}
          {page === 'dashboard' && <Dashboard />}
          {page === 'settings' && <Settings />}
          {page === 'logs' && <Logs />}
        </div>
      </main>
      <ChangelogModal open={showChangelog} onClose={closeChangelog} version={version} />
    </div>
  );
}

function titleOf(page: string): string {
  if (page === 'setup') return '首次设置';
  if (page === 'dashboard') return '主面板';
  if (page === 'settings') return '设置';
  if (page === 'logs') return '日志';
  return 'Codex Switch';
}

interface SidebarProps {
  page: string;
  setPage: (p: 'setup' | 'dashboard' | 'settings' | 'logs') => void;
  status: string;
}

function Sidebar({ page, setPage, status }: SidebarProps): JSX.Element {
  const items: Array<{ id: 'dashboard' | 'settings' | 'logs'; label: string; emoji: string }> = [
    { id: 'dashboard', label: '主面板', emoji: '🏠' },
    { id: 'settings', label: '设置', emoji: '⚙️' },
    { id: 'logs', label: '日志', emoji: '📜' },
  ];
  const statusColor =
    status === 'running' ? 'bg-green-500' : status === 'error' ? 'bg-red-500' : 'bg-slate-500';
  const statusText =
    status === 'running'
      ? '运行中'
      : status === 'starting'
        ? '启动中'
        : status === 'error'
          ? '出错'
          : '已停止';
  return (
    <aside className="w-56 bg-slate-950 border-r border-slate-800 flex flex-col">
      <div className="px-5 py-6 border-b border-slate-800">
        <div className="text-xl font-semibold tracking-tight">Codex Switch</div>
        <div className="text-xs text-slate-400 mt-1">让 Codex 连上 DeepSeek</div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => setPage(it.id)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition ${
              page === it.id ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <span className="mr-2">{it.emoji}</span>
            {it.label}
          </button>
        ))}
      </nav>
      <div className="p-4 border-t border-slate-800 text-xs">
        <div className="flex items-center gap-2 text-slate-300">
          <span className={`inline-block w-2 h-2 rounded-full ${statusColor}`}></span>
          代理 {statusText}
        </div>
      </div>
    </aside>
  );
}
