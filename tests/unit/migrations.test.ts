import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TMP_ROOT = path.join(os.tmpdir(), 'codex-switch-migrations-test');

vi.mock('../../electron/config/store', () => ({
  getPreferences: vi.fn(),
  setPreferences: vi.fn(),
  // 与真实实现同语义的键级合并（真实实现由 tests/unit/migration-flag.test.ts 覆盖）
  setMigrationFlag: (key: string) => {
    const cur = (getPreferences as ReturnType<typeof vi.fn>)() as
      | { migrations?: Record<string, boolean> }
      | undefined;
    (setPreferences as ReturnType<typeof vi.fn>)({
      migrations: { ...(cur?.migrations ?? {}), [key]: true },
    });
  },
}));
vi.mock('../../electron/config/secrets', () => ({
  getKey: vi.fn(),
}));
vi.mock('../../electron/codex/writer', () => ({
  writeCodexConfig: vi.fn(),
}));
vi.mock('../../electron/codex/paths', () => ({
  codexDir: () => TMP_ROOT,
  configTomlPath: () => path.join(TMP_ROOT, 'config.toml'),
  authJsonPath: () => path.join(TMP_ROOT, 'auth.json'),
  backupPath: (p: string) => `${p}.bak.test`,
}));

import { getPreferences, setPreferences } from '../../electron/config/store';
import { getKey } from '../../electron/config/secrets';
import { writeCodexConfig } from '../../electron/codex/writer';
import { runV300DirectMigration } from '../../electron/config/migrations';

const getPrefs = getPreferences as ReturnType<typeof vi.fn>;
const setPrefs = setPreferences as ReturnType<typeof vi.fn>;
const getKeyMock = getKey as ReturnType<typeof vi.fn>;
const writeCfg = writeCodexConfig as ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.clearAllMocks();
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
  await fs.mkdir(TMP_ROOT, { recursive: true });
});

afterEach(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
});

/**
 * v3.0.0：本地代理已删除，而 **GLM 在 v3.0.0 之前正是走本地代理的**。
 * 所以这条迁移最关键的作用是把存量 GLM 用户的 config.toml 从 127.0.0.1 改成 GLM 直连——
 * 不迁移他们的 Codex 会因为连不上已消失的端口而完全不可用。
 */
describe('runV300DirectMigration', () => {
  it('returns false and rewrites nothing when flag already set', async () => {
    getPrefs.mockReturnValue({
      migrations: { v300_direct: true },
      provider: 'deepseek',
      defaultModel: 'deepseek-flash',
    });
    expect(await runV300DirectMigration()).toBe(false);
    expect(writeCfg).not.toHaveBeenCalled();
  });

  it('rewrites a proxy-based GLM config to the GLM direct template', async () => {
    getPrefs.mockReturnValue({
      migrations: {},
      provider: 'glm',
      defaultModel: 'glm-5.3',
    });
    getKeyMock.mockResolvedValue('glm-key');
    await fs.writeFile(
      path.join(TMP_ROOT, 'config.toml'),
      'model_provider = "custom"\nbase_url = "http://127.0.0.1:11435/v1"\n',
    );

    expect(await runV300DirectMigration()).toBe(true);
    expect(writeCfg).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'glm', model: 'glm-5.3', apiKey: 'glm-key' }),
    );
    expect(setPrefs).toHaveBeenCalledWith({ migrations: { v300_direct: true } });
  });

  it('rewrites a proxy-based deepseek config (covers pre-v2.0.0 upgrades)', async () => {
    getPrefs.mockReturnValue({
      migrations: {},
      provider: 'deepseek',
      defaultModel: 'deepseek-flash',
    });
    getKeyMock.mockResolvedValue('sk-test');
    await fs.writeFile(
      path.join(TMP_ROOT, 'config.toml'),
      'base_url = "http://localhost:11435/v1"\n',
    );

    await runV300DirectMigration();
    expect(writeCfg).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'deepseek', apiKey: 'sk-test' }),
    );
  });

  it('does not rewrite when config.toml is already direct', async () => {
    getPrefs.mockReturnValue({ migrations: {}, provider: 'glm', defaultModel: 'glm-5.3' });
    getKeyMock.mockResolvedValue('glm-key');
    await fs.writeFile(
      path.join(TMP_ROOT, 'config.toml'),
      'model_provider = "ZAI"\nbase_url = "https://open.bigmodel.cn/api/v1"\n',
    );

    expect(await runV300DirectMigration()).toBe(true);
    expect(writeCfg).not.toHaveBeenCalled();
  });

  it('does not rewrite when the key is missing', async () => {
    getPrefs.mockReturnValue({ migrations: {}, provider: 'glm', defaultModel: 'glm-5.3' });
    getKeyMock.mockResolvedValue('');
    await fs.writeFile(path.join(TMP_ROOT, 'config.toml'), 'base_url = "http://127.0.0.1:11435"');

    await runV300DirectMigration();
    expect(writeCfg).not.toHaveBeenCalled();
    // 仍然打上 flag，避免每次启动重试
    expect(setPrefs).toHaveBeenCalledWith({ migrations: { v300_direct: true } });
  });

  it('does not throw when keytar rejects (the v3 regression risk)', async () => {
    getPrefs.mockReturnValue({ migrations: {}, provider: 'glm', defaultModel: 'glm-5.3' });
    getKeyMock.mockRejectedValue(new Error('keytar unavailable'));
    await fs.writeFile(path.join(TMP_ROOT, 'config.toml'), 'base_url = "http://127.0.0.1:11435"');

    await expect(runV300DirectMigration()).resolves.toBe(true);
    expect(writeCfg).not.toHaveBeenCalled();
  });

  it('第二次调用返回 false（迁移只跑一次 —— 缺陷回归）', async () => {
    // 用真实语义的 setMigrationFlag 串起来：第一次跑完后 flag 必须能被守卫读到
    const state: { migrations: Record<string, boolean> } = { migrations: {} };
    getPrefs.mockImplementation(() => ({
      migrations: state.migrations,
      provider: 'glm',
      defaultModel: 'glm-5.3',
    }));
    setPrefs.mockImplementation((patch: { migrations: Record<string, boolean> }) => {
      Object.assign(state, patch);
      return patch;
    });
    getKeyMock.mockResolvedValue('glm-key');

    expect(await runV300DirectMigration()).toBe(true);
    expect(state.migrations.v300_direct).toBe(true);
    // 旧实现会把其它 flag 抹掉，导致守卫永远读不到 → 每次启动重跑
    expect(await runV300DirectMigration()).toBe(false);
  });

  it('标记自己不会抹掉其它迁移的 flag（缺陷回归）', async () => {
    const state: { migrations: Record<string, boolean> } = { migrations: { v130_claude: true } };
    getPrefs.mockImplementation(() => ({
      migrations: state.migrations,
      provider: 'glm',
      defaultModel: 'glm-5.3',
    }));
    setPrefs.mockImplementation((patch: { migrations: Record<string, boolean> }) => {
      Object.assign(state, patch);
      return patch;
    });
    getKeyMock.mockResolvedValue('glm-key');

    await runV300DirectMigration();
    expect(state.migrations.v130_claude, 'v130_claude 被覆盖').toBe(true);
    expect(state.migrations.v300_direct).toBe(true);
  });

  it('handles a persisted agnes provider without throwing', async () => {
    // 用户明确选择「不做任何处理」——但绝不能因为 registry['agnes'] 不存在而崩。
    getPrefs.mockReturnValue({ migrations: {}, provider: 'agnes', defaultModel: 'deepseek-flash' });
    getKeyMock.mockResolvedValue('whatever');

    await expect(runV300DirectMigration()).resolves.toBe(true);
  });
});
