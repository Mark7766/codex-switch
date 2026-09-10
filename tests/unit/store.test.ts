/**
 * 渲染层状态（Zustand）测试。
 *
 * v3.0.0 重写：原文件在测一个**已经过时的 API** —— 它断言 `proxyStatus` / `proxyPort` /
 * `lifetime` / `logs`，而这些字段要么已随本地代理删除，要么本来就不存在于 store 里
 * （它断言的 `proxyPort` 与真实字段名 `port` 不一致，只因 beforeEach 先 setState 才「通过」，
 * 是典型的假绿）。现在只覆盖真正留下的部分：页面路由与 toast。
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../src/lib/store';

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState({ page: 'setup', toasts: [] });
  });

  describe('page routing', () => {
    it('defaults to setup (first launch runs the wizard)', () => {
      expect(useAppStore.getState().page).toBe('setup');
    });

    it('can navigate to settings / dashboard', () => {
      // v3.0.0 删了 'logs'、'help' 与 'plugins' —— 这里只能列出当前存在的页面
      for (const page of ['settings', 'dashboard'] as const) {
        useAppStore.getState().setPage(page);
        expect(useAppStore.getState().page).toBe(page);
      }
    });
  });

  describe('toasts', () => {
    it('pushToast adds a toast', () => {
      useAppStore.getState().pushToast({ kind: 'info', message: 'test' });
      expect(useAppStore.getState().toasts).toHaveLength(1);
      expect(useAppStore.getState().toasts[0]?.message).toBe('test');
    });

    it('dismissToast removes the right toast', () => {
      useAppStore.getState().pushToast({ kind: 'info', message: 'first' });
      const first = useAppStore.getState().toasts[0];
      useAppStore.getState().pushToast({ kind: 'error', message: 'second' });
      if (first) useAppStore.getState().dismissToast(first.id);
      const remaining = useAppStore.getState().toasts;
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.message).toBe('second');
    });
  });

  describe('v3.0.0 代理字段缺席护栏', () => {
    // 防半途回退：这些字段随本地代理删除，不该再出现在 store 上
    it('不再暴露 proxy / lifetime / logs 相关状态', () => {
      const state = useAppStore.getState() as unknown as Record<string, unknown>;
      for (const gone of [
        'proxyStatus',
        'setProxyStatus',
        'port',
        'setPort',
        'logs',
        'pushLog',
        'lifetime',
        'lastError',
        'portConflict',
      ]) {
        expect(state[gone], gone).toBeUndefined();
      }
    });
  });
});
