import { useEffect, useState } from 'react';
import { Setup } from './pages/Setup';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { Logs } from './pages/Logs';
import { Help } from './pages/Help';
import { Plugins } from './pages/Plugins';
import { ChangelogModal } from './components/ChangelogModal';
import { HeaderBar } from './components/HeaderBar';
import { ToastStack } from './components/Toast';
import { PortConflictModal } from './components/PortConflictModal';
import { useAppStore } from './lib/store';

export default function App(): JSX.Element {
  const {
    page,
    setPage,
    proxyStatus,
    setProxyStatus,
    setPort,
    pushLog,
    setLogs,
    setLifetime,
    setLastError,
    pushToast,
    setPortConflict,
  } = useAppStore();
  const [version, setVersion] = useState('');
  const [showChangelog, setShowChangelog] = useState(false);

  useEffect(() => {
    let unsubStatus: (() => void) | undefined;
    let unsubLog: (() => void) | undefined;
    let unsubError: (() => void) | undefined;
    let unsubSecond: (() => void) | undefined;

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
      if (info.lifetime) setLifetime(info.lifetime);
      if (info.lastError) setLastError(info.lastError.message);

      unsubStatus = window.codexSwitch.onProxyStatus((s) => setProxyStatus(s));
      unsubLog = window.codexSwitch.onProxyLog((entry) => pushLog(entry as never));
      unsubError = window.codexSwitch.onProxyError(async (errInfo) => {
        setLastError(errInfo.message);
        if (errInfo.kind === 'port-conflict') {
          const holder = await window.codexSwitch.proxyLookupPort(errInfo.port);
          setPortConflict({ port: errInfo.port, holder });
        } else {
          pushToast({ kind: 'error', message: errInfo.message });
        }
      });
      unsubSecond = window.codexSwitch.onSecondInstance(() => {
        pushToast({ kind: 'info', message: 'Codex Switch 已经在运行' });
      });
    })();

    return () => {
      unsubStatus?.();
      unsubLog?.();
      unsubError?.();
      unsubSecond?.();
    };
  }, [
    setPage,
    setPort,
    setProxyStatus,
    pushLog,
    setLogs,
    setLifetime,
    setLastError,
    pushToast,
    setPortConflict,
  ]);

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
          {page === 'help' && <Help />}
          {page === 'plugins' && <Plugins />}
        </div>
      </main>
      <ChangelogModal open={showChangelog} onClose={closeChangelog} version={version} />
      <ToastStack />
      <PortConflictModal />
    </div>
  );
}

function titleOf(page: string): string {
  if (page === 'setup') return '首次设置';
  if (page === 'dashboard') return '主面板';
  if (page === 'settings') return '设置';
  if (page === 'logs') return '日志';
  if (page === 'help') return '帮助';
  if (page === 'plugins') return '插件';
  return 'Codex Switch';
}

interface SidebarProps {
  page: string;
  setPage: (p: 'setup' | 'dashboard' | 'settings' | 'logs' | 'help' | 'plugins') => void;
  status: string;
}

function Sidebar({ page, setPage, status }: SidebarProps): JSX.Element {
  const items: Array<{
    id: 'dashboard' | 'settings' | 'plugins' | 'logs';
    label: string;
    emoji: string;
  }> = [
    { id: 'dashboard', label: '主面板', emoji: '🏠' },
    { id: 'settings', label: '设置', emoji: '⚙️' },
    { id: 'plugins', label: '插件', emoji: '🔌' },
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

  // v1.11.0 community
  const [communityCount, setCommunityCount] = useState(0);
  const [isEarlyMember, setIsEarlyMember] = useState(false);
  const [joinedDate, setJoinedDate] = useState('');
  const [inviteCount, setInviteCount] = useState(0);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareText, setShareText] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    window.codexSwitch
      .communityGetCount()
      .then(setCommunityCount)
      .catch(() => {});
    window.codexSwitch
      .communityGetProfile()
      .then((p) => {
        if (p) {
          setIsEarlyMember(p.is_early_member ?? false);
          setInviteCount(p.invite_count ?? 0);
        }
      })
      .catch(() => {});
    // 获取加入日期（本地 lifetimeFirstStartAt，已有字段）
    window.codexSwitch
      .getPreferences()
      .then((prefs) => {
        const date = prefs.lifetimeFirstStartAt;
        if (date) setJoinedDate(date);
      })
      .catch(() => {});
  }, []);

  async function handleShare(): Promise<void> {
    const text = await window.codexSwitch.shareGetText();
    setShareText(text);
    setShowShareModal(true);
    setCopied(false);
  }

  async function handleCopyShare(): Promise<void> {
    try {
      await navigator.clipboard.writeText(shareText);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = shareText;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <aside className="w-56 bg-slate-950 border-r border-slate-800 flex flex-col">
      <div className="px-5 py-6 border-b border-slate-800">
        <div className="text-xl font-semibold tracking-tight">Codex Switch</div>
        <div className="text-xs text-slate-400 mt-1">让 AI 编程触手可及</div>
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
      <div className="px-4 py-3 border-t border-slate-800 text-xs space-y-2">
        {isEarlyMember && (
          <div className="text-slate-500">
            🎖 早期成员
            {joinedDate && <div className="text-slate-400 mt-0.5">加入于 {joinedDate}</div>}
            {inviteCount > 0 && (
              <div className="text-slate-400 mt-0.5">{inviteCount} 位朋友通过你加入</div>
            )}
          </div>
        )}
        <button
          onClick={handleShare}
          className="w-full text-left text-slate-400 hover:text-slate-200 transition"
        >
          💚 推荐给朋友
        </button>
        {communityCount > 0 && (
          <div className="text-slate-500">和 {communityCount} 位朋友一起使用</div>
        )}
        <div className="flex items-center gap-2 text-slate-300 pt-1">
          <span className={`inline-block w-2 h-2 rounded-full ${statusColor}`}></span>
          代理 {statusText}
        </div>
      </div>

      {showShareModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <div className="text-center mb-4">
              <div className="text-2xl mb-2">💚</div>
              <h3 className="text-base font-semibold text-slate-100">
                感谢你把 Codex Switch 推荐给朋友
              </h3>
              <p className="text-sm text-slate-400 mt-1">
                每多一个人用上 Codex 或者 Claude，都是因为你。
              </p>
            </div>
            <button
              onClick={handleCopyShare}
              className={`w-full py-2 rounded-md text-sm font-medium transition ${
                copied ? 'bg-green-600 text-white' : 'bg-brand-600 hover:bg-brand-500 text-white'
              }`}
            >
              {copied ? '✅ 已复制' : '📋 复制推荐语'}
            </button>
            <button
              onClick={() => setShowShareModal(false)}
              className="w-full mt-2 py-2 text-sm text-slate-400 hover:text-slate-200 transition"
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
