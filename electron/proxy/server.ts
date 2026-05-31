import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { WebSocketServer, type WebSocket } from 'ws';

import {
  extractTools,
  fixOrphanedToolResults,
  itemsToMessages,
  resolveModel,
  type ChatRequest,
  type ResponsesItem,
} from './translate';
import { ReasoningStore } from './reasoning';
import { callDeepSeekSync, streamDeepSeek, type SseEvent } from './stream';
import { translateError, redactSensitive, type ErrorAction } from './errors';

const DEEPSEEK_BASE = 'api.deepseek.com';
const REDACT_HEADERS = new Set(['authorization', 'cookie']);

export interface ProxyOptions {
  apiKey: string;
  port: number;
  modelMapping: Record<string, string>;
  defaultModel?: string;
}

export type LogPhase = 'start' | 'success' | 'error';

export interface ProxyLogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error';
  source: 'http' | 'ws' | 'proxy';
  message: string;
  reqId?: string;
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
  /** 自上次 getLifetimeDelta 以来的请求增量。 */
  pendingDelta: number;
}

function newReqId(): string {
  return 'req_' + randomBytes(3).toString('hex');
}

export class DeepSeekProxy extends EventEmitter {
  private opts: ProxyOptions;
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private status: ProxyStatus = 'stopped';
  private actualPort = 0;
  private readonly reasoning = new ReasoningStore();
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
  };

  constructor(opts: ProxyOptions) {
    super();
    this.opts = opts;
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

  /** 返回自上次调用以来的请求增量并清零，主进程用于持久化 lifetime 统计。 */
  consumeLifetimeDelta(): { requestsDelta: number; uptimeMs: number } {
    const d = this.stats.pendingDelta;
    this.stats.pendingDelta = 0;
    return { requestsDelta: d, uptimeMs: this.getUptimeMs() };
  }

  /** 主面板"近 5 分钟"统计。 */
  getRecentStats(windowMs = 5 * 60 * 1000): {
    total: number;
    successRate: number;
    avgDurationMs: number;
    lastError: string | null;
  } {
    const cutoff = Date.now() - windowMs;
    this.stats.recent = this.stats.recent.filter((r) => r.ts >= cutoff);
    const total = this.stats.recent.length;
    const ok = this.stats.recent.filter((r) => r.ok).length;
    return {
      total,
      successRate: total === 0 ? 1 : ok / total,
      avgDurationMs: this.stats.total === 0 ? 0 : this.stats.totalDurationMs / this.stats.total,
      lastError: this.stats.lastError,
    };
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
      this.start().catch(() => undefined);
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
    requested: string | undefined,
    reqId: string,
    source: 'http' | 'ws',
  ): string {
    const r = resolveModel(
      requested,
      this.opts.modelMapping,
      this.opts.defaultModel ?? 'deepseek-v4-flash',
    );
    if (r.matched === 'prefix' || r.matched === 'fallback') {
      this.log({
        level: 'warn',
        source,
        reqId,
        message: `模型 "${requested ?? '<空>'}" 未在映射表中找到，已自动回退到 "${r.model}"`,
        requestedModel: requested,
        model: r.model,
      });
    }
    return r.model;
  }

  // ─── HTTP handlers ───────────────────────────────────────────────────────

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url || '/', `http://127.0.0.1:${this.actualPort}`);

    if (req.method === 'GET' && url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', port: this.actualPort }));
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/v1')) {
      this.proxyModels(res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/responses') {
      this.handleResponses(req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  private proxyModels(res: ServerResponse): void {
    if (!this.opts.apiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing DeepSeek API key' }));
      return;
    }
    https
      .get(
        {
          hostname: DEEPSEEK_BASE,
          path: '/v1/models',
          agent: this.agent,
          headers: {
            Authorization: `Bearer ${this.opts.apiKey}`,
            Accept: 'application/json',
          },
        },
        (dsRes) => {
          res.writeHead(dsRes.statusCode ?? 502, { 'Content-Type': 'application/json' });
          dsRes.pipe(res);
        },
      )
      .on('error', (e) => {
        this.log({ level: 'error', source: 'http', message: `获取模型列表失败：${e.message}` });
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Upstream unreachable' }));
      });
  }

  private handleResponses(req: IncomingMessage, res: ServerResponse): void {
    const reqId = newReqId();
    const startedAt = Date.now();
    this.stats.total += 1;
    this.stats.pendingDelta += 1;
    this.emit('request', { source: 'http', path: '/v1/responses', reqId });

    let body = '';
    req.on('data', (c: Buffer) => (body += c));
    req.on('end', () => {
      let parsed: {
        instructions?: string;
        input?: unknown;
        model?: string;
        tools?: unknown;
        stream?: boolean;
      };
      try {
        parsed = JSON.parse(body);
      } catch (e) {
        const reason = `请求解析失败：${(e as Error).message}`;
        this.recordError(reqId, 'http', startedAt, undefined, undefined, reason, 'none', 400);
        res.writeHead(400);
        res.end(JSON.stringify({ error: { message: (e as Error).message } }));
        return;
      }

      const requestedModel = parsed.model;
      const resolvedModel = this.resolveAndWarn(requestedModel, reqId, 'http');
      const stream = parsed.stream === true;

      this.log({
        level: 'info',
        source: 'http',
        reqId,
        phase: 'start',
        message: `→ 请求开始 model=${requestedModel ?? '<空>'}→${resolvedModel} stream=${stream}`,
        requestedModel,
        model: resolvedModel,
      });

      const sysMsg = parsed.instructions
        ? [{ role: 'system', content: String(parsed.instructions) }]
        : [];
      const newMsgs = itemsToMessages(parsed.input, this.reasoning.asMap());
      const messages = [...sysMsg, ...newMsgs];
      if (messages.length === 0) messages.push({ role: 'user', content: 'Hello' });

      const chatReq: ChatRequest = { model: resolvedModel, messages };
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
          { apiKey: this.opts.apiKey, agent: this.agent },
          this.reasoning,
        )
          .then(() => {
            this.recordSuccess(reqId, 'http', startedAt, requestedModel, resolvedModel, 200);
            res.end();
          })
          .catch((e) => {
            const friendly = translateStreamError(e as Error);
            this.recordError(
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
        callDeepSeekSync(
          { ...chatReq, stream: false },
          {
            apiKey: this.opts.apiKey,
            agent: this.agent,
          },
        )
          .then((r) => {
            if (r.status !== 200) {
              const f = translateError({ statusCode: r.status, body: r.body });
              this.recordError(
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
            const choices = (r.body as { choices?: Array<{ message?: { content?: string } }> })
              .choices;
            const msg = choices?.[0]?.message || {};
            const msgId = `msg_${Date.now()}`;
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
            this.recordSuccess(reqId, 'http', startedAt, requestedModel, resolvedModel, 200);
          })
          .catch((e) => {
            const f = translateError({ networkErrorMessage: (e as Error).message });
            this.recordError(
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

  // ─── WebSocket handler ───────────────────────────────────────────────────

  private handleWs(ws: WebSocket): void {
    let lastToolCalls: ResponsesItem[] = [];
    this.log({ level: 'info', source: 'ws', message: 'WebSocket 连接建立' });

    // §7-fix: WebSocket 心跳。`ws` 库的服务端不会自动发 ping，长时间无字节
    // 流时，部分 codex CLI 版本会判定连接死亡并触发"Reconnecting…"，即便业务
    // 请求其实是成功的（用户报告：proxy 日志全 200，但 codex 端一直重连）。
    // 每 20s 主动 ping 一次，让客户端的 ping/pong 计时器持续刷新。
    const heartbeat = setInterval(() => {
      if (ws.readyState === 1) {
        try {
          ws.ping();
        } catch {
          /* ignore */
        }
      }
    }, 20_000);

    ws.on('message', (data) => {
      const reqId = newReqId();
      const startedAt = Date.now();
      let msg: {
        type?: string;
        input?: unknown;
        instructions?: string;
        model?: string;
        tools?: unknown;
      };
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        this.log({
          level: 'error',
          source: 'ws',
          message: `消息解析失败：${(e as Error).message}`,
        });
        return;
      }
      if (msg.type !== 'response.create') return;

      this.stats.total += 1;
      this.stats.pendingDelta += 1;
      this.emit('request', { source: 'ws', path: '/v1/responses', reqId });

      const requestedModel = msg.model;
      const resolvedModel = this.resolveAndWarn(requestedModel, reqId, 'ws');
      this.log({
        level: 'info',
        source: 'ws',
        reqId,
        phase: 'start',
        message: `→ 请求开始 model=${requestedModel ?? '<空>'}→${resolvedModel} stream=true`,
        requestedModel,
        model: resolvedModel,
      });

      const fixedInput = fixOrphanedToolResults(
        Array.isArray(msg.input) ? msg.input : [],
        lastToolCalls,
      );
      const sysMsg = msg.instructions ? [{ role: 'system', content: msg.instructions }] : [];
      const fullMessages = [...sysMsg, ...itemsToMessages(fixedInput, this.reasoning.asMap())];
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
        { apiKey: this.opts.apiKey, agent: this.agent },
        this.reasoning,
      )
        .then(({ outputItems }) => {
          lastToolCalls = outputItems.filter(
            (o) => (o as ResponsesItem).type === 'function_call',
          ) as ResponsesItem[];
          this.recordSuccess(reqId, 'ws', startedAt, requestedModel, resolvedModel, 200);
        })
        .catch((e) => {
          const f = translateStreamError(e as Error);
          this.recordError(
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
      this.log({ level: 'error', source: 'ws', message: `WebSocket 错误：${e.message}` }),
    );
    ws.on('close', (code, reason) => {
      clearInterval(heartbeat);
      const r = reason && reason.length > 0 ? reason.toString() : '';
      this.log({
        level: 'info',
        source: 'ws',
        message: `WebSocket 关闭 code=${code}${r ? ` reason=${r}` : ''}`,
      });
    });
  }

  private recordSuccess(
    reqId: string,
    source: 'http' | 'ws',
    startedAt: number,
    requestedModel: string | undefined,
    model: string,
    statusCode: number,
  ): void {
    const durationMs = Date.now() - startedAt;
    this.stats.success += 1;
    this.stats.totalDurationMs += durationMs;
    this.stats.recent.push({ ts: Date.now(), ok: true });
    this.log({
      level: 'info',
      source,
      reqId,
      phase: 'success',
      message: `✓ 请求成功 状态=${statusCode} 耗时=${durationMs}ms model=${model}`,
      durationMs,
      requestedModel,
      model,
      statusCode,
    });
  }

  private recordError(
    reqId: string,
    source: 'http' | 'ws',
    startedAt: number,
    requestedModel: string | undefined,
    model: string | undefined,
    reason: string,
    action: ErrorAction,
    statusCode: number | undefined,
  ): void {
    const durationMs = Date.now() - startedAt;
    this.stats.error += 1;
    this.stats.totalDurationMs += durationMs;
    this.stats.recent.push({ ts: Date.now(), ok: false });
    this.stats.lastError = reason;
    this.stats.lastErrorTs = Date.now();
    this.log({
      level: 'error',
      source,
      reqId,
      phase: 'error',
      message: `✗ 请求失败 状态=${statusCode ?? '未知'} 耗时=${durationMs}ms 原因=${reason}`,
      durationMs,
      requestedModel,
      ...(model !== undefined ? { model } : {}),
      ...(statusCode !== undefined ? { statusCode } : {}),
      errorReason: reason,
      errorAction: action,
    });
  }

  private log(entry: Omit<ProxyLogEntry, 'ts'>): void {
    const safe: ProxyLogEntry = {
      ts: Date.now(),
      ...entry,
      message: redactSensitive(entry.message),
    };
    this.emit('log', safe);
  }
}

function translateStreamError(e: Error): {
  reason: string;
  action: ErrorAction;
  statusCode: number | undefined;
} {
  // streamDeepSeek 的 reject 错误形如: "DeepSeek 400: <body>"
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

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = REDACT_HEADERS.has(k.toLowerCase()) ? '***REDACTED***' : v;
  }
  return out;
}
