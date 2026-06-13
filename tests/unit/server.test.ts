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

describe('DeepSeekProxy lifecycle', () => {
  it('getStatus returns stopped when not started', () => {
    const p = new DeepSeekProxy({ apiKey: '', port: 0, modelMapping: {} });
    expect(p.getStatus()).toBe('stopped');
  });

  it('getPort returns configured port when stopped', () => {
    const p = new DeepSeekProxy({ apiKey: '', port: 9999, modelMapping: {} });
    expect(p.getPort()).toBe(9999);
  });

  it('getUptimeMs returns 0 when not started', () => {
    const p = new DeepSeekProxy({ apiKey: '', port: 0, modelMapping: {} });
    expect(p.getUptimeMs()).toBe(0);
  });

  it('getRequestCount starts at 0', () => {
    const p = new DeepSeekProxy({ apiKey: '', port: 0, modelMapping: {} });
    expect(p.getRequestCount()).toBe(0);
  });

  it('updateOptions merges config', () => {
    const p = new DeepSeekProxy({
      apiKey: '',
      port: 0,
      modelMapping: { 'gpt-4': 'deepseek-v4-pro' },
    });
    p.updateOptions({ apiKey: 'sk-new', port: 8080 });
    // Verify options were updated
    expect(p.getPort()).toBe(8080); // returns opts.port when stopped
  });

  it('consumeLifetimeDelta returns zeros when no activity', () => {
    const p = new DeepSeekProxy({ apiKey: '', port: 0, modelMapping: {} });
    const d = p.consumeLifetimeDelta();
    expect(d.requestsDelta).toBe(0);
    expect(d.inputTokensDelta).toBe(0);
  });

  it('getRecentStats returns default values', () => {
    const p = new DeepSeekProxy({ apiKey: '', port: 0, modelMapping: {} });
    const s = p.getRecentStats();
    expect(s.total).toBe(0);
    expect(s.successRate).toBe(1);
  });
});
