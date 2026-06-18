/**
 * SearchPopover — v1.13.0 smart search floating panel.
 *
 * Apple-style: no backdrop overlay, no click-outside-to-close.
 * Stays visible so users can read step-by-step instructions
 * while performing them in the app. Close with ✕ or Esc.
 */
import { useState, useEffect } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
}

const EXAMPLE_QUERIES = [
  'Codex 连不上怎么办',
  '如何安装插件',
  '为什么 token 消耗这么快',
  'Claude Desktop 怎么配置',
];

export function SearchPopover({ open, onClose }: Props): JSX.Element | null {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [asked, setAsked] = useState(false);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSearch(): Promise<void> {
    const q = query.trim();
    if (!q || loading) return;

    setLoading(true);
    setError('');
    setAnswer('');
    setAsked(true);

    try {
      const result = await window.codexSwitch.searchAsk(q);
      setAnswer(result.answer);
    } catch (e) {
      setError((e as Error).message || '搜索失败');
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Enter') handleSearch();
  }

  function handleExampleClick(example: string): void {
    setQuery(example);
    setLoading(true);
    setError('');
    setAnswer('');
    setAsked(true);
    window.codexSwitch
      .searchAsk(example)
      .then((r) => setAnswer(r.answer))
      .catch((e) => setError((e as Error).message || '搜索失败'))
      .finally(() => setLoading(false));
  }

  return (
    <div className="fixed top-12 right-4 z-50 w-80 max-h-[70vh] flex flex-col bg-slate-800/95 backdrop-blur border border-slate-600 rounded-xl shadow-2xl overflow-hidden">
      {/* search input */}
      <div className="p-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-sm">🔍</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索…"
            className="flex-1 bg-transparent border-none outline-none text-sm text-slate-200 placeholder-slate-500"
            autoFocus
            disabled={loading}
          />
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 text-sm px-1 flex-shrink-0"
            aria-label="关闭搜索"
          >
            ✕
          </button>
        </div>
      </div>

      {/* answer area */}
      {asked && (
        <div className="border-t border-slate-700 px-3 py-2.5 overflow-y-auto flex-shrink">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <span className="inline-block h-3 w-3 rounded-full border-2 border-slate-500 border-t-slate-300 animate-spin" />
              搜索中…
            </div>
          )}

          {error && (
            <div className="text-sm text-red-400">
              {error}
              <button onClick={handleSearch} className="ml-2 text-red-300 underline">
                重试
              </button>
            </div>
          )}

          {!loading && !error && answer && (
            <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-line">
              {answer}
            </div>
          )}
        </div>
      )}

      {/* example queries */}
      {!asked && (
        <div className="border-t border-slate-700 px-3 py-2.5 flex-shrink-0">
          <div className="text-xs text-slate-500 mb-2">试试问：</div>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_QUERIES.map((ex) => (
              <button
                key={ex}
                onClick={() => handleExampleClick(ex)}
                className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-full transition"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* footer */}
      <div className="border-t border-slate-700 px-3 py-1.5 text-[10px] text-slate-500 flex-shrink-0">
        💡 使用你的 DeepSeek 流量，基于帮助文档生成
      </div>
    </div>
  );
}
