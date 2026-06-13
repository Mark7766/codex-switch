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

  it('stop() forcibly terminates established keep-alive connections', async () => {
    // 复现用户报告的 bug：客户端建立 keep-alive 长连接后调用 stop()，
    // 旧实现 server.close() 不会断开已 ESTABLISHED 的 socket，导致 codex
    // 还能继续在残留连接上收发。修复后这些 socket 必须被立即终止。
    const proxy = new DeepSeekProxy({ apiKey: '', port: 0, modelMapping: {} });
    const port = await proxy.start();

    // 建立一个 keep-alive 连接并完成一次 healthz 请求；socket 不主动关闭。
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/healthz', method: 'GET', agent },
        (res) => {
          res.resume();
          res.on('end', () => resolve());
        },
      );
      req.on('error', reject);
      req.end();
    });

    const t0 = Date.now();
    await proxy.stop();
    const elapsed = Date.now() - t0;
    // 应快速返回（远小于 STOP_TIMEOUT 3s），证明没有挂在 close() 等 keep-alive。
    expect(elapsed).toBeLessThan(1500);
    expect(proxy.getStatus()).toBe('stopped');

    // 再用同一 agent 发请求应失败（端口未监听 + socket 已 destroy）。
    const failed = await new Promise<boolean>((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/healthz', method: 'GET', agent, timeout: 800 },
        (res) => {
          res.resume();
          res.on('end', () => resolve(false));
        },
      );
      req.on('error', () => resolve(true));
      req.on('timeout', () => {
        req.destroy();
        resolve(true);
      });
      req.end();
    });
    expect(failed).toBe(true);
    agent.destroy();
  });
});

describe('DeepSeekProxy start stop roundtrip', () => {
  it('can restart after stop', async () => {
    const p = new DeepSeekProxy({ apiKey: '', port: 0, modelMapping: {} });
    const port1 = await p.start();
    expect(p.getStatus()).toBe('running');
    await p.stop();
    expect(p.getStatus()).toBe('stopped');
    const port2 = await p.start();
    expect(p.getStatus()).toBe('running');
    await p.stop();
    expect(port1).toBeGreaterThan(0);
    expect(port2).toBeGreaterThan(0);
  });
});
