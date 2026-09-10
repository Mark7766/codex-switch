/**
 * 迁移标志的键级合并（v3.0.0 缺陷回归）。
 *
 * 缺陷原状：三条迁移各自写 `setPreferences({ migrations: { <key>: true } })`，而
 * `setPreferences` 是**浅合并** —— patch 里的 `migrations` 会整体替换旧对象，把另外两条
 * 迁移的 flag 一并抹掉。于是三者互为对方的「未执行」：**每次启动都会重跑全部迁移**，
 * 连带每次都重写 Claude 配置（并因此堆积了数百份 `.bak`）。
 *
 * 这组测试刻意用**真实的 store 模块**（只把 electron-store 换成内存实现）——此前没有任何
 * 测试碰过主进程的 store，正是这个缺陷能长期潜伏的原因。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron-store', () => {
  class MemoryStore {
    private data: Record<string, unknown>;
    constructor(opts: { defaults?: Record<string, unknown> } = {}) {
      this.data = JSON.parse(JSON.stringify(opts.defaults ?? {}));
    }
    get store(): Record<string, unknown> {
      return this.data;
    }
    set store(v: Record<string, unknown>) {
      this.data = v;
    }
    get(key: string, fallback?: unknown): unknown {
      return this.data[key] ?? fallback;
    }
    set(key: string, value: unknown): void {
      this.data[key] = value;
    }
    clear(): void {
      this.data = {};
    }
  }
  return { default: MemoryStore };
});

import { getPreferences, setMigrationFlag } from '../../electron/config/store';

describe('setMigrationFlag', () => {
  it('写入一个 flag 不会抹掉其它 flag（缺陷回归）', () => {
    setMigrationFlag('v130_claude');
    expect(getPreferences().migrations.v130_claude).toBe(true);

    // 旧实现走到这里会把 v130_claude 抹掉
    setMigrationFlag('v300_direct');

    const m = getPreferences().migrations;
    expect(m.v300_direct).toBe(true);
    expect(m.v130_claude, 'v130_claude 被覆盖 —— 这正是每次启动重跑全部迁移的根因').toBe(true);
  });

  it('三条迁移依次执行后三个 flag 同时为真', () => {
    setMigrationFlag('v130_claude');
    setMigrationFlag('v160_claudeDesktopDirect');
    setMigrationFlag('v300_direct');

    const m = getPreferences().migrations;
    expect(m.v130_claude).toBe(true);
    expect(m.v160_claudeDesktopDirect).toBe(true);
    expect(m.v300_direct).toBe(true);
  });

  it('重复标记同一个 flag 是幂等的', () => {
    setMigrationFlag('v160_claudeDesktopDirect');
    setMigrationFlag('v160_claudeDesktopDirect');
    const m = getPreferences().migrations;
    expect(m.v160_claudeDesktopDirect).toBe(true);
    expect(Object.keys(m).length).toBeGreaterThanOrEqual(1);
  });

  it('DEFAULTS 声明了 MigrationFlags 的全部四个键（新装用户也不能缺）', () => {
    // 缺键会让守卫读到 undefined → 迁移每次启动都重跑
    const m = getPreferences().migrations;
    for (const key of [
      'v130_claude',
      'v160_claudeDesktopDirect',
      'v200_deepseekDirect',
      'v300_direct',
    ]) {
      expect(m, `${key} 未在 DEFAULTS 中声明`).toHaveProperty(key);
    }
  });
});
