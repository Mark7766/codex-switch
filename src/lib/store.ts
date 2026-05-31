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
  finishReason?: string;
  endTurn?: boolean;
  connId?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
}

export interface PortConflict {
  port: number;
  holder: { pid: number; command: string } | null;
}

export interface Lifetime {
  requestCount: number;
  uptimeSec: number;
  firstStartAt: string;
  inputTokens: number;
  outputTokens: number;
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
  // §4 / §6 / §7 新增
  lifetime: Lifetime;
  setLifetime: (l: Lifetime) => void;
  lastError: string | null;
  setLastError: (m: string | null) => void;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  portConflict: PortConflict | null;
  setPortConflict: (c: PortConflict | null) => void;
}

let toastSeq = 0;

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
  lifetime: { requestCount: 0, uptimeSec: 0, firstStartAt: '', inputTokens: 0, outputTokens: 0 },
  setLifetime: (l) => set({ lifetime: l }),
  lastError: null,
  setLastError: (m) => set({ lastError: m }),
  toasts: [],
  pushToast: (t) => set((s) => ({ toasts: [...s.toasts, { ...t, id: ++toastSeq }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  portConflict: null,
  setPortConflict: (c) => set({ portConflict: c }),
}));
