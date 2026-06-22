/**
 * SearchPopover — v1.13.0 smart search floating panel.
 *
 * Resizable: drag bottom edge for height, left edge for width.
 * Answer: basic markdown-like rendering (bold, lists, line breaks).
 */
import { useState, useEffect, useRef, useCallback } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
}

const EXAMPLE_QUERIES = [
  '如何接入 PackyCode？',
  '如何接入智谱 GLM？',
  '如何接入免费的 Agnes AI 模型？',
  'Codex 连不上怎么办',
  '如何安装插件',
  '为什么 token 消耗这么快',
];

const DEFAULT_W = 384;
const MIN_W = 280;
const MAX_W = 640;
const DEFAULT_H = 360;
const MIN_H = 200;

/** Simple markdown-like text → JSX */
function renderAnswer(text: string): JSX.Element {
  const lines = text.split('\n');
  const elements: JSX.Element[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const key = `l${i}`;

    // empty line → spacing
    if (!line.trim()) {
      elements.push(<div key={key} className="h-2" />);
      continue;
    }

    // bold: **text**
    const formatted = line.replace(
      /\*\*(.+?)\*\*/g,
      '<strong class="text-slate-100 font-semibold">$1</strong>',
    );

    elements.push(
      <div
        key={key}
        className="text-sm text-slate-200 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: formatted }}
      />,
    );
  }

  return <>{elements}</>;
}

export function SearchPopover({ open, onClose }: Props): JSX.Element | null {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [asked, setAsked] = useState(false);

  // Resize state
  const [width, setWidth] = useState(DEFAULT_W);
  const [height, setHeight] = useState(DEFAULT_H);
  const dragging = useRef<'w' | 'h' | 'corner' | null>(null);
  const startRef = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    if (dragging.current === 'w' || dragging.current === 'corner') {
      setWidth(Math.max(MIN_W, Math.min(MAX_W, startRef.current.w - dx)));
    }
    if (dragging.current === 'h' || dragging.current === 'corner') {
      setHeight(Math.max(MIN_H, startRef.current.h + dy));
    }
  }, []);

  const onMouseUp = useCallback(() => {
    dragging.current = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [open, onMouseMove, onMouseUp]);

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

  function handleClear(): void {
    setQuery('');
    setAnswer('');
    setError('');
    setAsked(false);
    setLoading(false);
  }

  function startResize(edge: 'w' | 'h' | 'corner'): (e: React.MouseEvent) => void {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = edge;
      startRef.current = { x: e.clientX, y: e.clientY, w: width, h: height };
    };
  }

  return (
    <div
      className="fixed top-12 right-4 z-50 flex flex-col bg-slate-800/95 backdrop-blur border border-slate-600 rounded-xl shadow-2xl"
      style={{ width, height: height === DEFAULT_H ? undefined : height, maxHeight: height }}
    >
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

      {/* answer area — fills remaining height */}
      {asked && (
        <div className="border-t border-slate-700 px-3 py-2.5 overflow-y-auto flex-1 min-h-0">
          {/* back button */}
          <button
            onClick={handleClear}
            className="text-xs text-slate-400 hover:text-slate-200 mb-2 transition"
          >
            ← 返回
          </button>
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

          {!loading && !error && answer && renderAnswer(answer)}
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

      {/* resize handles */}
      <div
        className="absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize"
        onMouseDown={startResize('w')}
      />
      <div
        className="absolute left-0 -bottom-1 right-0 h-2 cursor-row-resize"
        onMouseDown={startResize('h')}
      />
      <div
        className="absolute -left-1 -bottom-1 w-3 h-3 cursor-nwse-resize"
        onMouseDown={startResize('corner')}
      />
    </div>
  );
}
