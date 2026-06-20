/**
 * Request statistics and logging — extracted from server.ts (C1 refactoring).
 *
 * Pure functions for recording request success/error, building log entries,
 * and managing the stats counters.  Does NOT depend on the proxy lifecycle.
 */
import { redactSensitive } from './errors';
import type { ProxyOptions, ProxyLogEntry, RequestStats, ErrorAction } from './types';

// ── Stats helpers ────────────────────────────────────────────────────────

function upstreamLabel(host?: string): string {
  if (!host) return '';
  if (host.includes('agnes')) return ' [Agnes]';
  if (host.includes('deepseek')) return ' [DeepSeek]';
  if (host.includes('bigmodel')) return ' [GLM]';
  return ` [${host}]`;
}

export function recordSuccess(
  stats: RequestStats,
  opts: { onModelCall?: ProxyOptions['onModelCall'] },
  logFn: (entry: Omit<ProxyLogEntry, 'ts'>) => void,
  reqId: string,
  source: 'http' | 'ws',
  startedAt: number,
  requestedModel: string | undefined,
  model: string,
  statusCode: number,
  upstreamBase?: string,
  extras?: {
    endTurn?: boolean;
    finishReason?: string | null;
    connId?: string;
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  },
): void {
  const durationMs = Date.now() - startedAt;
  const isBlocked = (extras?.finishReason ?? '').startsWith('blocked-');
  if (!isBlocked) {
    stats.success += 1;
    stats.totalDurationMs += durationMs;
    stats.recent.push({ ts: Date.now(), ok: true });
    if (extras?.usage) {
      stats.pendingInputTokensDelta += extras.usage.inputTokens;
      stats.pendingOutputTokensDelta += extras.usage.outputTokens;
    }
  }
  const turnTag = extras
    ? ` end_turn=${extras.endTurn} finish=${extras.finishReason ?? 'null'}`
    : '';
  const tokenTag =
    !isBlocked && extras?.usage && extras.usage.totalTokens > 0
      ? ` ↑${extras.usage.inputTokens}↓${extras.usage.outputTokens}`
      : '';
  logFn({
    level: 'info',
    source,
    reqId,
    phase: 'success',
    message: `✓ 请求成功 状态=${statusCode} 耗时=${durationMs}ms model=${model}${upstreamLabel(upstreamBase)}${turnTag}${tokenTag}`,
    durationMs,
    requestedModel,
    model,
    statusCode,
    ...(extras?.endTurn !== undefined ? { endTurn: extras.endTurn } : {}),
    ...(extras?.finishReason !== undefined && extras.finishReason !== null
      ? { finishReason: extras.finishReason }
      : {}),
    ...(extras?.connId ? { connId: extras.connId } : {}),
    ...(extras?.usage && !isBlocked
      ? { inputTokens: extras.usage.inputTokens, outputTokens: extras.usage.outputTokens }
      : {}),
  });
  // v1.7.0 telemetry
  if (!isBlocked) {
    try {
      opts.onModelCall?.({
        model: model || 'unknown',
        stream: true,
        duration_ms: durationMs,
        success: true,
        input_tokens: extras?.usage?.inputTokens,
        output_tokens: extras?.usage?.outputTokens,
      });
    } catch {
      /* telemetry failure must never break the proxy */
    }
  }
}

export function recordError(
  stats: RequestStats,
  opts: { onModelCall?: ProxyOptions['onModelCall'] },
  logFn: (entry: Omit<ProxyLogEntry, 'ts'>) => void,
  reqId: string,
  source: 'http' | 'ws',
  startedAt: number,
  requestedModel: string | undefined,
  model: string | undefined,
  reason: string,
  action: ErrorAction,
  statusCode: number | undefined,
  upstreamBase?: string,
): void {
  const durationMs = Date.now() - startedAt;
  stats.error += 1;
  stats.totalDurationMs += durationMs;
  stats.recent.push({ ts: Date.now(), ok: false });
  stats.lastError = reason;
  stats.lastErrorTs = Date.now();
  logFn({
    level: 'error',
    source,
    reqId,
    phase: 'error',
    message: `✗ 请求失败 状态=${statusCode ?? '未知'} 耗时=${durationMs}ms 原因=${reason}${upstreamLabel(upstreamBase)}`,
    durationMs,
    requestedModel,
    ...(model !== undefined ? { model } : {}),
    ...(statusCode !== undefined ? { statusCode } : {}),
    errorReason: reason,
    errorAction: action,
  });
  // v1.7.0 telemetry
  try {
    opts.onModelCall?.({
      model: model || requestedModel || 'unknown',
      stream: true,
      duration_ms: durationMs,
      success: false,
      error_reason: reason.slice(0, 100),
    });
  } catch {
    /* telemetry failure must never break the proxy */
  }
}

export function getRecentStats(
  stats: RequestStats,
  windowMs = 5 * 60 * 1000,
): {
  total: number;
  successRate: number;
  avgDurationMs: number;
  lastError: string | null;
} {
  const cutoff = Date.now() - windowMs;
  stats.recent = stats.recent.filter((r) => r.ts >= cutoff);
  const total = stats.recent.length;
  const ok = stats.recent.filter((r) => r.ok).length;
  return {
    total,
    successRate: total === 0 ? 1 : ok / total,
    avgDurationMs: stats.total === 0 ? 0 : stats.totalDurationMs / stats.total,
    lastError: stats.lastError,
  };
}

export function consumeLifetimeDelta(
  stats: RequestStats,
  uptimeMs: number,
): {
  requestsDelta: number;
  uptimeMs: number;
  inputTokensDelta: number;
  outputTokensDelta: number;
} {
  const d = stats.pendingDelta;
  const it = stats.pendingInputTokensDelta;
  const ot = stats.pendingOutputTokensDelta;
  stats.pendingDelta = 0;
  stats.pendingInputTokensDelta = 0;
  stats.pendingOutputTokensDelta = 0;
  return {
    requestsDelta: d,
    uptimeMs,
    inputTokensDelta: it,
    outputTokensDelta: ot,
  };
}

// ── Logging ──────────────────────────────────────────────────────────────

export function proxyLog(
  emitLog: (entry: ProxyLogEntry) => void,
  entry: Omit<ProxyLogEntry, 'ts'>,
): void {
  const safe: ProxyLogEntry = {
    ts: Date.now(),
    ...entry,
    message: redactSensitive(entry.message),
  };
  emitLog(safe);
}
