/**
 * HTTP routes tests — simple routing logic, no network dependencies.
 */
import { describe, it, expect, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { routeHttp } from '../../electron/proxy/http-routes';

function mockReq(method: string, pathname: string): IncomingMessage {
  return {
    method,
    url: pathname,
    headers: {},
    on: vi.fn(),
    setTimeout: vi.fn(),
  } as unknown as IncomingMessage;
}

function mockRes(): ServerResponse & { body: string; status: number } {
  const res = {
    status: 200,
    body: '',
    writeHead: vi.fn(function (this: typeof res, s: number) {
      this.status = s;
      return this;
    }),
    end: vi.fn(function (this: typeof res, data?: string) {
      if (data) this.body = data;
    }),
  };
  return res as unknown as ServerResponse & { body: string; status: number };
}

const deps = {
  actualPort: 11435,
  apiKey: '',
  agent: {} as never,
  handleResponses: vi.fn(),
  handleCompactHttp: vi.fn(),
};

describe('routeHttp', () => {
  it('returns 200 for /healthz', () => {
    const res = mockRes();
    routeHttp(mockReq('GET', '/healthz'), res as unknown as ServerResponse, deps);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok', port: 11435 });
  });

  it('returns 401 for /v1/models without api key', () => {
    const res = mockRes();
    routeHttp(mockReq('GET', '/v1/models'), res as unknown as ServerResponse, deps);
    expect(res.status).toBe(401);
  });

  it('routes /v1/responses to handleResponses', () => {
    const res = mockRes();
    routeHttp(mockReq('POST', '/v1/responses'), res as unknown as ServerResponse, deps);
    expect(deps.handleResponses).toHaveBeenCalled();
  });

  it('routes /v1/responses/compact to handleCompactHttp', () => {
    const res = mockRes();
    routeHttp(mockReq('POST', '/v1/responses/compact'), res as unknown as ServerResponse, deps);
    expect(deps.handleCompactHttp).toHaveBeenCalled();
  });

  it('returns 404 for unknown paths', () => {
    const res = mockRes();
    routeHttp(mockReq('GET', '/unknown'), res as unknown as ServerResponse, deps);
    expect(res.status).toBe(404);
  });
});
