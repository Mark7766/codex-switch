import { useState } from 'react';
import { HelpDrawer } from './HelpDrawer';
import { UpdateBadge } from './UpdateBadge';
import { SearchPopover } from './SearchPopover';

interface HeaderBarProps {
  title: string;
  /** 当前所在页面，用于让帮助抽屉给出"页面相关"的提示。 */
  page: 'setup' | 'dashboard' | 'settings' | 'logs' | 'help' | 'plugins';
}

export function HeaderBar({ title, page }: HeaderBarProps): JSX.Element {
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      <div className="h-12 border-b border-slate-800 bg-slate-900/80 backdrop-blur flex items-center px-5 sticky top-0 z-30">
        <div className="text-sm text-slate-200 font-medium">{title}</div>
        <div className="flex-1" />
        <UpdateBadge />
        {/* v1.13.0: smart search */}
        <button
          onClick={() => setSearchOpen(true)}
          className="ml-3 w-8 h-8 rounded-full border border-slate-700 text-slate-300 hover:bg-slate-800 flex items-center justify-center"
          aria-label="搜索"
          title="智能搜索"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-4 h-4"
          >
            <path
              fillRule="evenodd"
              d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <button
          onClick={() => setHelpOpen(true)}
          className="ml-3 w-8 h-8 rounded-full border border-slate-700 text-slate-300 hover:bg-slate-800 flex items-center justify-center"
          aria-label="帮助"
          title="帮助"
        >
          ?
        </button>
      </div>
      <SearchPopover open={searchOpen} onClose={() => setSearchOpen(false)} />
      <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} page={page} />
    </>
  );
}
