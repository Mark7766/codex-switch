/**
 * Unit tests for PluginManager — v1.10.0.
 *
 * Coverage targets (Design §8.1):
 *  - getPackInfo(): success / timeout / non-200
 *  - downloadPack(): 302 redirect / stream success / COS unreachable / stall / cancel
 *  - getInstallCommand(): macOS / Windows
 *  - cancelDownload(): no-op when idle
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ── mock electron ──────────────────────────────────────────────────────────
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((key: string) => {
      if (key === 'downloads') return path.join(os.tmpdir(), 'mock-downloads');
      return path.join(os.tmpdir(), 'mock-data');
    }),
  },
}));

// ── mock http/https — controlled by each test via mockRequestSetup ─────────
type RequestCallback = (res: FakeIncomingMessage) => void;
type RequestOpts = {
  hostname: string;
  port: number;
  path: string;
  timeout: number;
  rejectUnauthorized?: boolean;
  method?: string;
  headers?: Record<string, string>;
};

let mockGetImpl: ((opts: RequestOpts, cb: RequestCallback) => FakeClientRequest) | null = null;

class FakeClientRequest extends EventEmitter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  destroy(_err?: any): void {}
  abort(): void {}
}

class FakeIncomingMessage extends EventEmitter {
  statusCode: number;
  headers: Record<string, string | undefined>;
  private aborted = false;

  constructor(statusCode: number, headers: Record<string, string | undefined> = {}) {
    super();
    this.statusCode = statusCode;
    this.headers = headers;
  }

  feed(chunk: string | Buffer): void {
    if (this.aborted) return;
    this.emit('data', typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  finish(): void {
    if (this.aborted) return;
    this.emit('end');
  }

  resume(): void {
    /* no-op in mock */
  }

  /** Real IncomingMessage extends Readable — provide pipe for streamDownload */
  pipe(dest: Writable): Writable {
    this.on('data', (chunk: Buffer) => dest.write(chunk));
    this.on('end', () => dest.end());
    return dest;
  }
}

// ── http/https mocking via vi.hoisted ────────────────────────────────────
// All mocking infrastructure lives inside vi.hoisted so it's available
// when vitest hoists the vi.mock calls before any imports.

const { mockGetFn } = vi.hoisted(() => {
  const fn = vi.fn((opts: RequestOpts, cb: RequestCallback): FakeClientRequest => {
    // delegate to mockGetImpl at call time (set by beforeEach)
    if (mockGetImpl) return mockGetImpl(opts, cb);
    const req = new FakeClientRequest();
    setImmediate(() => req.emit('error', new Error('ECONNREFUSED')));
    return req;
  });
  return { mockGetFn: fn };
});

vi.mock('node:http', () => ({
  default: { get: mockGetFn },
  get: mockGetFn,
}));
vi.mock('node:https', () => ({
  default: { get: mockGetFn },
  get: mockGetFn,
}));

// Override fs.WriteStream for download tests (we capture writes in-memory)
const mockWriteStream = {
  written: Buffer.alloc(0),
  error: null as Error | null,
};
vi.spyOn(fs, 'createWriteStream').mockImplementation((_p: unknown, _opts?: unknown) => {
  mockWriteStream.written = Buffer.alloc(0);
  const ws = new Writable({
    write(chunk: Buffer, _enc, cb) {
      mockWriteStream.written = Buffer.concat([mockWriteStream.written, chunk]);
      cb();
    },
  });
  // fs.WriteStream has .close() — add to our Writable mock
  (ws as Record<string, unknown>).close = vi.fn();
  // Don't force finish/error — let pipe() → end() → finish flow naturally.
  // But handle the error case: if mockWriteStream.error is set before
  // the stream is piped, emit it on next tick.
  if (mockWriteStream.error) {
    setImmediate(() => ws.emit('error', mockWriteStream.error));
  }
  return ws as unknown as fs.WriteStream;
});
vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

// ── helpers ────────────────────────────────────────────────────────────────

const PACK_INFO_JSON = JSON.stringify({
  code: 0,
  data: {
    version: '1.0.0',
    filename: 'codex-offline-pack.tar.gz',
    size: 37748736,
    size_mb: 36,
    plugin_count: 173,
    description: '173 个精选插件',
    updated_at: '2026-06-14',
    download_url: '/api/v1/plugins/pack/download',
  },
});

const SERVER_URL = 'http://test.example.com/api/v1';

import { PluginManager } from '../../electron/plugins/index';

describe('PluginManager', () => {
  let pm: PluginManager;

  beforeEach(() => {
    pm = new PluginManager(SERVER_URL);
    mockGetImpl = null;
    mockWriteStream.written = Buffer.alloc(0);
    mockWriteStream.error = null;
  });

  afterEach(() => {
    mockGetImpl = null;
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getPackInfo
  // ══════════════════════════════════════════════════════════════════════════

  describe('getPackInfo', () => {
    it('should parse successful response', async () => {
      mockGetImpl = (_opts, cb) => {
        const res = new FakeIncomingMessage(200, { 'content-type': 'application/json' });
        setImmediate(() => {
          cb(res);
          res.feed(PACK_INFO_JSON);
          res.finish();
        });
        return new FakeClientRequest();
      };
      const info = await pm.getPackInfo();
      expect(info.version).toBe('1.0.0');
      expect(info.plugin_count).toBe(173);
      expect(info.size).toBe(37748736);
    });

    it('should reject on timeout', async () => {
      mockGetImpl = (_opts, _cb) => {
        const req = new FakeClientRequest();
        setImmediate(() => req.emit('timeout'));
        return req;
      };
      await expect(pm.getPackInfo()).rejects.toThrow(/超时/);
    });

    it('should reject on non-zero server code', async () => {
      mockGetImpl = (_opts, cb) => {
        const res = new FakeIncomingMessage(200);
        setImmediate(() => {
          cb(res);
          res.feed(JSON.stringify({ code: 1, data: null }));
          res.finish();
        });
        return new FakeClientRequest();
      };
      await expect(pm.getPackInfo()).rejects.toThrow(/Server error/);
    });

    it('should reject on invalid JSON', async () => {
      mockGetImpl = (_opts, cb) => {
        const res = new FakeIncomingMessage(200);
        setImmediate(() => {
          cb(res);
          res.feed('not json');
          res.finish();
        });
        return new FakeClientRequest();
      };
      await expect(pm.getPackInfo()).rejects.toThrow(/Failed to parse/);
    });

    it('should reject on network error', async () => {
      mockGetImpl = (_opts, _cb) => {
        const req = new FakeClientRequest();
        setImmediate(() => req.emit('error', new Error('ENOTFOUND')));
        return req;
      };
      await expect(pm.getPackInfo()).rejects.toThrow(/ENOTFOUND/);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getInstallCommand
  // ══════════════════════════════════════════════════════════════════════════

  describe('getInstallCommand', () => {
    it('should embed macOS path in command', () => {
      const cmd = pm.getInstallCommand('/Users/test/Downloads/codex-offline-pack.tar.gz');
      expect(cmd).toContain('你帮安装一下离线插件安装包');
      expect(cmd).toContain('/Users/test/Downloads/codex-offline-pack.tar.gz');
      expect(cmd).toContain('我要把这些插件都加载到codex里');
    });

    it('should handle Windows backslash paths', () => {
      const cmd = pm.getInstallCommand('C:\\Users\\test\\Downloads\\codex-offline-pack.tar.gz');
      expect(cmd).toContain('C:\\Users\\test\\Downloads\\codex-offline-pack.tar.gz');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // cancelDownload — idle
  // ══════════════════════════════════════════════════════════════════════════

  describe('cancelDownload', () => {
    it('should not throw when no download in progress', () => {
      expect(() => pm.cancelDownload()).not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // downloadPack — mock-based (P0 coverage)
  // ══════════════════════════════════════════════════════════════════════════

  describe('downloadPack', () => {
    const fakePackData = Buffer.from('fake-tar-gz-content-36mb-simulated');

    /**
     * Set up a two-step mock:
     *  1. GET /plugins/pack/download → 302 to COS
     *  2. GET COS URL → 200 with fakePackData
     */
    function setup302Success(headers?: Record<string, string | undefined>) {
      mockGetImpl = (opts, cb) => {
        const req = new FakeClientRequest();
        const isCosRequest = opts.hostname === 'cos.example.com';
        setImmediate(() => {
          if (isCosRequest) {
            const res = new FakeIncomingMessage(200, {
              'content-length': String(fakePackData.length),
              ...headers,
            });
            cb(res);
            res.feed(fakePackData);
            res.finish();
          } else {
            const res = new FakeIncomingMessage(302, {
              location: 'https://cos.example.com/files/codex-offline-pack.tar.gz',
            });
            cb(res);
            // 302 has no body — res.resume() in resolveDownloadRedirect handles this
            res.finish();
          }
        });
        return req;
      };
    }

    it('should download via 302 redirect and return file path', async () => {
      setup302Success();
      const onProgress = vi.fn();
      const savePath = path.join(os.tmpdir(), 'test-download.tar.gz');

      const result = await pm.downloadPack(savePath, onProgress);
      expect(result).toBe(savePath);
      expect(mockWriteStream.written.length).toBe(fakePackData.length);
      // Progress should have been called at least once (100% at end)
      expect(onProgress).toHaveBeenCalled();
      const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1]![0]!;
      expect(lastCall.percent).toBe(100);
    });

    it('should reject when COS returns non-200', async () => {
      mockGetImpl = (opts, cb) => {
        const req = new FakeClientRequest();
        const isCosRequest = opts.hostname === 'cos.example.com';
        setImmediate(() => {
          if (isCosRequest) {
            const res = new FakeIncomingMessage(500);
            cb(res);
            res.finish();
          } else {
            const res = new FakeIncomingMessage(302, {
              location: 'https://cos.example.com/files/broken.tar.gz',
            });
            cb(res);
            res.finish();
          }
        });
        return req;
      };
      const savePath = path.join(os.tmpdir(), 'fail-download.tar.gz');
      await expect(pm.downloadPack(savePath, vi.fn())).rejects.toThrow(/下载失败.*500/);
    });

    it('should reject when server redirect request fails', async () => {
      mockGetImpl = (_opts, _cb) => {
        const req = new FakeClientRequest();
        setImmediate(() => req.emit('error', new Error('connect ECONNREFUSED')));
        return req;
      };
      const savePath = path.join(os.tmpdir(), 'no-server.tar.gz');
      await expect(pm.downloadPack(savePath, vi.fn())).rejects.toThrow(/无法连接服务器/);
    });

    it('should reject when server returns non-redirect status', async () => {
      mockGetImpl = (_opts, cb) => {
        const req = new FakeClientRequest();
        setImmediate(() => {
          const res = new FakeIncomingMessage(404);
          cb(res);
          res.finish();
        });
        return req;
      };
      const savePath = path.join(os.tmpdir(), 'not-found.tar.gz');
      await expect(pm.downloadPack(savePath, vi.fn())).rejects.toThrow(/下载通道异常/);
    });

    it('should reject on cancel during download', async () => {
      // Before the request even starts, cancel
      mockGetImpl = (_opts, _cb) => {
        const req = new FakeClientRequest();
        // never resolve — the abort signal fires before we get here in practice,
        // but for the test we trigger it after a tick
        return req;
      };
      const savePath = path.join(os.tmpdir(), 'cancelled.tar.gz');
      // Schedule cancel immediately
      setImmediate(() => pm.cancelDownload());
      await expect(pm.downloadPack(savePath, vi.fn())).rejects.toThrow(/已取消|ECONNREFUSED/);
    });
  });
});
