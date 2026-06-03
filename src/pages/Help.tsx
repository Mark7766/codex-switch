import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store';

interface FaqItem {
  id: string;
  tag: string;
  question: string;
  answer: string;
}

interface OnboardingStep {
  title: string;
  body: string;
  copy?: string;
}

export function Help(): JSX.Element {
  const [tab, setTab] = useState<'guide' | 'faq' | 'diag'>('guide');

  return (
    <div className="p-10 max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">帮助</h1>
      <div className="flex gap-2 border-b border-slate-700 pb-1">
        <TabBtn cur={tab} val="guide" label="上手指南" onClick={setTab} />
        <TabBtn cur={tab} val="faq" label="常见问题" onClick={setTab} />
        <TabBtn cur={tab} val="diag" label="诊断信息" onClick={setTab} />
      </div>
      {tab === 'guide' && <GuideTab />}
      {tab === 'faq' && <FaqTab />}
      {tab === 'diag' && <DiagTab />}
    </div>
  );
}

/* ─── Guide tab ─────────────────────────────────────────────── */
function GuideTab(): JSX.Element {
  const [steps, setSteps] = useState<OnboardingStep[]>([]);
  const [idx, setIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    window.codexSwitch
      .getOnboarding()
      .then((s) => setSteps(s as OnboardingStep[]))
      .catch(() => undefined);
  }, []);

  const step = steps[idx];

  const doCopy = useCallback(async () => {
    if (!step?.copy) return;
    await navigator.clipboard.writeText(step.copy);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [step]);

  if (!steps.length || !step) {
    return <div className="text-slate-500 text-sm">加载中…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span>
          {idx + 1} / {steps.length}
        </span>
        <div className="flex-1 bg-slate-800 h-1 rounded overflow-hidden">
          <div
            className="bg-brand-600 h-1 transition-all"
            style={{ width: `${((idx + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>
      <div className="bg-slate-800/50 rounded-xl p-6 min-h-[260px] flex flex-col gap-3">
        <div className="text-base font-medium">{step.title}</div>
        <pre className="whitespace-pre-wrap text-sm text-slate-300 font-sans flex-1 leading-relaxed">
          {step.body}
        </pre>
        {step.copy && (
          <div className="mt-2">
            <div className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 font-mono text-sm text-slate-200 flex items-center justify-between gap-3">
              <span className="truncate">{step.copy}</span>
              <button
                onClick={doCopy}
                className="shrink-0 px-3 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 transition"
              >
                {copied ? '✓ 已复制' : '复制'}
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-between">
        <button
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={idx === 0}
          className="px-4 py-2 text-sm rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ← 上一步
        </button>
        <button
          onClick={() => setIdx((i) => Math.min(steps.length - 1, i + 1))}
          disabled={idx === steps.length - 1}
          className="px-4 py-2 text-sm rounded bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          下一步 →
        </button>
      </div>
    </div>
  );
}

/* ─── FAQ tab ────────────────────────────────────────────────── */
function FaqTab(): JSX.Element {
  const [items, setItems] = useState<FaqItem[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [tagFilter, setTagFilter] = useState<string>('全部');

  useEffect(() => {
    window.codexSwitch
      .getFaq()
      .then((f) => setItems(f as FaqItem[]))
      .catch(() => undefined);
  }, []);

  const tags = ['全部', ...Array.from(new Set(items.map((i) => i.tag)))];
  const visible = tagFilter === '全部' ? items : items.filter((i) => i.tag === tagFilter);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {tags.map((t) => (
          <button
            key={t}
            onClick={() => setTagFilter(t)}
            className={`px-2.5 py-1 rounded text-xs ${
              tagFilter === t
                ? 'bg-brand-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {!items.length && <div className="text-slate-500 text-sm">加载中…</div>}
      <div className="space-y-2">
        {visible.map((item) => (
          <div key={item.id} className="bg-slate-800/50 rounded-xl overflow-hidden">
            <button
              onClick={() => setOpen((o) => ({ ...o, [item.id]: !o[item.id] }))}
              className="w-full text-left px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-slate-700/40 transition"
            >
              <span className="text-sm font-medium flex-1">{item.question}</span>
              <span className="text-xs text-slate-400 shrink-0 mr-2 bg-slate-700/60 px-2 py-0.5 rounded">
                {item.tag}
              </span>
              <span className="text-slate-400 text-xs">{open[item.id] ? '▾' : '▸'}</span>
            </button>
            {open[item.id] && (
              <div className="px-5 pb-4 text-sm text-slate-300 border-t border-slate-700/60 pt-3 leading-relaxed whitespace-pre-wrap">
                {item.answer}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Diagnostics tab ────────────────────────────────────────── */
function DiagTab(): JSX.Element {
  const pushToast = useAppStore((s) => s.pushToast);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  async function exportDiag(): Promise<void> {
    setLoading(true);
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
      setPreview(json.slice(0, 600) + (json.length > 600 ? '\n…（已截断）' : ''));
      pushToast({ kind: 'success', message: '诊断信息已导出' });
    } catch (e) {
      pushToast({ kind: 'error', message: '导出失败：' + (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  async function copyDiag(): Promise<void> {
    setLoading(true);
    try {
      const bundle = await window.codexSwitch.getDiagnostics();
      await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
      pushToast({ kind: 'success', message: '诊断信息已复制到剪贴板' });
    } catch (e) {
      pushToast({ kind: 'error', message: '复制失败：' + (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-800/50 rounded-xl p-6">
        <div className="text-base font-medium mb-2">诊断报告</div>
        <p className="text-sm text-slate-400 mb-4">
          包含版本、工具检测状态、配置摘要和最近日志（已自动脱敏 API Key），方便向作者反馈问题。
        </p>
        <div className="flex gap-3">
          <button
            onClick={exportDiag}
            disabled={loading}
            className="px-4 py-2 text-sm rounded bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '生成中…' : '下载 JSON 文件'}
          </button>
          <button
            onClick={copyDiag}
            disabled={loading}
            className="px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            复制到剪贴板
          </button>
          <button
            onClick={() => window.codexSwitch.openLogsDir()}
            className="px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600"
          >
            打开日志目录
          </button>
        </div>
      </div>
      {preview && (
        <div className="bg-slate-950 rounded-xl p-4 font-mono text-xs text-slate-400 whitespace-pre-wrap overflow-auto max-h-48">
          {preview}
        </div>
      )}
      <div className="bg-slate-800/50 rounded-xl p-5 text-sm text-slate-400">
        <div className="font-medium text-slate-200 mb-2">遇到问题？</div>
        <ul className="space-y-1.5 list-disc list-inside">
          <li>日志页看请求详情 —— 红色错误条目有原因说明和修复建议</li>
          <li>401 错误 → 设置页重新填写 DeepSeek API Key</li>
          <li>429 错误 → 等 30~60 秒或检查 DeepSeek 账户余额</li>
          <li>端口冲突 → 设置页修改本地端口</li>
          <li>
            <button
              onClick={() =>
                window.codexSwitch.openExternal('https://github.com/Mark7766/codex-switch/issues')
              }
              className="text-brand-400 hover:underline"
            >
              提交 Issue（GitHub）
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}

function TabBtn({
  cur,
  val,
  label,
  onClick,
}: {
  cur: string;
  val: string;
  label: string;
  onClick: (v: 'guide' | 'faq' | 'diag') => void;
}): JSX.Element {
  return (
    <button
      onClick={() => onClick(val as 'guide' | 'faq' | 'diag')}
      className={`px-4 py-1.5 text-sm rounded-t transition ${
        cur === val ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  );
}
