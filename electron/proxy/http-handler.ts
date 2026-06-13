/**
 * HTTP /v1/responses handler — extracted from server.ts (C1 refactoring).
 *
 * Handles incoming OpenAI Responses API requests over HTTP: parse body,
 * resolve model, build conversation history from items, translate to
 * DeepSeek Chat Completions, stream SSE response, record stats/logs.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import https from 'node:https';

import {
  extractTools,
  itemsToMessages,
  fixToolMessageOrder,
  type ChatMessage,
  type ChatRequest,
} from './translate';
import type { ReasoningStore } from './reasoning';
import { streamDeepSeek, callDeepSeekSync, type SseEvent } from './stream';
import { translateError, isContextExceededError } from './errors';
import { emergencyCompact } from './compact';
import type { ConversationStore } from './conversation-store';

// ── deps interface ───────────────────────────────────────────────────────

export interface HttpHandlerDeps {
  apiKey: string;
  modelMapping: Record<string, string>;
  defaultModel: string;
  agent: https.Agent;
  conversationStore: ConversationStore;
  reasoning: ReasoningStore;
  stats: {
    total: number;
    pendingDelta: number;
    pendingInputTokensDelta: number;
    pendingOutputTokensDelta: number;
  };
  log(entry: Record<string, unknown>): void;
  recordSuccess(
    reqId: string,
    source: 'http' | 'ws',
    startedAt: number,
    requestedModel: string | undefined,
    model: string,
    statusCode: number,
    extras?: {
      endTurn?: boolean;
      finishReason?: string | null;
      usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
    },
  ): void;
  recordError(
    reqId: string,
    source: 'http' | 'ws',
    startedAt: number,
    requestedModel: string | undefined,
    model: string | undefined,
    reason: string,
    action: string,
    statusCode: number | undefined,
  ): void;
  resolveAndWarn(requested: string | undefined, reqId: string, source: 'http' | 'ws'): string;
  emit(event: string, payload: unknown): void;
  newReqId(): string;
}

// ── handler ──────────────────────────────────────────────────────────────

export function handleResponses(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
): void {
  const reqId = deps.newReqId();
  const startedAt = Date.now();
  deps.stats.total += 1;
  deps.stats.pendingDelta += 1;
  deps.emit('request', { source: 'http', path: '/v1/responses', reqId });

  let body = '';
  req.on('data', (c: Buffer) => (body += c));
  req.on('end', () => {
    let parsed: {
      instructions?: string;
      input?: unknown;
      model?: string;
      tools?: unknown;
      stream?: boolean;
      previous_response_id?: string;
    };
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      const reason = `请求解析失败：${(e as Error).message}`;
      deps.recordError(reqId, 'http', startedAt, undefined, undefined, reason, 'none', 400);
      res.writeHead(400);
      res.end(JSON.stringify({ error: { message: (e as Error).message } }));
      return;
    }

    const requestedModel = parsed.model;
    const resolvedModel = deps.resolveAndWarn(requestedModel, reqId, 'http');
    const stream = parsed.stream === true;

    deps.log({
      level: 'info',
      source: 'http',
      reqId,
      phase: 'start',
      message: `→ 请求开始 model=${requestedModel ?? '<空>'}→${resolvedModel} stream=${stream}`,
      requestedModel,
      model: resolvedModel,
    });

    const prevRespId = parsed.previous_response_id;
    const storedHistory = prevRespId ? (deps.conversationStore.get(prevRespId) ?? null) : null;

    let fullMessages: ChatMessage[];
    if (storedHistory !== null) {
      const newMessages = itemsToMessages(
        Array.isArray(parsed.input) ? parsed.input : [],
        deps.reasoning.asMap(),
      );
      fullMessages = [...storedHistory, ...newMessages];
    } else {
      const sysMsg = parsed.instructions
        ? [{ role: 'system', content: String(parsed.instructions) }]
        : [];
      fullMessages = [
        ...sysMsg,
        ...itemsToMessages(Array.isArray(parsed.input) ? parsed.input : [], deps.reasoning.asMap()),
      ];
    }

    fullMessages = fixToolMessageOrder(fullMessages);
    if (!fullMessages.some((m) => m.role === 'user' || m.role === 'tool')) {
      fullMessages.push({ role: 'user', content: 'Hello' });
    }

    const chatReq: ChatRequest = { model: resolvedModel, messages: fullMessages };
    const tools = extractTools(parsed.tools);
    if (tools) chatReq.tools = tools;

    const respId = `resp_${Date.now()}`;

    if (stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const sse: SseEvent = (type, payload) =>
        res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
      sse('response.created', {
        response: {
          id: respId,
          object: 'response',
          created_at: Math.floor(Date.now() / 1000),
          status: 'in_progress',
          error: null,
          incomplete_details: null,
          model: chatReq.model,
          output: [],
        },
      });
      streamDeepSeek(
        chatReq,
        respId,
        sse,
        { apiKey: deps.apiKey, agent: deps.agent },
        deps.reasoning,
      )
        .then(({ outputItems, finishReason, endTurn, usage }) => {
          const assistantOutputMessages = itemsToMessages(outputItems, deps.reasoning.asMap());
          deps.conversationStore.set(respId, [...fullMessages, ...assistantOutputMessages]);
          deps.conversationStore.markDirty();
          deps.recordSuccess(reqId, 'http', startedAt, requestedModel, resolvedModel, 200, {
            endTurn,
            finishReason,
            usage,
          });
          res.end();
        })
        .catch(async (e) => {
          // v1.8.1: context exceeded recovery — compact and retry once
          if (isContextExceededError(e as Error) && fullMessages.length > 5) {
            const compacted = emergencyCompact(fullMessages);
            deps.log({
              level: 'warn',
              source: 'http',
              reqId,
              message: `上下文超限，已压缩 ${fullMessages.length}→${compacted.length} 条消息，重试中…`,
            });
            const retryReq = { ...chatReq, messages: compacted };
            try {
              const result = await streamDeepSeek(
                retryReq,
                respId,
                sse,
                { apiKey: deps.apiKey, agent: deps.agent },
                deps.reasoning,
              );
              deps.conversationStore.set(respId, [
                ...compacted,
                ...itemsToMessages(result.outputItems, deps.reasoning.asMap()),
              ]);
              deps.conversationStore.markDirty();
              deps.recordSuccess(reqId, 'http', startedAt, requestedModel, resolvedModel, 200, {
                endTurn: result.endTurn,
                finishReason: result.finishReason,
                usage: result.usage,
              });
              res.end();
              return;
            } catch {
              /* retry failed, fall through to normal error */
            }
          }
          const friendly = translateStreamError(e as Error);
          deps.recordError(
            reqId,
            'http',
            startedAt,
            requestedModel,
            resolvedModel,
            friendly.reason,
            friendly.action,
            friendly.statusCode,
          );
          res.end();
        });
    } else {
      callDeepSeekSync({ ...chatReq, stream: false }, { apiKey: deps.apiKey, agent: deps.agent })
        .then((r) => {
          if (r.status !== 200) {
            const f = translateError({ statusCode: r.status, body: r.body });
            deps.recordError(
              reqId,
              'http',
              startedAt,
              requestedModel,
              resolvedModel,
              f.reason,
              f.action,
              r.status,
            );
            res.writeHead(r.status);
            res.end(JSON.stringify(r.body));
            return;
          }
          const syncBody = r.body as {
            choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
          };
          const choices = syncBody.choices;
          const msg = choices?.[0]?.message ?? {};
          const msgId = `msg_${Date.now()}`;
          const finishReason = choices?.[0]?.finish_reason ?? 'stop';
          const usage = syncBody.usage
            ? {
                inputTokens: syncBody.usage.prompt_tokens ?? 0,
                outputTokens: syncBody.usage.completion_tokens ?? 0,
                totalTokens: syncBody.usage.total_tokens ?? 0,
              }
            : undefined;

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              id: respId,
              object: 'response',
              status: 'completed',
              model: chatReq.model,
              output: [
                {
                  id: msgId,
                  type: 'message',
                  status: 'completed',
                  role: 'assistant',
                  content: [{ type: 'output_text', text: msg.content || '', annotations: [] }],
                },
              ],
              usage: (r.body as { usage?: unknown }).usage || {},
            }),
          );

          const outputItems = [
            {
              id: msgId,
              type: 'message',
              status: 'completed',
              role: 'assistant',
              content: [{ type: 'output_text', text: msg.content || '', annotations: [] }],
            },
          ];
          const assistantOutputMessages = itemsToMessages(outputItems, deps.reasoning.asMap());
          deps.conversationStore.set(respId, [...fullMessages, ...assistantOutputMessages]);
          deps.conversationStore.markDirty();

          deps.recordSuccess(reqId, 'http', startedAt, requestedModel, resolvedModel, 200, {
            finishReason,
            usage,
          });
        })
        .catch(async (e) => {
          // v1.8.1: context exceeded recovery — compact and retry once
          if (isContextExceededError(e as Error) && fullMessages.length > 5) {
            const compacted = emergencyCompact(fullMessages);
            deps.log({
              level: 'warn',
              source: 'http',
              reqId,
              message: `上下文超限(sync)，已压缩 ${fullMessages.length}→${compacted.length} 条消息，重试中…`,
            });
            try {
              const retryResult = await callDeepSeekSync(
                { ...chatReq, messages: compacted, stream: false },
                { apiKey: deps.apiKey, agent: deps.agent },
              );
              deps.conversationStore.set(respId, compacted);
              deps.conversationStore.markDirty();
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(retryResult.body));
              deps.recordSuccess(reqId, 'http', startedAt, requestedModel, resolvedModel, 200, {
                finishReason: 'stop',
              });
              return;
            } catch {
              /* retry failed, fall through */
            }
          }
          const f = translateError({ networkErrorMessage: (e as Error).message });
          deps.recordError(
            reqId,
            'http',
            startedAt,
            requestedModel,
            resolvedModel,
            f.reason,
            f.action,
            undefined,
          );
          res.writeHead(500);
          res.end(JSON.stringify({ error: { message: (e as Error).message } }));
        });
    }
  });
}

function translateStreamError(e: Error): {
  reason: string;
  action: string;
  statusCode: number | undefined;
} {
  const m = e.message.match(/^DeepSeek\s+(\d+):\s*(.+)$/);
  if (m) {
    const status = parseInt(m[1]!, 10);
    let bodyParsed: unknown;
    try {
      bodyParsed = JSON.parse(m[2]!);
    } catch {
      bodyParsed = { error: { message: m[2] } };
    }
    const f = translateError({ statusCode: status, body: bodyParsed });
    return { reason: f.reason, action: f.action, statusCode: status };
  }
  const f = translateError({ networkErrorMessage: e.message });
  return { reason: f.reason, action: f.action, statusCode: undefined };
}
