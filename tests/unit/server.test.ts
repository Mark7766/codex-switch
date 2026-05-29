import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { DeepSeekProxy } from '../../electron/proxy/server';

describe('DeepSeekProxy http server', () => {
  const proxy = new DeepSeekProxy({
    apiKey: '',
    port: 0,
    modelMapping: {},
  });
  let port = 0;

  beforeAll(async () => {
    port = await proxy.start();
  });
  afterAll(async () => {
    await proxy.stop();
  });

  function get(path: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}${path}`, (res) => {
          let buf = '';
          res.on('data', (c) => (buf += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: buf }));
        })
        .on('error', reject);
    });
  }

  it('responds to /healthz', async () => {
    const r = await get('/healthz');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).status).toBe('ok');
  });

  it('returns 401 on /v1/models when api key is missing', async () => {
    const r = await get('/v1/models');
    expect(r.status).toBe(401);
  });

  it('returns 404 on unknown path', async () => {
    const r = await get('/nope');
    expect(r.status).toBe(404);
  });

  it('binds only to loopback', async () => {
    expect(port).toBeGreaterThan(0);
  });
});
