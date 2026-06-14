import { useEffect, useState } from 'react';
import { FaqList } from './FaqList';
import { ReportIssueModal } from './ReportIssueModal';
import { QaGroupModal } from './QaGroupModal';
import { OnboardingDrawer } from './OnboardingDrawer';
import { useAppStore } from '@/lib/store';

interface HelpDrawerProps {
  open: boolean;
  onClose: () => void;
  page: 'setup' | 'dashboard' | 'settings' | 'logs' | 'help' | 'plugins';
}

type Tab = 'faq' | 'onboarding' | 'diag' | 'report' | 'qa';

const PAGE_TIP: Record<HelpDrawerProps['page'], string> = {
  setup: '当前在首次设置：填好 API Key 即可点「完成」启动代理。',
  dashboard: '当前在主面板：可以启动/停止代理，并写入 Codex 配置。',
  settings: '当前在设置：可调整端口、模型映射、备份策略和更新镜像。',
  logs: '当前在日志：每次请求都有 req_xxxxx 编号，点击展开看详情。',
  help: '当前在帮助：上手指南、常见问题和诊断报告。',
  plugins: '当前在插件：可下载离线插件包并引导 Codex 完成安装。',
};

export function HelpDrawer({ open, onClose, page }: HelpDrawerProps): JSX.Element | null {
  const pushToast = useAppStore((s) => s.pushToast);
  const [tab, setTab] = useState<Tab>('faq');
  const [showReport, setShowReport] = useState(false);
  const [showQa, setShowQa] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagPreview, setDiagPreview] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTab('faq');
      setDiagPreview(null);
    }
  }, [open]);

  if (!open) return null;

  async function exportDiag(): Promise<void> {
    setDiagLoading(true);
    try {
      const bundle = await window.codexSwitch.getDiagnostics();
      const json = JSON.stringify(bundle, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `codex-switch-diag-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setDiagPreview(json.slice(0, 600) + (json.length > 600 ? '\n…（已截断）' : ''));
      pushToast({ kind: 'success', message: '诊断信息已导出' });
    } catch (e) {
      pushToast({ kind: 'error', message: '导出失败：' + (e as Error).message });
    } finally {
      setDiagLoading(false);
    }
  }

  async function copyDiag(): Promise<void> {
    setDiagLoading(true);
    try {
      const bundle = await window.codexSwitch.getDiagnostics();
      await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
      pushToast({ kind: 'success', message: '诊断信息已复制到剪贴板' });
    } catch (e) {
      pushToast({ kind: 'error', message: '复制失败：' + (e as Error).message });
    } finally {
      setDiagLoading(false);
    }
  }

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
              ['diag', '诊断'],
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
              className={`flex-1 py-2 text-xs ${
                tab === id
                  ? 'text-white border-b-2 border-brand-500'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="flex-1 overflow-auto p-3 text-sm">
          {tab === 'faq' && <FaqList />}
          {tab === 'diag' && (
            <div className="space-y-4">
              <div className="bg-slate-800/50 rounded-xl p-4">
                <div className="font-medium mb-2">诊断报告</div>
                <p className="text-xs text-slate-400 mb-3">
                  包含版本、工具检测状态和最近日志（已脱敏 API Key），方便向作者反馈问题。
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={exportDiag}
                    disabled={diagLoading}
                    className="px-3 py-1.5 text-xs rounded bg-brand-600 hover:bg-brand-700 disabled:opacity-50"
                  >
                    {diagLoading ? '生成中…' : '下载 JSON'}
                  </button>
                  <button
                    onClick={copyDiag}
                    disabled={diagLoading}
                    className="px-3 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50"
                  >
                    复制到剪贴板
                  </button>
                  <button
                    onClick={() => window.codexSwitch.openLogsDir()}
                    className="px-3 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600"
                  >
                    打开日志目录
                  </button>
                </div>
              </div>
              {diagPreview && (
                <div className="bg-slate-950 rounded-xl p-3 font-mono text-xs text-slate-400 whitespace-pre-wrap overflow-auto max-h-40">
                  {diagPreview}
                </div>
              )}
              <div className="bg-slate-800/50 rounded-xl p-4 text-xs text-slate-400">
                <div className="font-medium text-slate-200 mb-2">遇到问题？</div>
                <ul className="space-y-1.5 list-disc list-inside">
                  <li>401 → 设置页重新填写 DeepSeek API Key</li>
                  <li>429 → 等 30~60 秒或检查 DeepSeek 账户余额</li>
                  <li>端口冲突 → 设置页修改本地端口</li>
                  <li>
                    <button
                      onClick={() =>
                        window.codexSwitch.openExternal(
                          'https://github.com/Mark7766/codex-switch/issues',
                        )
                      }
                      className="text-brand-400 hover:underline"
                    >
                      提交 Issue（GitHub）
                    </button>
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </aside>
      <ReportIssueModal open={showReport} onClose={() => setShowReport(false)} />
      <QaGroupModal open={showQa} onClose={() => setShowQa(false)} />
      <OnboardingDrawer open={showOnboarding} onClose={() => setShowOnboarding(false)} />
    </>
  );
}
