/**
 * codex-switch-server HTTP 客户端。
 *
 * 封装对 Server 的 HTTP/HTTPS 请求，提供 POST/GET/ping。
 * 不依赖任何第三方 HTTP 库，使用 node:http / node:https 原生模块。
 */
import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

const DEFAULT_TIMEOUT = 10_000;
const PING_TIMEOUT = 3_000;

export interface ClientResponse {
  status: number;
  data: unknown;
}

/** 从 URL 提取 http.request 所需的 hostname / port / protocol */
function parseTarget(rawUrl: string): {
  hostname: string;
  port: number;
  path: string;
  isHttps: boolean;
} {
  const u = new URL(rawUrl);
  return {
    hostname: u.hostname,
    port: u.port ? parseInt(u.port, 10) : u.protocol === 'https:' ? 443 : 80,
    path: u.pathname + u.search,
    isHttps: u.protocol === 'https:',
  };
}

export class ServerClient {
  private baseUrl: string;
  private agent: https.Agent;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.agent = new https.Agent({
      keepAlive: true,
      maxSockets: 2,
      rejectUnauthorized: true,
    });
  }

  /** 更新 baseUrl（用户切换服务器地址时调用）。 */
  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/$/, '');
  }

  /** POST JSON 请求。失败抛出。 */
  async post(path: string, body: unknown, timeoutMs = DEFAULT_TIMEOUT): Promise<ClientResponse> {
    const url = this.buildUrl(path);
    const bodyStr = JSON.stringify(body);
    const { hostname, port, path: reqPath, isHttps } = parseTarget(url);

    return new Promise((resolve, reject) => {
      const req = (isHttps ? https : http).request(
        {
          method: 'POST',
          hostname,
          port,
          path: reqPath,
          agent: isHttps ? this.agent : undefined,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr),
          },
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString();
            let data: unknown = raw;
            try {
              data = JSON.parse(raw);
            } catch {
              /* keep raw string */
            }
            resolve({ status: res.statusCode ?? 0, data });
          });
        },
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`POST ${path} timed out after ${timeoutMs}ms`));
      });
      req.write(bodyStr);
      req.end();
    });
  }

  /** GET 请求。失败抛出。 */
  async get(path: string, timeoutMs = DEFAULT_TIMEOUT): Promise<ClientResponse> {
    const url = this.buildUrl(path);
    const { hostname, port, path: reqPath, isHttps } = parseTarget(url);

    return new Promise((resolve, reject) => {
      const req = (isHttps ? https : http).request(
        {
          method: 'GET',
          hostname,
          port,
          path: reqPath,
          agent: isHttps ? this.agent : undefined,
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString();
            let data: unknown = raw;
            try {
              data = JSON.parse(raw);
            } catch {
              /* keep raw string */
            }
            resolve({ status: res.statusCode ?? 0, data });
          });
        },
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`GET ${path} timed out after ${timeoutMs}ms`));
      });
      req.end();
    });
  }

  /** 检查服务器连通性：HEAD 请求，3s 超时。 */
  async ping(timeoutMs = PING_TIMEOUT): Promise<boolean> {
    try {
      const url = this.buildUrl('/');
      const { hostname, port, path, isHttps } = parseTarget(url);

      let settled = false;
      return new Promise((resolve) => {
        const done = (ok: boolean): void => {
          if (settled) return;
          settled = true;
          resolve(ok);
        };

        const req = (isHttps ? https : http).request(
          {
            method: 'HEAD',
            hostname,
            port,
            path,
            timeout: timeoutMs,
          },
          (res) => {
            const code = res.statusCode ?? 0;
            res.resume();
            done(code >= 200 && code < 500);
          },
        );
        req.on('error', () => done(false));
        req.on('timeout', () => {
          req.destroy();
          done(false);
        });
        req.end();
      });
    } catch {
      return false;
    }
  }

  private buildUrl(path: string): string {
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${p}`;
  }
}
