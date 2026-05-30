import { useEffect, useState } from 'react';
import { FaqList } from './FaqList';
import { ReportIssueModal } from './ReportIssueModal';
import { QaGroupModal } from './QaGroupModal';
import { OnboardingDrawer } from './OnboardingDrawer';

interface HelpDrawerProps {
  open: boolean;
  onClose: () => void;
  page: 'setup' | 'dashboard' | 'settings' | 'logs';
}

type Tab = 'faq' | 'onboarding' | 'report' | 'qa';

const PAGE_TIP: Record<HelpDrawerProps['page'], string> = {
  setup: '当前在首次设置：填好 API Key 即可点「完成」启动代理。',
  dashboard: '当前在主面板：可以启动/停止代理，并写入 Codex 配置。',
  settings: '当前在设置：可调整端口、模型映射、备份策略和更新镜像。',
  logs: '当前在日志：每次请求都有 req_xxxxx 编号，点击展开看详情。',
};

export function HelpDrawer({ open, onClose, page }: HelpDrawerProps): JSX.Element | null {
  const [tab, setTab] = useState<Tab>('faq');
  const [showReport, setShowReport] = useState(false);
  const [showQa, setShowQa] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (open) setTab('faq');
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <aside className="fixed right-0 top-0 bottom-0 z-50 w-[380px] bg-slate-900 border-l border-slate-800 flex flex-col">
        <header className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="font-semibold text-slate-100">帮助</div>
          <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="关闭">
            ✕
          </button>
        </header>
        <div className="px-4 py-2 text-xs text-slate-400 bg-slate-950/40 border-b border-slate-800">
          {PAGE_TIP[page]}
        </div>
        <nav className="flex border-b border-slate-800 text-sm">
          {(
            [
              ['faq', '常见问题'],
              ['onboarding', '使用入门'],
              ['report', '报告问题'],
              ['qa', '交流群'],
            ] as Array<[Tab, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => {
                if (id === 'report') setShowReport(true);
                else if (id === 'qa') setShowQa(true);
                else if (id === 'onboarding') setShowOnboarding(true);
                else setTab(id);
              }}
              className={`flex-1 py-2 ${
                tab === id
                  ? 'text-white border-b-2 border-brand-500'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="flex-1 overflow-auto p-3 text-sm">{tab === 'faq' && <FaqList />}</div>
      </aside>
      <ReportIssueModal open={showReport} onClose={() => setShowReport(false)} />
      <QaGroupModal open={showQa} onClose={() => setShowQa(false)} />
      <OnboardingDrawer open={showOnboarding} onClose={() => setShowOnboarding(false)} />
    </>
  );
}
