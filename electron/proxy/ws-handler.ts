/**
 * WebSocket /v1/responses handler — extracted from server.ts (C1 refactoring).
 *
 * Handles Codex CLI/Desktop WebSocket connections: message parsing,
 * suggestion blocking, compaction trigger handling, conversation history
 * management, and streaming SSE over WS.
 */
import type { WebSocket } from 'ws';
import type https from 'node:https';

import {
  extractTools,
  fixOrphanedToolResults,
  fixToolMessageOrder,
  itemsToMessages,
  type ChatMessage,
  type ChatRequest,
  type ResponsesItem,
} from './translate';
import type { ReasoningStore } from './reasoning';
import { streamDeepSeek, type SseEvent } from './stream';
import { translateError } from './errors';
import type { ConversationStore } from './conversation-store';
import {
  extractCompactionTriggers,
  extractCompactionInputItems,
  buildCompactionOutputItem,
} from './compact';

// ── deps interface ───────────────────────────────────────────────────────

export interface WsHandlerDeps {
  apiKey: string;
  modelMapping: Record<string, string>;
  defaultModel: string;
  blockBackgroundSuggestions: boolean;
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
      connId?: string;
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
  isSuggestionRequest(msg: { input?: unknown; instructions?: string }): boolean;
  processWsCompact(ws: WebSocket, prevRespId: string | undefined): void;
  compactAndStore(
    prevRespId: string | undefined,
  ): Promise<{ compactedId: string; [key: string]: unknown }>;
}

// ── public API ───────────────────────────────────────────────────────────

export function handleWs(ws: WebSocket, deps: WsHandlerDeps): void {
  let lastToolCalls: ResponsesItem[] = [];
  const connId = `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  deps.log({ level: 'info', source: 'ws', message: `WebSocket 连接建立 conn=${connId}`, connId });

  const heartbeat = setInterval(() => {
    if (ws.readyState === 1) {
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }
  }, 20_000);

  const debugWs = process.env.PROXY_DEBUG_WS === '1';
  if (debugWs) {
    const origSend = ws.send.bind(ws);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ws as any).send = (data: unknown, ...rest: unknown[]) => {
      const s =
        typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString() : String(data);
      // eslint-disable-next-line no-console
      console.log('[ws→]', s.slice(0, 400));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (origSend as any)(data, ...rest);
    };
  }

  ws.on('message', async (data) => {
    if (debugWs) {
      // eslint-disable-next-line no-console
      console.log('[ws←]', data.toString().slice(0, 600));
    }
    const reqId = deps.newReqId();
    const startedAt = Date.now();
    let msg: {
      type?: string;
      input?: unknown;
      instructions?: string;
      model?: string;
      tools?: unknown;
      previous_response_id?: string;
    };
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      deps.log({
        level: 'error',
        source: 'ws',
        message: `消息解析失败：${(e as Error).message}`,
      });
      return;
    }

    if (msg.type === 'response.compact') {
      const prevId = (msg as { response?: { previous_response_id?: string } }).response
        ?.previous_response_id;
      deps.processWsCompact(ws, prevId);
      return;
    }
    if (msg.type !== 'response.create') {
      deps.log({
        level: 'warn',
        source: 'ws',
        connId,
        reqId,
        message: `⚠ 未识别的 WS 消息 type="${String(msg.type)}" (已丢弃)`,
      });
      return;
    }

    deps.emit('request', { source: 'ws', path: '/v1/responses', reqId });

    const requestedModel = msg.model;
    const resolvedModel = deps.resolveAndWarn(requestedModel, reqId, 'ws');

    const inputArr = Array.isArray(msg.input) ? (msg.input as Array<Record<string, unknown>>) : [];
    const inputCount = inputArr.length;
    const inputKinds: Record<string, number> = {};
    for (const it of inputArr) {
      const t = String(it.type ?? 'unknown');
      inputKinds[t] = (inputKinds[t] ?? 0) + 1;
    }
    let lastUserPreview = '';
    for (let i = inputArr.length - 1; i >= 0; i--) {
      const it = inputArr[i] as { type?: string; role?: string; content?: unknown };
      if (it && (it.type === 'message' || !it.type) && it.role !== 'assistant') {
        const c = it.content;
        if (typeof c === 'string') lastUserPreview = c;
        else if (Array.isArray(c)) {
          const part = c.find(
            (p) => (p as { type?: string }).type === 'input_text' || (p as { text?: unknown }).text,
          ) as { text?: unknown } | undefined;
          if (part && typeof part.text === 'string') lastUserPreview = part.text;
        }
        if (lastUserPreview) break;
      }
    }
    const toolsCount = Array.isArray(msg.tools) ? msg.tools.length : 0;
    const inputSummary =
      `items=${inputCount} ` +
      `kinds={${Object.entries(inputKinds)
        .map(([k, v]) => `${k}:${v}`)
        .join(',')}} ` +
      `tools=${toolsCount} ` +
      `lastUser="${lastUserPreview.slice(0, 80).replace(/\s+/g, ' ')}"`;

    deps.log({
      level: 'info',
      source: 'ws',
      reqId,
      phase: 'start',
      connId,
      message: `→ 请求开始 model=${requestedModel ?? '<空>'}→${resolvedModel} stream=true ${inputSummary}`,
      requestedModel,
      model: resolvedModel,
    });

    const isEmptyWarmup = inputCount === 0;
    const isSuggestion = deps.blockBackgroundSuggestions !== false && deps.isSuggestionRequest(msg);
    if (deps.blockBackgroundSuggestions !== false && (isSuggestion || isEmptyWarmup)) {
      const reason = isSuggestion ? 'blocked-suggestion' : 'blocked-empty-input';
      const respId = `resp_${Date.now()}`;
      const created = Math.floor(Date.now() / 1000);
      const sendBlocked = (type: string, payload: Record<string, unknown>) => {
        if (ws.readyState === 1) {
          try {
            ws.send(JSON.stringify({ type, ...payload }));
          } catch {
            /* ignore */
          }
        }
      };
      sendBlocked('response.created', {
        response: {
          id: respId,
          object: 'response',
          created_at: created,
          status: 'in_progress',
          error: null,
          incomplete_details: null,
          model: resolvedModel,
          output: [],
        },
      });
      sendBlocked('response.completed', {
        response: {
          id: respId,
          object: 'response',
          created_at: created,
          status: 'completed',
          error: null,
          incomplete_details: null,
          end_turn: true,
          model: resolvedModel,
          output: [],
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        },
      });
      deps.recordSuccess(reqId, 'ws', startedAt, requestedModel, resolvedModel, 200, {
        endTurn: true,
        finishReason: reason,
        connId,
      });
      return;
    }

    deps.stats.total += 1;
    deps.stats.pendingDelta += 1;

    const prevRespId = msg.previous_response_id;

    const rawInput = Array.isArray(msg.input) ? msg.input : [];
    let compactionOutputItem: Record<string, unknown> | null = null;
    let workingInput = rawInput;

    const { compactionTriggers, filteredInput: inputWithoutTriggers } =
      extractCompactionTriggers(workingInput);
    workingInput = inputWithoutTriggers;

    if (compactionTriggers.length > 0) {
      deps.log({
        level: 'info',
        source: 'ws',
        reqId,
        connId,
        message: `↩ 检测到 ${compactionTriggers.length} 个 compaction_trigger，压缩历史中…`,
      });
      try {
        const compacted = await deps.compactAndStore(prevRespId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        compactionOutputItem = buildCompactionOutputItem(compacted as any);
        deps.log({
          level: 'info',
          source: 'ws',
          reqId,
          connId,
          message:
            `↩ 压缩完成 id=${compacted.compactedId} method=${(compacted as Record<string, unknown>).method ?? '?'} ` +
            `original=${(compacted as Record<string, unknown>).originalMessageCount ?? '?'} ` +
            `compacted=${(compacted as Record<string, unknown>).compactedMessageCount ?? '?'}`,
        });
      } catch (err) {
        deps.log({
          level: 'warn',
          source: 'ws',
          reqId,
          connId,
          message: `↩ 压缩失败（继续正常请求）：${(err as Error).message}`,
        });
        compactionOutputItem = null;
      }
    }

    const { messages: restoredCompactionMsgs, filteredInput: inputWithoutCompaction } =
      extractCompactionInputItems(workingInput);
    workingInput = inputWithoutCompaction;

    const storedHistory = prevRespId ? (deps.conversationStore.get(prevRespId) ?? null) : null;

    let fullMessages: ChatMessage[];
    if (restoredCompactionMsgs !== null) {
      const newMessages = itemsToMessages(workingInput, deps.reasoning.asMap());
      fullMessages = [...restoredCompactionMsgs, ...newMessages];
    } else if (storedHistory !== null) {
      const newMessages = itemsToMessages(workingInput, deps.reasoning.asMap());
      fullMessages = [...storedHistory, ...newMessages];
    } else {
      const fixedInput = fixOrphanedToolResults(workingInput, lastToolCalls);
      const sysMsg = msg.instructions ? [{ role: 'system', content: msg.instructions }] : [];
      fullMessages = [...sysMsg, ...itemsToMessages(fixedInput, deps.reasoning.asMap())];
    }
    fullMessages = fixToolMessageOrder(fullMessages);
    if (!fullMessages.some((m) => m.role === 'user' || m.role === 'tool')) {
      fullMessages.push({ role: 'user', content: 'Hello' });
    }

    const chatReq: ChatRequest = { model: resolvedModel, messages: fullMessages };
    const tools = extractTools(msg.tools);
    if (tools) chatReq.tools = tools;

    const respId = `resp_${Date.now()}`;
    const send: SseEvent = (type, payload) => {
      if (ws.readyState === 1) {
        try {
          ws.send(JSON.stringify({ type, ...payload }));
        } catch {
          /* ignore */
        }
      }
    };

    send('response.created', {
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
      send,
      { apiKey: deps.apiKey, agent: deps.agent },
      deps.reasoning,
      compactionOutputItem ? [compactionOutputItem] : undefined,
    )
      .then(({ outputItems, finishReason, endTurn, usage }) => {
        lastToolCalls = outputItems.filter(
          (o) => (o as ResponsesItem).type === 'function_call',
        ) as ResponsesItem[];
        const assistantOutputMessages = itemsToMessages(outputItems, deps.reasoning.asMap());
        deps.conversationStore.set(respId, [...fullMessages, ...assistantOutputMessages]);
        deps.conversationStore.markDirty();
        deps.recordSuccess(reqId, 'ws', startedAt, requestedModel, resolvedModel, 200, {
          endTurn,
          finishReason,
          connId,
          usage,
        });
      })
      .catch((e) => {
        const f = translateStreamError(e as Error);
        deps.recordError(
          reqId,
          'ws',
          startedAt,
          requestedModel,
          resolvedModel,
          f.reason,
          f.action,
          f.statusCode,
        );
        send('error', { error: { message: f.reason, type: 'server_error' } });
      });
  });

  ws.on('error', (e) =>
    deps.log({
      level: 'error',
      source: 'ws',
      connId,
      message: `WebSocket 错误：${e.message}`,
    }),
  );
  ws.on('close', (code, reason) => {
    clearInterval(heartbeat);
    const r = reason && reason.length > 0 ? reason.toString() : '';
    deps.log({
      level: 'info',
      source: 'ws',
      connId,
      message: `WebSocket 关闭 conn=${connId} code=${code}${r ? ` reason=${r}` : ''}`,
    });
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
