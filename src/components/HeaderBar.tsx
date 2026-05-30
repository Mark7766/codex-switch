import { useState } from 'react';
import { HelpDrawer } from './HelpDrawer';
import { UpdateBadge } from './UpdateBadge';

interface HeaderBarProps {
  title: string;
  /** 当前所在页面，用于让帮助抽屉给出"页面相关"的提示。 */
  page: 'setup' | 'dashboard' | 'settings' | 'logs';
}

export function HeaderBar({ title, page }: HeaderBarProps): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="h-12 border-b border-slate-800 bg-slate-900/80 backdrop-blur flex items-center px-5 sticky top-0 z-30">
        <div className="text-sm text-slate-200 font-medium">{title}</div>
        <div className="flex-1" />
        <UpdateBadge />
        <button
          onClick={() => setOpen(true)}
          className="ml-3 w-8 h-8 rounded-full border border-slate-700 text-slate-300 hover:bg-slate-800 flex items-center justify-center"
          aria-label="帮助"
          title="帮助"
        >
          ?
        </button>
      </div>
      <HelpDrawer open={open} onClose={() => setOpen(false)} page={page} />
    </>
  );
}
