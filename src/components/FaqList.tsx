import { useEffect, useState } from 'react';

export function FaqList(): JSX.Element {
  const [items, setItems] = useState<FaqItem[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    window.codexSwitch.getFaq().then((list) => setItems(list as FaqItem[]));
  }, []);

  if (items.length === 0) return <div className="text-slate-500">加载中…</div>;

  return (
    <div className="space-y-2">
      {items.map((it) => {
        const open = openId === it.id;
        return (
          <div key={it.id} className="border border-slate-800 rounded">
            <button
              className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-slate-800/50"
              onClick={() => setOpenId(open ? null : it.id)}
            >
              {it.tag && (
                <span className="text-[10px] bg-slate-800 text-slate-300 rounded px-1.5 py-0.5">
                  {it.tag}
                </span>
              )}
              <span className="flex-1 text-slate-200">{it.question}</span>
              <span className="text-slate-500">{open ? '−' : '+'}</span>
            </button>
            {open && (
              <div className="px-3 pb-3 text-slate-400 whitespace-pre-wrap leading-relaxed">
                {it.answer}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
