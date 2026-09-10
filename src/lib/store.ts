import { create } from 'zustand';

/**
 * 页面路由。v3.0.0: 去掉了 'logs'（随本地代理删除）、'help'（未达页）与 'plugins'（插件子系统已移除），
 * 默认页改为 'settings'（已转型为配置工具，配置页就是主界面）。
 */
export type Page = 'setup' | 'settings' | 'dashboard';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
}

interface AppState {
  page: Page;
  setPage: (p: Page) => void;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;

export const useAppStore = create<AppState>((set) => ({
  page: 'setup',
  setPage: (p) => set({ page: p }),
  toasts: [],
  pushToast: (t) => set((s) => ({ toasts: [...s.toasts, { ...t, id: ++toastSeq }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));
