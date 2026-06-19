/**
 * Shared types for the proxy subsystem.
 *
 * Extracted from server.ts to break the god-object dependency cycle
 * between the HTTP handler, WS handler, compact module, and server.
 */

import type { ChatMessage } from './translate';

// ── Proxy lifecycle ──────────────────────────────────────────────────────

export type ProxyStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export type ProxyErrorKind = 'port-conflict' | 'runtime' | 'auto-recover-failed';

export interface ProxyErrorInfo {
  kind: ProxyErrorKind;
  port: number;
  message: string;
  recoverable: boolean;
}

// ── Proxy options ────────────────────────────────────────────────────────

export interface ProxyOptions {
  apiKey: string;
  port: number;
  modelMapping: Record<string, string>;
  defaultModel?: string;
  blockBackgroundSuggestions?: boolean;
  onModelCall?: (event: {
    model: string;
    stream: boolean;
    duration_ms: number;
    success: boolean;
    input_tokens?: number;
    output_tokens?: number;
    error_reason?: string;
  }) => void;
}

// ── Logging ──────────────────────────────────────────────────────────────

export type LogPhase = 'start' | 'stub' | 'success' | 'error';

export type LogSource = 'http' | 'ws' | 'proxy' | 'search' | 'claude';

export interface ProxyLogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error';
  source: LogSource;
  message: string;
  reqId?: string;
  phase?: LogPhase;
  durationMs?: number;
  requestedModel?: string;
  model?: string;
  statusCode?: number;
  errorReason?: string;
  errorAction?: string;
  inputTokens?: number;
  outputTokens?: number;
  endTurn?: boolean;
  finishReason?: string;
  connId?: string;
}

// ── Stats ────────────────────────────────────────────────────────────────

export interface RequestStats {
  total: number;
  success: number;
  error: number;
  totalDurationMs: number;
  pendingDelta: number;
  pendingInputTokensDelta: number;
  pendingOutputTokensDelta: number;
  lastError: string | null;
  lastErrorTs: number;
  recent: Array<{ ts: number; ok: boolean }>;
}

export type ErrorAction = 'none' | 'retry' | 'auth' | 'quota' | 'bad_request';

// ── Conversation ─────────────────────────────────────────────────────────

export interface ConversationEntry {
  messages: ChatMessage[];
  model?: string;
  compacted?: boolean;
  compactedFrom?: string | null;
}
