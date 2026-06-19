/**
 * HTTP route dispatcher — extracted from server.ts (C1 refactoring).
 *
 * Maps incoming HTTP requests to the appropriate handler based on method + path.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import https from 'node:https';
import log from 'electron-log';

export interface HttpRouteDeps {
  actualPort: number;
  apiKey: string;
  /** v1.13.0: upstream API hostname. */
  upstreamBase: string;
  agent: https.Agent;
  handleResponses(req: IncomingMessage, res: ServerResponse): void;
  handleAnthropicMessages?: (req: IncomingMessage, res: ServerResponse) => void;
}

export function routeHttp(req: IncomingMessage, res: ServerResponse, deps: HttpRouteDeps): void {
  const url = new URL(req.url || '/', `http://127.0.0.1:${deps.actualPort}`);

  if (req.method === 'GET' && url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', port: deps.actualPort }));
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/v1')) {
    proxyModels(res, deps.apiKey, deps.upstreamBase, deps.agent);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/responses') {
    deps.handleResponses(req, res);
    return;
  }

  // v1.13.0: Claude Anthropic Messages → Chat Completions
  // Claude Desktop 3P gateway: /v1/messages, Claude Code CLI: /anthropic/v1/messages
  if (
    req.method === 'POST' &&
    (url.pathname === '/v1/messages' || url.pathname === '/anthropic/v1/messages') &&
    deps.handleAnthropicMessages
  ) {
    deps.handleAnthropicMessages(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/responses/compact') {
    // v1.13.0: 不做 compact。返回空 compaction 响应让 Codex 继续正常流程。
    // 与 cc-switch 策略一致：不依赖 Codex 的 /compact（DeepSeek 不支持该端点）。
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ compaction: null }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

function proxyModels(
  res: ServerResponse,
  apiKey: string,
  upstreamBase: string,
  agent: https.Agent,
): void {
  if (!apiKey) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing API key' }));
    return;
  }
  https
    .get(
      {
        hostname: upstreamBase,
        path: '/v1/models',
        agent,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      },
      (dsRes) => {
        res.writeHead(dsRes.statusCode ?? 502, { 'Content-Type': 'application/json' });
        dsRes.pipe(res);
      },
    )
    .on('error', (e) => {
      log.error('[http] 获取模型列表失败：', e.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Upstream unreachable' }));
    });
}
