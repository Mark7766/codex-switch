/**
 * compact-routes.ts — HTTP/WS compact request handlers.
 *
 * Extracted from server.ts.  Handles the routing layer of context compaction:
 * receiving compact requests over HTTP or WebSocket, delegating to compact.ts
 * for the actual compression logic, managing the idempotency cache and
 * conversation store updates.
 */
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WebSocket } from 'ws';

import type { ConversationStore } from './conversation-store';
import { compactHistory, type CompactOptions, type CompactResult } from './compact';

export interface CompactRouteDeps {
  apiKey: string;
  defaultModel: string;
  conversationStore: ConversationStore;
  compactCache: Map<string, CompactResult & { compactedId: string }>;
  activeCompactions: Set<string>;
  log(entry: {
    level: 'info' | 'warn' | 'error';
    source: 'http' | 'ws';
    message: string;
    [key: string]: unknown;
  }): void;
}

export const MAX_COMPACT_BODY = 1024 * 1024; // 1 MB
export const COMPACT_TIMEOUT_MS = 30_000;

// ─── HTTP compact ────────────────────────────────────────────────────────

export function handleCompactHttp(
  req: IncomingMessage,
  res: ServerResponse,
  deps: CompactRouteDeps,
): void {
  let settled = false;
  const ensureOnce = (fn: () => void) => {
    if (settled) return;
    settled = true;
    fn();
  };

  const sendError = (status: number, code: string, message: string) => {
    ensureOnce(() => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code, message } }));
    });
  };

  req.setTimeout(COMPACT_TIMEOUT_MS, () => {
    sendError(408, 'request_timeout', 'compact 请求超时');
    req.destroy();
  });

  req.on('error', (e) => {
    sendError(500, 'stream_error', `请求流错误：${e.message}`);
  });

  const contentLen = Number(req.headers['content-length'] ?? 0);
  if (contentLen > MAX_COMPACT_BODY) {
    sendError(413, 'payload_too_large', `请求体过大（${(contentLen / 1024).toFixed(0)} KB）`);
    return;
  }

  let body = '';
  req.on('data', (c: Buffer) => {
    body += c;
    if (body.length > MAX_COMPACT_BODY) {
      sendError(413, 'payload_too_large', '请求体超过 1MB 限制');
      req.destroy();
    }
  });

  req.on('end', () => {
    ensureOnce(() => {
      processCompactHttp(body, res, deps);
    });
  });
}

async function processCompactHttp(
  body: string,
  res: ServerResponse,
  deps: CompactRouteDeps,
): Promise<void> {
  let prevRespId: string | undefined;
  try {
    if (body.trim().length > 0) {
      const parsed = JSON.parse(body) as { previous_response_id?: string };
      prevRespId = parsed.previous_response_id;
    }
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'bad_request', message: '请求体非 JSON' } }));
    return;
  }

  try {
    const result = await compactAndStore(prevRespId, deps);

    const respBody: Record<string, unknown> = {
      id: result.compactedId,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      status: 'completed',
      model: deps.defaultModel,
      output: [],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      _compact: {
        compacted: result.compacted,
        method: result.method,
        original_message_count: result.originalMessageCount,
        compacted_message_count: result.compactedMessageCount,
        summary_tokens: result.summaryTokens ?? 0,
      },
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(respBody));
  } catch (e) {
    deps.log({
      level: 'error',
      source: 'http',
      message: `compact 处理失败：${(e as Error).message}`,
    });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: { code: 'compact_failed', message: (e as Error).message },
      }),
    );
  }
}

// ─── Core compact logic ──────────────────────────────────────────────────

export async function compactAndStore(
  prevRespId: string | undefined,
  deps: CompactRouteDeps,
): Promise<CompactResult & { compactedId: string }> {
  const cacheKey = prevRespId ?? '__empty__';
  const cached = deps.compactCache.get(cacheKey);
  if (cached) {
    return { ...cached, compactedId: cached.compactedId };
  }

  const history = prevRespId ? (deps.conversationStore.get(prevRespId) ?? []) : [];
  const compactId = `resp_compact_${randomBytes(6).toString('hex')}`;

  const compactOpts: CompactOptions = {
    apiKey: deps.apiKey,
    defaultModel: 'deepseek-chat',
  };

  const result = await compactHistory(history, compactOpts);
  const merged = { ...result, compactedId: compactId };

  deps.conversationStore.set(compactId, merged.compactedMessages, {
    compacted: merged.compacted,
    compactedFrom: prevRespId ?? null,
  });

  if (deps.compactCache.size > 50) {
    const oldest = deps.compactCache.keys().next().value as string | undefined;
    if (oldest !== undefined) deps.compactCache.delete(oldest);
  }
  deps.compactCache.set(cacheKey, merged);

  deps.conversationStore.forceFlush().catch((err) => {
    deps.log({
      level: 'warn',
      source: 'http',
      message: `compact 后刷盘失败：${(err as Error).message}`,
    });
  });

  deps.log({
    level: 'info',
    source: 'http',
    message:
      `↩ /v1/responses/compact → ${compactId} ` +
      `(method=${merged.method}, original=${merged.originalMessageCount}, ` +
      `compacted=${merged.compactedMessageCount}${merged.error ? `, error=${merged.error}` : ''})`,
  });

  return merged;
}

// ─── WS compact ──────────────────────────────────────────────────────────

export function processWsCompact(
  ws: WebSocket,
  prevRespId: string | undefined,
  deps: CompactRouteDeps,
): void {
  if (prevRespId && deps.activeCompactions.has(prevRespId)) return;
  if (prevRespId) {
    deps.activeCompactions.add(prevRespId);
  }

  compactAndStore(prevRespId, deps)
    .then((merged) => {
      if (ws.readyState === 1) {
        try {
          ws.send(
            JSON.stringify({
              type: 'response.completed',
              response: {
                id: merged.compactedId,
                object: 'response',
                status: 'completed',
                created_at: Math.floor(Date.now() / 1000),
                model: deps.defaultModel,
                output: [],
                usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
                _compact: {
                  compacted: merged.compacted,
                  method: merged.method,
                  original_message_count: merged.originalMessageCount,
                  compacted_message_count: merged.compactedMessageCount,
                },
              },
            }),
          );
        } catch {
          /* ignore send errors */
        }
      }
    })
    .catch((err) => {
      deps.log({
        level: 'error',
        source: 'ws',
        message: `WS compact 失败：${(err as Error).message}`,
      });
      if (ws.readyState === 1) {
        try {
          ws.send(
            JSON.stringify({
              type: 'error',
              error: { code: 'compact_failed', message: (err as Error).message },
            }),
          );
        } catch {
          /* ignore */
        }
      }
    })
    .finally(() => {
      if (prevRespId) {
        deps.activeCompactions.delete(prevRespId);
      }
    });
}
