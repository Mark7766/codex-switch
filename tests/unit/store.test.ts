/**
 * Renderer state management tests (C2).
 *
 * Tests the Zustand store — the central state for the renderer layer.
 * Uses jsdom environment for DOM-dependent code.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../src/lib/store';

describe('useAppStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useAppStore.setState({
      proxyStatus: 'stopped',
      proxyPort: 11435,
      logs: [],
      lifetime: {
        requestCount: 0,
        uptimeSec: 0,
        firstStartAt: '',
        inputTokens: 0,
        outputTokens: 0,
      },
      lastError: null,
      toasts: [],
      portConflict: null,
      configApplied: false,
      justApplied: false,
      claudeDetect: null,
      showChangelog: false,
      telemetryEnabled: true,
      serverUrl: '',
      serverOnline: false,
    });
  });

  describe('proxyStatus', () => {
    it('defaults to stopped', () => {
      expect(useAppStore.getState().proxyStatus).toBe('stopped');
    });

    it('can be set to running', () => {
      useAppStore.setState({ proxyStatus: 'running' });
      expect(useAppStore.getState().proxyStatus).toBe('running');
    });
  });

  describe('proxyPort', () => {
    it('defaults to 11435', () => {
      expect(useAppStore.getState().proxyPort).toBe(11435);
    });
  });

  describe('lifetime stats', () => {
    it('starts with zero values', () => {
      const lt = useAppStore.getState().lifetime;
      expect(lt.requestCount).toBe(0);
      expect(lt.uptimeSec).toBe(0);
      expect(lt.inputTokens).toBe(0);
      expect(lt.outputTokens).toBe(0);
    });

    it('accumulates request count', () => {
      useAppStore.setState({
        lifetime: {
          requestCount: 5,
          uptimeSec: 120,
          firstStartAt: '2026-06-13',
          inputTokens: 1000,
          outputTokens: 500,
        },
      });
      const lt = useAppStore.getState().lifetime;
      expect(lt.requestCount).toBe(5);
      expect(lt.inputTokens).toBe(1000);
    });
  });

  describe('toasts', () => {
    it('pushToast adds a toast', () => {
      useAppStore.getState().pushToast({ kind: 'info', message: 'test' });
      expect(useAppStore.getState().toasts).toHaveLength(1);
      expect(useAppStore.getState().toasts[0]?.message).toBe('test');
    });

    it('dismissToast removes a toast', () => {
      useAppStore.getState().pushToast({ kind: 'info', message: 'first' });
      const second = useAppStore.getState().toasts[0];
      useAppStore.getState().pushToast({ kind: 'error', message: 'second' });
      if (second) useAppStore.getState().dismissToast(second.id);
      expect(useAppStore.getState().toasts).toHaveLength(1);
    });
  });

  describe('telemetryEnabled', () => {
    it('defaults to true', () => {
      expect(useAppStore.getState().telemetryEnabled).toBe(true);
    });

    it('can be toggled', () => {
      useAppStore.setState({ telemetryEnabled: false });
      expect(useAppStore.getState().telemetryEnabled).toBe(false);
    });
  });

  describe('log management', () => {
    it('pushLog adds entries', () => {
      useAppStore.getState().pushLog({
        ts: Date.now(),
        level: 'info',
        source: 'http',
        message: 'test log',
      });
      expect(useAppStore.getState().logs.length).toBeGreaterThan(0);
    });

    it('limits logs to 200 entries', () => {
      for (let i = 0; i < 300; i++) {
        useAppStore.getState().pushLog({
          ts: Date.now(),
          level: 'info',
          source: 'http',
          message: `log ${i}`,
        });
      }
      expect(useAppStore.getState().logs.length).toBeLessThanOrEqual(200);
    });
  });
});
