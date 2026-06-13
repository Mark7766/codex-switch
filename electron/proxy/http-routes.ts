/**
 * HTTP route dispatcher — extracted from server.ts (C1 refactoring).
 *
 * Maps incoming HTTP requests to the appropriate handler based on method + path.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import https from 'node:https';
import log from 'electron-log';

const DEEPSEEK_BASE = 'api.deepseek.com';

export interface HttpRouteDeps {
  actualPort: number;
  apiKey: string;
  agent: https.Agent;
  handleResponses(req: IncomingMessage, res: ServerResponse): void;
  handleCompactHttp(req: IncomingMessage, res: ServerResponse): void;
}

export function routeHttp(req: IncomingMessage, res: ServerResponse, deps: HttpRouteDeps): void {
  const url = new URL(req.url || '/', `http://127.0.0.1:${deps.actualPort}`);

  if (req.method === 'GET' && url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', port: deps.actualPort }));
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/v1')) {
    proxyModels(res, deps.apiKey, deps.agent);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/responses') {
    deps.handleResponses(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/responses/compact') {
    deps.handleCompactHttp(req, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

function proxyModels(res: ServerResponse, apiKey: string, agent: https.Agent): void {
  if (!apiKey) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing DeepSeek API key' }));
    return;
  }
  https
    .get(
      {
        hostname: DEEPSEEK_BASE,
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
