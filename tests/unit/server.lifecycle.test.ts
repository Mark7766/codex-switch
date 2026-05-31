import { describe, it, expect } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { DeepSeekProxy, type ProxyErrorInfo } from '../../electron/proxy/server';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const a = srv.address();
      const p = typeof a === 'object' && a ? a.port : 0;
      srv.close(() => resolve(p));
    });
  });
}

describe('DeepSeekProxy lifecycle (§7)', () => {
  it('serializes concurrent start() into a single listen', async () => {
    const proxy = new DeepSeekProxy({ apiKey: '', port: 0, modelMapping: {} });
    const ports = await Promise.all([
      proxy.start(),
      proxy.start(),
      proxy.start(),
      proxy.start(),
      proxy.start(),
    ]);
    // 所有调用应返回同一个端口（首次成功后续即直接 resolve）
    const unique = new Set(ports);
    expect(unique.size).toBe(1);
    expect(proxy.getStatus()).toBe('running');
    await proxy.stop();
    expect(proxy.getStatus()).toBe('stopped');
  });

  it('emits port-conflict error when port is taken (no auto +1)', async () => {
    // 占用一个真实端口
    const blocker = http.createServer();
    const port = await freePort();
    await new Promise<void>((r) => blocker.listen(port, '127.0.0.1', r));

    try {
      const proxy = new DeepSeekProxy({ apiKey: '', port, modelMapping: {} });
      const errs: ProxyErrorInfo[] = [];
      proxy.on('proxy-error', (e: ProxyErrorInfo) => errs.push(e));

      let threw = false;
      try {
        await proxy.start();
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
      expect(errs.length).toBeGreaterThan(0);
      expect(errs[0]!.kind).toBe('port-conflict');
      expect(errs[0]!.port).toBe(port);
      expect(errs[0]!.recoverable).toBe(false);
      // 关键：actualPort 不应回落到 +1 的端口
      expect(proxy.getPort()).toBe(port);
      expect(proxy.getStatus()).not.toBe('running');
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });

  it('stop() resets port to options port; restart picks new port from options', async () => {
    const proxy = new DeepSeekProxy({ apiKey: '', port: 0, modelMapping: {} });
    const p1 = await proxy.start();
    expect(p1).toBeGreaterThan(0);
    await proxy.stop();
    expect(proxy.getStatus()).toBe('stopped');
    // 改 port 后再启动 → 走新的 listen
    proxy.updateOptions({ port: 0 });
    const p2 = await proxy.start();
    expect(p2).toBeGreaterThan(0);
    expect(proxy.getStatus()).toBe('running');
    await proxy.stop();
  });

  it('consumeLifetimeDelta returns 0 when no traffic', async () => {
    const proxy = new DeepSeekProxy({ apiKey: '', port: 0, modelMapping: {} });
    await proxy.start();
    const d = proxy.consumeLifetimeDelta();
    expect(d.requestsDelta).toBe(0);
    // 第二次调用应再次 0（已被消费）
    const d2 = proxy.consumeLifetimeDelta();
    expect(d2.requestsDelta).toBe(0);
    await proxy.stop();
  });

  it('stop() while idle is fast and idempotent', async () => {
    const proxy = new DeepSeekProxy({ apiKey: '', port: 0, modelMapping: {} });
    await proxy.start();
    const t0 = Date.now();
    await proxy.stop();
    await proxy.stop();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(2500);
  });
});
