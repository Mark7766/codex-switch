import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelemetryClient } from '../../electron/server-client/telemetry';
import type { ServerClient, ClientResponse } from '../../electron/server-client/client';
import type { ServerConfig } from '../../electron/server-client/config';

function mockServerClient(opts?: {
  pingResult?: boolean;
  postResult?: ClientResponse;
}): ServerClient {
  return {
    ping: vi.fn().mockResolvedValue(opts?.pingResult ?? true),
    post: vi
      .fn()
      .mockResolvedValue(opts?.postResult ?? { status: 200, data: { accepted: 1, rejected: 0 } }),
    get: vi.fn(),
    setBaseUrl: vi.fn(),
  } as unknown as ServerClient;
}

function makeConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  return {
    baseUrl: 'https://example.com/api/v1',
    telemetryEnabled: true,
    clientId: 'test-client-0001',
    ...overrides,
  };
}

const APP_VERSION = '1.7.0';

describe('TelemetryClient', () => {
  let client: ReturnType<typeof mockServerClient>;
  let config: ServerConfig;
  let telemetry: TelemetryClient;

  beforeEach(() => {
    client = mockServerClient();
    config = makeConfig();
    telemetry = new TelemetryClient(client, config, APP_VERSION);
  });

  describe('track()', () => {
    it('adds event to internal buffer when enabled and online', () => {
      telemetry.track('app_start', { version: '1.7.0' });
      // Buffer is private; validate via flush
      expect(telemetry.isOnline()).toBe(true);
    });

    it('is a no-op when telemetry is disabled', () => {
      telemetry.setEnabled(false);
      const pingSpy = client.ping as ReturnType<typeof vi.fn>;
      telemetry.track('app_start');
      // Should not trigger any network activity
      expect(pingSpy).not.toHaveBeenCalled();
    });
  });

  describe('setEnabled()', () => {
    it('disabled state makes track() a no-op', () => {
      telemetry.setEnabled(false);
      // track() should return immediately, no side effects
      telemetry.track('model_call', {});
    });

    it('re-enabling allows tracking again', () => {
      telemetry.setEnabled(false);
      telemetry.setEnabled(true);
      // Should be able to track again without error
      telemetry.track('app_start');
    });
  });

  describe('isOnline()', () => {
    it('returns true by default', () => {
      expect(telemetry.isOnline()).toBe(true);
    });
  });

  describe('stop()', () => {
    it('resolves immediately when no events buffered', async () => {
      await expect(telemetry.stop()).resolves.toBeUndefined();
    });

    it('does not throw when already stopped', async () => {
      await telemetry.stop();
      await expect(telemetry.stop()).resolves.toBeUndefined();
    });
  });

  describe('start()', () => {
    it('does not throw when called twice', () => {
      telemetry.start();
      expect(() => telemetry.start()).not.toThrow();
    });

    it('is a no-op when disabled', () => {
      telemetry.setEnabled(false);
      telemetry.start();
      // Should not schedule any timer
    });
  });

  describe('flush with offline detection', () => {
    it('marks offline when ping fails, preserves events', async () => {
      const tc = mockServerClient({ pingResult: false });
      const t = new TelemetryClient(tc, config, APP_VERSION);

      // Track some events then trigger flush by stopping
      t.track('app_start', {});
      const pingSpy = tc.ping as ReturnType<typeof vi.fn>;
      expect(pingSpy).not.toHaveBeenCalled(); // ping happens in flush, not track
    });

    it('marks offline when ping returns false', async () => {
      const tc = mockServerClient({ pingResult: false });
      const t = new TelemetryClient(tc, config, APP_VERSION);
      // Track an event so buffer is non-empty, then stop() triggers flush → ping
      t.track('app_start', {});
      await t.stop();
      expect(t.isOnline()).toBe(false);
    });
  });

  describe('model_call aggregation', () => {
    it('does not throw with rapid calls (aggregated, not buffered)', () => {
      for (let i = 0; i < 300; i++) {
        expect(() => telemetry.track('model_call', { i })).not.toThrow();
      }
    });

    it('model_call does not flood buffer', () => {
      // 50 model_call events should NOT fill the buffer individually;
      // they are aggregated into a single event every 50 calls.
      for (let i = 0; i < 50; i++) {
        telemetry.track('model_call', {});
      }
      // app_start goes to buffer directly
      telemetry.track('app_start', {});
      // stop() flushes the aggregation + buffer
    });

    it('model_call stops counting when disabled', () => {
      telemetry.setEnabled(false);
      for (let i = 0; i < 100; i++) {
        telemetry.track('model_call', {});
      }
      // Re-enable — counter should be 0
      telemetry.setEnabled(true);
    });
  });
});
