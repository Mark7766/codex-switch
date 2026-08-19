/**
 * 极简 Markdown 渲染：仅支持 #/##/###、空行、列表 (- *)、块引用 (>)、
 * 行内 `code` 与 [text](url)。故意不引入 react-markdown 以减小打包体积与攻击面。
 */
import { useEffect, useState, type ReactNode } from 'react';

interface ChangelogModalProps {
  open: boolean;
  onClose: () => void;
  version: string;
}

export function ChangelogModal({
  open,
  onClose,
  version,
}: ChangelogModalProps): JSX.Element | null {
  const [text, setText] = useState<string>('加载中…');

  useEffect(() => {
    if (!open) return;
    let alive = true;
    window.codexSwitch.getChangelog().then((md: string) => {
      if (alive) setText(md);
    });
    return () => {
      alive = false;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-lg w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-400">更新日志</div>
            <div className="text-base font-semibold">v{version}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="关闭">
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-auto p-5 prose prose-invert text-sm leading-relaxed">
          {renderMarkdown(text)}
        </div>
        <footer className="px-5 py-3 border-t border-slate-800 text-right">
          <button
            onClick={onClose}
            className="bg-brand-600 hover:bg-brand-500 text-white text-sm px-4 py-1.5 rounded"
          >
            知道了
          </button>
        </footer>
      </div>
    </div>
  );
}

export function renderMarkdown(md: string): ReactNode[] {
  const lines = md.split(/\r?\n/);
  const out: ReactNode[] = [];
  let listBuf: string[] = [];
  let quoteBuf: string[] = [];

  const flushList = (): void => {
    if (listBuf.length === 0) return;
    out.push(
      <ul key={`ul-${out.length}`} className="list-disc pl-6 my-2 space-y-1">
        {listBuf.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>,
    );
    listBuf = [];
  };

  const flushQuote = (): void => {
    if (quoteBuf.length === 0) return;
    out.push(
      <blockquote
        key={`q-${out.length}`}
        className="border-l-2 border-slate-600 pl-3 text-slate-300 my-1.5"
      >
        {quoteBuf.map((l, i) => (
          <p key={i} className="my-1">
            {renderInline(l)}
          </p>
        ))}
      </blockquote>,
    );
    quoteBuf = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushList();
      quoteBuf.push(quoteMatch[1] ?? '');
      continue;
    }
    flushQuote();
    if (/^\s*[-*]\s+/.test(line)) {
      listBuf.push(line.replace(/^\s*[-*]\s+/, ''));
      continue;
    }
    flushList();
    if (line.startsWith('### ')) {
      out.push(
        <h3 key={out.length} className="text-base font-semibold mt-4 mb-1">
          {renderInline(line.slice(4))}
        </h3>,
      );
    } else if (line.startsWith('## ')) {
      out.push(
        <h2 key={out.length} className="text-lg font-bold mt-5 mb-2">
          {renderInline(line.slice(3))}
        </h2>,
      );
    } else if (line.startsWith('# ')) {
      out.push(
        <h1 key={out.length} className="text-xl font-bold mt-2 mb-3">
          {renderInline(line.slice(2))}
        </h1>,
      );
    } else if (line === '') {
      out.push(<div key={out.length} className="h-2" />);
    } else {
      out.push(
        <p key={out.length} className="my-1.5">
          {renderInline(line)}
        </p>,
      );
    }
  }
  flushQuote();
  flushList();
  return out;
}

function renderInline(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  const re = /(\[([^\]]+)\]\(([^)]+)\))|(`([^`]+)`)|(\*\*([^*]+)\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) {
      nodes.push(
        <a key={key++} href={m[3]} className="text-brand-400 underline" rel="noreferrer">
          {m[2]}
        </a>,
      );
    } else if (m[4]) {
      nodes.push(
        <code key={key++} className="bg-slate-800 px-1 rounded text-xs">
          {m[5]}
        </code>,
      );
    } else if (m[6]) {
      nodes.push(<strong key={key++}>{m[7]}</strong>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
