import { create } from 'zustand';

export type Page = 'setup' | 'dashboard' | 'settings' | 'logs';

interface AppState {
  page: Page;
  setPage: (p: Page) => void;
  proxyStatus: string;
  setProxyStatus: (s: string) => void;
  port: number;
  setPort: (p: number) => void;
  logs: Array<{ ts: number; level: string; source: string; message: string }>;
  pushLog: (e: { ts: number; level: string; source: string; message: string }) => void;
  setLogs: (l: Array<{ ts: number; level: string; source: string; message: string }>) => void;
}

export const useAppStore = create<AppState>((set) => ({
  page: 'setup',
  setPage: (p) => set({ page: p }),
  proxyStatus: 'stopped',
  setProxyStatus: (s) => set({ proxyStatus: s }),
  port: 11435,
  setPort: (p) => set({ port: p }),
  logs: [],
  pushLog: (e) =>
    set((s) => ({ logs: [...s.logs.slice(-199), e] })),
  setLogs: (l) => set({ logs: l }),
}));
