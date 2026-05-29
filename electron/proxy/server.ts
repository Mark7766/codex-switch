import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { WebSocketServer, type WebSocket } from 'ws';

import {
  extractTools,
  fixOrphanedToolResults,
  itemsToMessages,
  mapModel,
  type ChatRequest,
  type ResponsesItem,
} from './translate';
import { ReasoningStore } from './reasoning';
import { callDeepSeekSync, streamDeepSeek, type SseEvent } from './stream';

const DEEPSEEK_BASE = 'api.deepseek.com';
const REDACT_HEADERS = new Set(['authorization', 'cookie']);

export interface ProxyOptions {
  apiKey: string;
  port: number;
  modelMapping: Record<string, string>;
  defaultModel?: string;
}

export interface ProxyLogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error';
  source: 'http' | 'ws' | 'proxy';
  message: string;
  meta?: Record<string, unknown>;
}

export type ProxyStatus = 'stopped' | 'starting' | 'running' | 'error';

/**
 * 本地代理：HTTP + WebSocket，监听 127.0.0.1。
 */
export class DeepSeekProxy extends EventEmitter {
  private opts: ProxyOptions;
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private status: ProxyStatus = 'stopped';
  private actualPort = 0;
  private readonly reasoning = new ReasoningStore();
  private readonly agent = new https.Agent({ rejectUnauthorized: true });
  private startedAt = 0;
  private requestCount = 0;

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
    return this.requestCount;
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
    this.log('info', 'proxy', `代理已启动 http://127.0.0.1:${port}`);
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
    this.log('info', 'proxy', '代理已停止');
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
            this.log('warn', 'proxy', `端口 ${port} 被占用，尝试 ${port + 1}`);
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

  private resolveModel(requested: string | undefined): string {
    return mapModel(requested, this.opts.modelMapping, this.opts.defaultModel ?? 'deepseek-v4-flash');
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
        this.log('error', 'http', `获取模型列表失败：${e.message}`);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Upstream unreachable' }));
      });
  }

  private handleResponses(req: IncomingMessage, res: ServerResponse): void {
    this.requestCount += 1;
    this.emit('request', { source: 'http', path: '/v1/responses' });

    let body = '';
    req.on('data', (c: Buffer) => (body += c));
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const sysMsg = parsed.instructions
          ? [{ role: 'system', content: String(parsed.instructions) }]
          : [];
        const newMsgs = itemsToMessages(parsed.input, this.reasoning.asMap());
        const messages = [...sysMsg, ...newMsgs];
        if (messages.length === 0) messages.push({ role: 'user', content: 'Hello' });

        const chatReq: ChatRequest = {
          model: this.resolveModel(parsed.model),
          messages,
        };
        const tools = extractTools(parsed.tools);
        if (tools) chatReq.tools = tools;

        const respId = `resp_${Date.now()}`;

        if (parsed.stream === true) {
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
          streamDeepSeek(chatReq, respId, sse, { apiKey: this.opts.apiKey, agent: this.agent }, this.reasoning)
            .then(() => res.end())
            .catch((e) => {
              this.log('error', 'http', `SSE 转发失败：${(e as Error).message}`);
              res.end();
            });
        } else {
          callDeepSeekSync({ ...chatReq, stream: false }, {
            apiKey: this.opts.apiKey,
            agent: this.agent,
          })
            .then((r) => {
              if (r.status !== 200) {
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
                      content: [
                        { type: 'output_text', text: msg.content || '', annotations: [] },
                      ],
                    },
                  ],
                  usage: (r.body as { usage?: unknown }).usage || {},
                }),
              );
            })
            .catch((e) => {
              this.log('error', 'http', `同步请求失败：${(e as Error).message}`);
              res.writeHead(500);
              res.end(JSON.stringify({ error: { message: (e as Error).message } }));
            });
        }
      } catch (e) {
        this.log('error', 'http', `请求解析失败：${(e as Error).message}`);
        res.writeHead(400);
        res.end(JSON.stringify({ error: { message: (e as Error).message } }));
      }
    });
  }

  // ─── WebSocket handler ───────────────────────────────────────────────────

  private handleWs(ws: WebSocket): void {
    let lastToolCalls: ResponsesItem[] = [];
    this.log('info', 'ws', 'WebSocket 连接建立');

    ws.on('message', (data) => {
      let msg: { type?: string; input?: unknown; instructions?: string; model?: string; tools?: unknown };
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        this.log('error', 'ws', `消息解析失败：${(e as Error).message}`);
        return;
      }
      if (msg.type !== 'response.create') return;

      this.requestCount += 1;
      this.emit('request', { source: 'ws', path: '/v1/responses' });

      const fixedInput = fixOrphanedToolResults(
        Array.isArray(msg.input) ? msg.input : [],
        lastToolCalls,
      );
      const sysMsg = msg.instructions ? [{ role: 'system', content: msg.instructions }] : [];
      const fullMessages = [...sysMsg, ...itemsToMessages(fixedInput, this.reasoning.asMap())];
      if (!fullMessages.some((m) => m.role === 'user' || m.role === 'tool')) {
        fullMessages.push({ role: 'user', content: 'Hello' });
      }

      const chatReq: ChatRequest = {
        model: this.resolveModel(msg.model),
        messages: fullMessages,
      };
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

      streamDeepSeek(chatReq, respId, send, { apiKey: this.opts.apiKey, agent: this.agent }, this.reasoning)
        .then(({ outputItems }) => {
          lastToolCalls = outputItems.filter(
            (o) => (o as ResponsesItem).type === 'function_call',
          ) as ResponsesItem[];
        })
        .catch((e) => {
          this.log('error', 'ws', `DeepSeek 调用失败：${(e as Error).message}`);
          send('error', { error: { message: (e as Error).message, type: 'server_error' } });
        });
    });

    ws.on('error', (e) => this.log('error', 'ws', `WebSocket 错误：${e.message}`));
    ws.on('close', (code) => this.log('info', 'ws', `WebSocket 关闭 code=${code}`));
  }

  private log(level: ProxyLogEntry['level'], source: ProxyLogEntry['source'], message: string): void {
    const entry: ProxyLogEntry = { ts: Date.now(), level, source, message };
    this.emit('log', entry);
  }
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = REDACT_HEADERS.has(k.toLowerCase()) ? '***REDACTED***' : v;
  }
  return out;
}
