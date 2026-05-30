import { create } from 'zustand';

export type Page = 'setup' | 'dashboard' | 'settings' | 'logs';

export interface LogEntry {
  ts: number;
  level: string;
  source: string;
  message: string;
  reqId?: string;
  phase?: string;
  durationMs?: number;
  model?: string;
  requestedModel?: string;
  statusCode?: number;
  errorReason?: string;
  errorAction?: string;
}

interface AppState {
  page: Page;
  setPage: (p: Page) => void;
  proxyStatus: string;
  setProxyStatus: (s: string) => void;
  port: number;
  setPort: (p: number) => void;
  logs: LogEntry[];
  pushLog: (e: LogEntry) => void;
  setLogs: (l: LogEntry[]) => void;
}

export const useAppStore = create<AppState>((set) => ({
  page: 'setup',
  setPage: (p) => set({ page: p }),
  proxyStatus: 'stopped',
  setProxyStatus: (s) => set({ proxyStatus: s }),
  port: 11435,
  setPort: (p) => set({ port: p }),
  logs: [],
  pushLog: (e) => set((s) => ({ logs: [...s.logs.slice(-199), e] })),
  setLogs: (l) => set({ logs: l }),
}));
