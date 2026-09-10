import { useEffect, useState } from 'react';
import { Setup } from './pages/Setup';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { ChangelogModal } from './components/ChangelogModal';
import { HeaderBar } from './components/HeaderBar';
import { ToastStack } from './components/Toast';
import { useAppStore, type Page } from './lib/store';

export default function App(): JSX.Element {
  const { page, setPage, pushToast } = useAppStore();
  const [version, setVersion] = useState('');
  const [showChangelog, setShowChangelog] = useState(false);

  useEffect(() => {
    let unsubSecond: (() => void) | undefined;

    (async () => {
      const prefs = await window.codexSwitch.getPreferences();
      // v3.0.0: 已转型为配置工具，「设置」既是第一个菜单项也是默认落地页；
      // 首次使用（未完成向导且没有 Key）才进向导。
      const hasKey = (await window.codexSwitch.getKey(prefs.provider)).length > 0;
      setPage(prefs.hasCompletedSetup || hasKey ? 'settings' : 'setup');

      const v = await window.codexSwitch.getVersion();
      setVersion(v);
      if (prefs.hasCompletedSetup && prefs.lastSeenVersion !== v) {
        setShowChangelog(true);
      }

      unsubSecond = window.codexSwitch.onSecondInstance(() => {
        pushToast({ kind: 'info', message: 'Codex Switch 已经在运行' });
      });
    })();

    return () => {
      unsubSecond?.();
    };
  }, [setPage, pushToast]);

  const closeChangelog = async (): Promise<void> => {
    setShowChangelog(false);
    if (version) await window.codexSwitch.setPreferences({ lastSeenVersion: version });
  };

  return (
    <div className="flex h-full">
      <Sidebar page={page} setPage={setPage} />
      <main className="flex-1 overflow-auto bg-slate-900 flex flex-col">
        <HeaderBar title={titleOf(page)} page={page} />
        <div className="flex-1 overflow-auto">
          {page === 'setup' && <Setup />}
          {page === 'settings' && <Settings />}
          {page === 'dashboard' && <Dashboard />}
        </div>
      </main>
      <ChangelogModal open={showChangelog} onClose={closeChangelog} version={version} />
      <ToastStack />
    </div>
  );
}

function titleOf(page: string): string {
  if (page === 'setup') return '首次设置';
  if (page === 'settings') return '设置';
  if (page === 'dashboard') return '工具接入状态';
  return 'Codex Switch';
}

interface SidebarProps {
  page: string;
  setPage: (p: Page) => void;
}

function Sidebar({ page, setPage }: SidebarProps): JSX.Element {
  // v3.0.0: 「设置」排第一（配置工具的主界面），插件页已移除。
  const items: Array<{
    id: 'settings' | 'dashboard';
    label: string;
    emoji: string;
  }> = [
    { id: 'settings', label: '设置', emoji: '⚙️' },
    { id: 'dashboard', label: '工具接入状态', emoji: '🔌' },
  ];

  // v1.11.0 community
  const [communityCount, setCommunityCount] = useState(0);
  const [isEarlyMember, setIsEarlyMember] = useState(false);
  const [joinedDate, setJoinedDate] = useState('');
  const [inviteCount, setInviteCount] = useState(0);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareText, setShareText] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // IPC handler 统一判断（本地 + Server 双路）
    window.codexSwitch
      .communityGetProfile()
      .then((p) => {
        if (p) {
          if (p.joined_date) setJoinedDate(p.joined_date);
          if (p.is_early_member !== undefined) setIsEarlyMember(p.is_early_member);
          if (p.invite_count !== undefined) setInviteCount(p.invite_count);
        }
      })
      .catch(() => {});
    window.codexSwitch
      .communityGetCount()
      .then(setCommunityCount)
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
