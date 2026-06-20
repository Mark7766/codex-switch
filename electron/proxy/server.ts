import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { WebSocketServer, type WebSocket } from 'ws';

import { type ChatMessage } from './translate';
import { ReasoningStore } from './reasoning';
import { handleAnthropicMessages } from './anthropic-relay';

import { type ErrorAction } from './errors';
// v1.6.0: anthropic-relay removed — Claude Desktop now connects directly to api.deepseek.com
// v1.13.0: conversationStore (ndjson) replaced by in-memory LRU — same strategy as cc-switch.
import { handleResponses, type HttpHandlerDeps } from './http-handler';
import { handleWs as handleWsFn, type WsHandlerDeps } from './ws-handler';
import { routeHttp } from './http-routes';
import {
  recordSuccess as recordSuccessFn,
  recordError as recordErrorFn,
  getRecentStats as getRecentStatsFn,
  consumeLifetimeDelta as consumeLifetimeDeltaFn,
  proxyLog,
} from './stats';

export interface ProxyOptions {
  apiKey: string;
  port: number;
  modelMapping: Record<string, string>;
  defaultModel?: string;
  /** v1.13.0: 上游 API hostname（如 api.deepseek.com / apihub.agnes-ai.com）。 */
  upstreamBase?: string;
  /** v1.13.0: Agnes 上游 hostname（用于 activeModelMapping 切换）。 */
  agnesUpstreamBase?: string;
  /** 拦截 Codex Desktop 后台 "hyperpersonalized suggestions" 请求，避免一句提问被诱发 N 个后台会话。 */
  blockBackgroundSuggestions?: boolean;
  /** v1.7.0: model_call 遥测回调。每次请求完成（成功或失败）时调用。 */
  onModelCall?: (event: {
    model: string;
    stream: boolean;
    duration_ms: number;
    success: boolean;
    input_tokens?: number;
    output_tokens?: number;
    error_reason?: string;
  }) => void;
  /** v1.13.0: 内存缓存最大条目数，默认 500。 */
  cacheMaxEntries?: number;
  /** v1.13.0: Agnes API Key。 */
  agnesApiKey?: string;
  /** v1.13.0: 中间模型→实际模型+供应商映射。key=codex-switch。 */
  activeModelMapping?: Record<string, { model: string; provider: 'deepseek' | 'agnes' | 'glm' }>;
}

export type LogPhase = 'start' | 'stub' | 'success' | 'error';

export interface ProxyLogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error';
  source: 'http' | 'ws' | 'proxy' | 'search' | 'claude';
  message: string;
  reqId?: string;
  /** WebSocket 连接 id，用于把同一个 WS 上的多次请求串起来。 */
  connId?: string;
  phase?: LogPhase;
  durationMs?: number;
  /** 实际发给 DeepSeek 的模型 */
  model?: string;
  /** 客户端原始模型 */
  requestedModel?: string;
  statusCode?: number;
  /** 友好化错误原因（用户可读中文）。 */
  errorReason?: string;
  /** 错误对应的"就地修复"建议动作。 */
  errorAction?: ErrorAction;
  /** 本轮 response.completed 真正发出的 end_turn 字段值，便于诊断 codex agent 自循环。 */
  endTurn?: boolean;
  /** 上游 DeepSeek 末次 chunk 的 finish_reason（'stop' / 'tool_calls' / 'length' …）。 */
  finishReason?: string;
  meta?: Record<string, unknown>;
}

export type ProxyStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export type ProxyErrorKind = 'port-conflict' | 'runtime' | 'auto-recover-failed';

export interface ProxyErrorInfo {
  kind: ProxyErrorKind;
  port: number;
  message: string;
  /** true 表示后续可由 auto-recover 或用户重试解决；false 表示需要用户介入（如端口冲突）。 */
  recoverable: boolean;
}

interface RequestStats {
  total: number;
  success: number;
  error: number;
  totalDurationMs: number;
  /** 最近一次错误的友好原因。 */
  lastError: string | null;
  /** 最近一次错误的时间戳。 */
  lastErrorTs: number;
  /** 最近 5 分钟内 (now-5min, now] 的请求 [ts, success]。 */
  recent: Array<{ ts: number; ok: boolean }>;
  /** 自上次 consumeLifetimeDelta 以来的请求增量（不含 blocked）。 */
  pendingDelta: number;
  /** 自上次 consumeLifetimeDelta 以来的输入 token 增量。 */
  pendingInputTokensDelta: number;
  /** 自上次 consumeLifetimeDelta 以来的输出 token 增量。 */
  pendingOutputTokensDelta: number;
}

function newReqId(): string {
  return 'req_' + randomBytes(3).toString('hex');
}

/** Codex Desktop 的 "suggestion chips" 提示词指纹（首句即可识别）。 */
const SUGGESTION_PROMPT_FINGERPRINTS: ReadonlyArray<string> = [
  '# Overview\nGenerate 0 to 3 hyperpersonalized suggestions',
  'Generate 0 to 3 hyperpersonalized suggestions',
];

/** 识别 Codex Desktop 后台 "hyperpersonalized suggestions" 请求。 */
export function isBackgroundSuggestionRequest(msg: {
  input?: unknown;
  instructions?: string;
}): boolean {
  const probe = (s: unknown): boolean => {
    if (typeof s !== 'string' || s.length === 0) return false;
    return SUGGESTION_PROMPT_FINGERPRINTS.some((fp) => s.includes(fp));
  };
  if (probe(msg.instructions)) return true;
  const arr = Array.isArray(msg.input) ? (msg.input as Array<Record<string, unknown>>) : [];
  for (const it of arr) {
    const c = it.content;
    if (probe(c)) return true;
    if (Array.isArray(c)) {
      for (const part of c) {
        if (probe((part as { text?: unknown }).text)) return true;
      }
    }
  }
  return false;
}

export class DeepSeekProxy extends EventEmitter {
  private opts: ProxyOptions;
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private status: ProxyStatus = 'stopped';
  private actualPort = 0;
  private readonly reasoning = new ReasoningStore();
  /**
   * v1.13.0: 纯内存 LRU 缓存 (responseId → messages)。
   *
   * 不再持久化到 ndjson。缓存命中直接返回；未命中时从 Codex 的 sessions/ JSONL
   * 按需加载（由 http-handler / ws-handler 通过 deps 自行 fallback）。
   */
  private readonly conversationCache = new Map<string, ChatMessage[]>();
  private readonly cacheMaxEntries: number;
  private readonly agent = new https.Agent({ rejectUnauthorized: true });
  private startedAt = 0;
  /** 串行化 start / stop / restart 调用，避免并发竞态（§7 C2/C5）。 */
  private taskQueue: Promise<unknown> = Promise.resolve();
  /** 当前 server 是否被显式 stop（区分主动停止与运行期 crash）。 */
  private intentionalStop = false;
  /** 已成功 listen 过、运行期 crash 后才会触发自动恢复。 */
  private autoRecoverAttempts = 0;
  private recoverTimer: NodeJS.Timeout | null = null;
  private static readonly RECOVER_BACKOFFS_MS = [1000, 3000, 9000];
  private static readonly STOP_TIMEOUT_MS = 3000;
  private readonly stats: RequestStats = {
    total: 0,
    success: 0,
    error: 0,
    totalDurationMs: 0,
    lastError: null,
    lastErrorTs: 0,
    recent: [],
    pendingDelta: 0,
    pendingInputTokensDelta: 0,
    pendingOutputTokensDelta: 0,
  };

  private upstreamBase(): string {
    return this.opts.upstreamBase ?? 'api.deepseek.com';
  }

  private apiPath(): string {
    return (this.opts.upstreamBase ?? '').includes('bigmodel')
      ? '/api/paas/v4/chat/completions'
      : '/v1/chat/completions';
  }

  constructor(opts: ProxyOptions) {
    super();
    this.opts = opts;
    // v1.14.1: 默认值对齐 store.ts 的 conversationCacheLimit (1000)
    this.cacheMaxEntries = opts.cacheMaxEntries ?? 1000;
  }

  getStatus(): ProxyStatus {
    // §7：以 server.listening 为最终真相，避免 status 字段与实际监听状态错位。
    if (this.server && this.server.listening && this.status === 'running') return 'running';
    return this.status;
  }

  getPort(): number {
    if (this.server && this.server.listening) return this.actualPort;
    return this.opts.port;
  }

  getUptimeMs(): number {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }

  getRequestCount(): number {
    return this.stats.total;
  }

  /** 返回自上次调用以来的请求增量并清零。 */
  consumeLifetimeDelta(): ReturnType<typeof consumeLifetimeDeltaFn> {
    return consumeLifetimeDeltaFn(this.stats, this.getUptimeMs());
  }

  /** 主面板"近 5 分钟"统计。 */
  getRecentStats(windowMs = 5 * 60 * 1000): ReturnType<typeof getRecentStatsFn> {
    return getRecentStatsFn(this.stats, windowMs);
  }

  /** v1.13.0: 返回内存缓存统计信息。 */
  getConversationCacheStats(): { count: number; oldestTimestamp: number | null } {
    return { count: this.conversationCache.size, oldestTimestamp: null };
  }

  /** v1.13.0: 清空内存缓存。 */
  async clearConversationCache(): Promise<void> {
    this.conversationCache.clear();
  }

  /** v1.13.0: 更新缓存最大条目数。 */
  setConversationCacheLimit(n: number): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as unknown as Record<string, unknown>).cacheMaxEntries = Math.max(10, n);
  }

  updateOptions(patch: Partial<ProxyOptions>): void {
    this.opts = { ...this.opts, ...patch };
  }

  /** 串行化外部生命周期调用，确保 start/stop/restart 不并发。 */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.taskQueue.then(fn, fn);
    this.taskQueue = next.catch(() => undefined);
    return next;
  }

  private setStatus(s: ProxyStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
  }

  start(): Promise<number> {
    return this.enqueue(() => this.startInternal());
  }

  stop(): Promise<void> {
    return this.enqueue(() => this.stopInternal(true));
  }

  /** 用最新的 opts 重启：先 stop 再 start，整体串行化。 */
  restart(): Promise<number> {
    return this.enqueue(async () => {
      await this.stopInternal(true);
      return this.startInternal();
    });
  }

  private async startInternal(): Promise<number> {
    if (this.server && this.server.listening) return this.actualPort;
    this.intentionalStop = false;
    this.setStatus('starting');
    const port = this.opts.port;
    try {
      const bound = await this.listenOnce(port);
      this.actualPort = bound;
      this.startedAt = Date.now();
      this.setStatus('running');
      this.attachRuntimeMonitor();
      this.log({
        level: 'info',
        source: 'proxy',
        message: `代理已启动 http://127.0.0.1:${bound}`,
      });
      return bound;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      const kind: ProxyErrorKind = err.code === 'EADDRINUSE' ? 'port-conflict' : 'runtime';
      const info: ProxyErrorInfo = {
        kind,
        port,
        message: err.message,
        recoverable: kind !== 'port-conflict',
      };
      this.setStatus('error');
      this.log({
        level: 'error',
        source: 'proxy',
        message:
          kind === 'port-conflict'
            ? `端口 ${port} 被占用，请通过弹窗处理（不再自动 +1）`
            : `代理启动失败：${err.message}`,
      });
      this.emit('proxy-error', info);
      throw err;
    }
  }

  /** 单次 listen 尝试；EADDRINUSE 直接 reject，**不再自动 +1**。 */
  private listenOnce(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handleHttp(req, res));
      const wss = new WebSocketServer({ noServer: true });
      wss.on('connection', (ws) => this.handleWs(ws));
      server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
        if (url.pathname === '/v1/responses') {
          wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
        } else {
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          socket.destroy();
        }
      });
      const onListenError = (err: NodeJS.ErrnoException): void => {
        try {
          wss.close();
        } catch {
          /* ignore */
        }
        reject(err);
      };
      server.once('error', onListenError);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', onListenError);
        const addr = server.address();
        const boundPort = typeof addr === 'object' && addr ? addr.port : port;
        this.server = server;
        this.wss = wss;
        resolve(boundPort);
      });
    });
  }

  /** listen 成功后挂载运行期错误/异常关闭监听，触发自动恢复。 */
  private attachRuntimeMonitor(): void {
    if (!this.server) return;
    const server = this.server;
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (this.intentionalStop) return;
      this.handleRuntimeFailure(`代理 server 错误：${err.message}`);
    });
    server.once('close', () => {
      if (this.intentionalStop) return;
      // server 在没有显式 stop 的情况下被关闭 → 视为 crash。
      this.handleRuntimeFailure('代理 server 意外关闭');
    });
  }

  private handleRuntimeFailure(message: string): void {
    this.log({ level: 'error', source: 'proxy', message });
    this.server = null;
    this.wss = null;
    this.actualPort = 0;
    this.startedAt = 0;
    this.setStatus('error');
    const info: ProxyErrorInfo = {
      kind: 'runtime',
      port: this.opts.port,
      message,
      recoverable: this.autoRecoverAttempts < DeepSeekProxy.RECOVER_BACKOFFS_MS.length,
    };
    this.emit('proxy-error', info);
    this.scheduleAutoRecover();
  }

  private scheduleAutoRecover(): void {
    const max = DeepSeekProxy.RECOVER_BACKOFFS_MS.length;
    if (this.autoRecoverAttempts >= max) {
      this.log({
        level: 'error',
        source: 'proxy',
        message: `自动恢复 ${max} 次仍失败，已放弃，请手动启动代理`,
      });
      this.emit('proxy-error', {
        kind: 'auto-recover-failed',
        port: this.opts.port,
        message: '自动恢复失败',
        recoverable: false,
      } satisfies ProxyErrorInfo);
      return;
    }
    const delay = DeepSeekProxy.RECOVER_BACKOFFS_MS[this.autoRecoverAttempts]!;
    this.autoRecoverAttempts += 1;
    this.log({
      level: 'warn',
      source: 'proxy',
      message: `将在 ${delay}ms 后尝试自动恢复（第 ${this.autoRecoverAttempts}/${max} 次）`,
    });
    this.recoverTimer = setTimeout(() => {
      this.recoverTimer = null;
      this.start().catch((err) => {
        this.log({
          level: 'warn',
          source: 'proxy',
          message: `自动恢复启动失败：${(err as Error).message}`,
        });
      });
    }, delay);
  }

  /** @param userInitiated 是否由外部 stop() 触发；若是则取消自动恢复并清零计数。 */
  private async stopInternal(userInitiated: boolean): Promise<void> {
    if (userInitiated) {
      this.cancelAutoRecover();
    }
    this.intentionalStop = true;
    if (!this.server) {
      this.actualPort = 0;
      this.startedAt = 0;
      this.setStatus('stopped');
      return;
    }
    this.setStatus('stopping');
    const server = this.server;
    const wss = this.wss;

    // ① 立即强制断开所有 WebSocket 客户端（wss.close 不会主动断已连接的客户端，
    // 否则 Codex CLI 的长连接会让 stop() 一直挂起，端口虽然 LISTEN 关了但已有
    // ESTABLISHED 连接继续在这个进程里跑——本次修复的核心）。
    if (wss) {
      try {
        for (const client of wss.clients) {
          try {
            client.terminate();
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
    }
    // ② 立即销毁所有 HTTP 连接（含 keep-alive、SSE 流），让 server.close 能立刻回调。
    const closeAll = (server as unknown as { closeAllConnections?: () => void })
      .closeAllConnections;
    const closeIdle = (server as unknown as { closeIdleConnections?: () => void })
      .closeIdleConnections;
    try {
      closeIdle?.call(server);
    } catch {
      /* ignore */
    }
    try {
      closeAll?.call(server);
    } catch {
      /* ignore */
    }

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        resolve();
      };
      const t = setTimeout(() => {
        // 极端兜底：再次销毁连接并直接 finish。
        try {
          closeAll?.call(server);
        } catch {
          /* ignore */
        }
        finish();
      }, DeepSeekProxy.STOP_TIMEOUT_MS);
      Promise.allSettled([
        new Promise<void>((r) => (wss ? wss.close(() => r()) : r())),
        new Promise<void>((r) => server.close(() => r())),
      ]).then(() => {
        clearTimeout(t);
        finish();
      });
    });

    // 收尾：再次 closeAllConnections 兜底（极少数 socket 此时才被 accept）。
    try {
      closeAll?.call(server);
    } catch {
      /* ignore */
    }
    server.removeAllListeners();
    if (wss) wss.removeAllListeners();
    this.server = null;
    this.wss = null;
    this.actualPort = 0;
    this.startedAt = 0;
    this.setStatus('stopped');
    this.log({ level: 'info', source: 'proxy', message: '代理已停止' });
  }

  private cancelAutoRecover(): void {
    if (this.recoverTimer) {
      clearTimeout(this.recoverTimer);
      this.recoverTimer = null;
    }
    this.autoRecoverAttempts = 0;
  }

  private resolveAndWarn(
    _requested: string | undefined,
    _reqId: string,
    _source: 'http' | 'ws',
  ): string {
    // v1.13.0: 上游决定供应商，defaultModel 决定具体模型
    const model = this.opts.defaultModel ?? 'deepseek-v4-flash';
    const upstream = this.opts.upstreamBase ?? '';
    const isAgnes = upstream.includes('agnes');
    const isGlm = upstream.includes('bigmodel');
    if (isAgnes && !model.includes('agnes')) return 'agnes-2.0-flash';
    if (!isAgnes && model.includes('agnes')) return 'deepseek-v4-flash';
    if (isGlm && !model.includes('glm')) return 'glm-5.2';
    if (!isGlm && model.includes('glm')) return 'deepseek-v4-flash';
    return model;
  }

  // ─── HTTP routing — delegated to http-routes.ts ─────────────────────────

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    routeHttp(req, res, {
      actualPort: this.actualPort,
      apiKey: this.opts.apiKey,
      upstreamBase: this.upstreamBase(),
      agent: this.agent,
      handleResponses: (rq, rs) => this.handleResponses(rq, rs),
      handleAnthropicMessages: (rq, rs) => this.handleAnthropicRelay(rq, rs),
    });
  }

  // ── deps builders ──────────────────────────────────────────────────────

  /** v1.13.0: 内存 LRU set helper — 自动 LRU 淘汰。 */
  private cacheSet(id: string, messages: ChatMessage[]): Map<string, ChatMessage[]> {
    this.conversationCache.set(id, messages);
    while (this.conversationCache.size > this.cacheMaxEntries) {
      const oldest = this.conversationCache.keys().next().value as string | undefined;
      if (oldest !== undefined) this.conversationCache.delete(oldest);
    }
    return this.conversationCache;
  }

  private getHttpDeps(): HttpHandlerDeps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logFn = (entry: any) => this.log(entry);
    const upstream = this.upstreamBase();
    return {
      apiKey: this.opts.apiKey,
      upstreamBase: upstream,
      apiPath: this.apiPath(),
      agnesUpstreamBase: this.opts.agnesUpstreamBase ?? 'apihub.agnes-ai.com',
      agnesApiKey: this.opts.agnesApiKey ?? '',
      activeModelMapping: this.opts.activeModelMapping,
      modelMapping: this.opts.modelMapping,
      defaultModel: this.opts.defaultModel ?? 'deepseek-v4-flash',
      agent: this.agent,
      conversationCache: {
        get: (id) => this.conversationCache.get(id),
        set: (id, msgs) => this.cacheSet(id, msgs),
        has: (id) => this.conversationCache.has(id),
      },
      reasoning: this.reasoning,
      stats: this.stats,
      log: logFn,
      recordSuccess: (...args) => this.recordSuccess(...args),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recordError: (...args: any[]) => (this.recordError as any)(...args),
      resolveAndWarn: (...args) => this.resolveAndWarn(...args),
      emit: (event, payload) => this.emit(event, payload),
      newReqId: () => newReqId(),
      blockBackgroundSuggestions: this.opts.blockBackgroundSuggestions !== false,
      isSuggestionRequest: (msg) => isBackgroundSuggestionRequest(msg),
    };
  }

  private getWsDeps(): WsHandlerDeps {
    const httpDeps = this.getHttpDeps();
    return {
      ...httpDeps,
      blockBackgroundSuggestions: this.opts.blockBackgroundSuggestions !== false,
      isSuggestionRequest: (msg) => isBackgroundSuggestionRequest(msg),
    };
  }

  private handleResponses(req: IncomingMessage, res: ServerResponse): void {
    handleResponses(req, res, this.getHttpDeps());
  }

  // ─── Anthropic Messages relay — v1.13.0 Agnes ───────────────────────────

  private handleAnthropicRelay(req: IncomingMessage, res: ServerResponse): void {
    handleAnthropicMessages(req, res, {
      apiKey: this.opts.apiKey,
      upstreamBase: this.upstreamBase(),
      apiPath: this.apiPath(),
      agent: this.agent,
      defaultModel: this.opts.defaultModel ?? 'deepseek-v4-flash',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      log: (entry: any) => this.log(entry),
    });
  }

  // ─── WebSocket handler — delegated to ws-handler.ts ─────────────────────

  private handleWs(ws: WebSocket): void {
    handleWsFn(ws, this.getWsDeps());
  }
  // ─── Stats & Logging — delegated to stats.ts ────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recordSuccess(...args: any[]): void {
    const [reqId, source, startedAt, requestedModel, model, statusCode, extras] = args;
    recordSuccessFn(
      this.stats,
      this.opts,
      (e) => this.emit('log', { ts: Date.now(), ...e } as ProxyLogEntry),
      reqId,
      source,
      startedAt,
      requestedModel,
      model,
      statusCode,
      this.opts.upstreamBase,
      extras,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recordError(...args: any[]): void {
    const [reqId, source, startedAt, requestedModel, model, reason, action, statusCode] = args;
    recordErrorFn(
      this.stats,
      this.opts,
      (e) => this.emit('log', { ts: Date.now(), ...e } as ProxyLogEntry),
      reqId,
      source,
      startedAt,
      requestedModel,
      model,
      reason,
      action,
      statusCode,
      this.opts.upstreamBase,
    );
  }

  private log(entry: Omit<ProxyLogEntry, 'ts'>): void {
    proxyLog((e) => this.emit('log', e), entry);
  }
}
