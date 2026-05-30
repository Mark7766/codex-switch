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

export type ProxyStatus = 'stopped' | 'starting' | 'running' | 'error';

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
  private readonly stats: RequestStats = {
    total: 0,
    success: 0,
    error: 0,
    totalDurationMs: 0,
    lastError: null,
    lastErrorTs: 0,
    recent: [],
  };

  constructor(opts: ProxyOptions) {
    super();
    this.opts = opts;
  }

  getStatus(): ProxyStatus {
    return this.status;
  }

  getPort(): number {
    return this.actualPort || this.opts.port;
  }

  getUptimeMs(): number {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }

  getRequestCount(): number {
    return this.stats.total;
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

  async start(): Promise<number> {
    if (this.status === 'running' || this.status === 'starting') return this.actualPort;
    this.status = 'starting';
    this.emit('status', this.status);

    const port = await this.listenWithRetry(this.opts.port);
    this.actualPort = port;
    this.status = 'running';
    this.startedAt = Date.now();
    this.emit('status', this.status);
    this.log({ level: 'info', source: 'proxy', message: `代理已启动 http://127.0.0.1:${port}` });
    return port;
  }

  async stop(): Promise<void> {
    if (!this.server) {
      this.status = 'stopped';
      this.emit('status', this.status);
      return;
    }
    const server = this.server;
    const wss = this.wss;
    this.server = null;
    this.wss = null;
    await new Promise<void>((resolve) => {
      wss?.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    this.status = 'stopped';
    this.startedAt = 0;
    this.emit('status', this.status);
    this.log({ level: 'info', source: 'proxy', message: '代理已停止' });
  }

  private listenWithRetry(startPort: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const tryPort = (port: number, attempts: number): void => {
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
        server.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE' && attempts > 0) {
            this.log({
              level: 'warn',
              source: 'proxy',
              message: `端口 ${port} 被占用，尝试 ${port + 1}`,
            });
            tryPort(port + 1, attempts - 1);
          } else {
            this.status = 'error';
            this.emit('status', this.status);
            reject(err);
          }
        });
        server.listen(port, '127.0.0.1', () => {
          this.server = server;
          this.wss = wss;
          const addr = server.address();
          const boundPort = typeof addr === 'object' && addr ? addr.port : port;
          resolve(boundPort);
        });
      };
      tryPort(startPort, 10);
    });
  }

  private resolveAndWarn(requested: string | undefined, reqId: string, source: 'http' | 'ws'): string {
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
    this.emit('request', { source: 'http', path: '/v1/responses', reqId });

    let body = '';
    req.on('data', (c: Buffer) => (body += c));
    req.on('end', () => {
      let parsed: { instructions?: string; input?: unknown; model?: string; tools?: unknown; stream?: boolean };
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
            status: 'in_progress',
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
            this.recordError(reqId, 'http', startedAt, requestedModel, resolvedModel, friendly.reason, friendly.action, friendly.statusCode);
            res.end();
          });
      } else {
        callDeepSeekSync({ ...chatReq, stream: false }, {
          apiKey: this.opts.apiKey,
          agent: this.agent,
        })
          .then((r) => {
            if (r.status !== 200) {
              const f = translateError({ statusCode: r.status, body: r.body });
              this.recordError(reqId, 'http', startedAt, requestedModel, resolvedModel, f.reason, f.action, r.status);
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
            this.recordError(reqId, 'http', startedAt, requestedModel, resolvedModel, f.reason, f.action, undefined);
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

    ws.on('message', (data) => {
      const reqId = newReqId();
      const startedAt = Date.now();
      let msg: { type?: string; input?: unknown; instructions?: string; model?: string; tools?: unknown };
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        this.log({ level: 'error', source: 'ws', message: `消息解析失败：${(e as Error).message}` });
        return;
      }
      if (msg.type !== 'response.create') return;

      this.stats.total += 1;
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
          status: 'in_progress',
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
          this.recordError(reqId, 'ws', startedAt, requestedModel, resolvedModel, f.reason, f.action, f.statusCode);
          send('error', { error: { message: f.reason, type: 'server_error' } });
        });
    });

    ws.on('error', (e) =>
      this.log({ level: 'error', source: 'ws', message: `WebSocket 错误：${e.message}` }),
    );
    ws.on('close', (code) =>
      this.log({ level: 'info', source: 'ws', message: `WebSocket 关闭 code=${code}` }),
    );
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
