import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readModelsJsonAsset, writeModelsJson } from '../../electron/codex/models-catalog';
import { PROVIDER_LIST } from '../../electron/config/providers';

const TMP_ROOT = path.join(os.tmpdir(), 'codex-switch-models-catalog-test');

// 让 modelsJsonPath() 指向临时目录
vi.mock('../../electron/codex/paths', async () => {
  const actual = await vi.importActual<typeof import('../../electron/codex/paths')>(
    '../../electron/codex/paths',
  );
  return {
    ...actual,
    codexDir: () => TMP_ROOT,
    configTomlPath: () => path.join(TMP_ROOT, 'config.toml'),
    authJsonPath: () => path.join(TMP_ROOT, 'auth.json'),
  };
});

interface CatalogModel {
  slug: string;
  input_modalities?: string[];
  supports_image_detail_original?: boolean;
}

async function readCatalog(asset: string): Promise<CatalogModel[]> {
  return (JSON.parse(await readModelsJsonAsset(asset)) as { models: CatalogModel[] }).models;
}

beforeEach(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
  await fs.mkdir(TMP_ROOT, { recursive: true });
});

afterEach(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
});

/**
 * Codex 通过 model_catalog_json=~/.codex/models.json 判断模型能否收图/元数据。
 * 打包资产必须与各家官方文档一致。
 */
describe('deepseek-models.json asset', () => {
  it('ships exactly the two official DeepSeek Codex models in order', async () => {
    expect((await readCatalog('deepseek-models.json')).map((m) => m.slug)).toEqual([
      'deepseek-flash',
      'deepseek-v4-pro',
    ]);
  });

  it('declares deepseek-flash image-capable while pro stays text-only', async () => {
    const models = await readCatalog('deepseek-models.json');
    const flash = models.find((m) => m.slug === 'deepseek-flash');
    expect(flash?.input_modalities).toContain('image');
    expect(flash?.supports_image_detail_original).toBe(true);

    const pro = models.find((m) => m.slug === 'deepseek-v4-pro');
    expect(pro?.input_modalities).not.toContain('image');
    expect(pro?.supports_image_detail_original).toBe(false);
  });

  it('no longer ships the retired deepseek-v4-flash slugs', async () => {
    for (const m of await readCatalog('deepseek-models.json')) {
      expect(m.slug.startsWith('deepseek-v4-flash')).toBe(false);
    }
  });
});

describe('glm-models.json asset', () => {
  it('ships the three GLM models in priority order', async () => {
    expect((await readCatalog('glm-models.json')).map((m) => m.slug)).toEqual([
      'glm-5.3',
      'glm-5.3-flash',
      'glm-5.2',
    ]);
  });

  it('declares glm-5.3-flash image-capable while the others stay text-only', async () => {
    const models = await readCatalog('glm-models.json');
    const flash = models.find((m) => m.slug === 'glm-5.3-flash');
    expect(flash?.input_modalities).toContain('image');

    const flagship = models.find((m) => m.slug === 'glm-5.3');
    expect(flagship?.input_modalities).not.toContain('image');
  });
});

describe('writeModelsJson — 合并写（v3.0.0）', () => {
  const target = () => path.join(TMP_ROOT, 'models.json');
  const slugsOf = async (): Promise<string[]> =>
    (
      (JSON.parse(await fs.readFile(target(), 'utf8')) as { models: CatalogModel[] }).models ?? []
    ).map((m) => m.slug);

  it('用户没有自加条目时，逐字节照抄资产', async () => {
    await writeModelsJson('deepseek-models.json');
    expect(await fs.readFile(target(), 'utf8')).toBe(
      await readModelsJsonAsset('deepseek-models.json'),
    );
  });

  it('第二次写同一供应商 → 内容相同，跳过', async () => {
    const first = await writeModelsJson('deepseek-models.json');
    expect(first.skipped).toBe(false);
    const second = await writeModelsJson('deepseek-models.json');
    expect(second.skipped).toBe(true);
    expect(second.backup).toBeNull();
  });

  it('切换供应商会替换受管条目（不会两家混杂），且仍可切回', async () => {
    await writeModelsJson('deepseek-models.json');
    await writeModelsJson('glm-models.json');
    // GLM 在写 → 只剩 GLM 的条目
    expect(await slugsOf()).toEqual(['glm-5.3', 'glm-5.3-flash', 'glm-5.2']);

    await writeModelsJson('deepseek-models.json');
    // 切回 DeepSeek → 只剩 DeepSeek 的条目
    expect(await slugsOf()).toEqual(['deepseek-flash', 'deepseek-v4-pro']);
  });

  it('保留用户自己添加的条目', async () => {
    const custom = { slug: 'my-own-model', display_name: 'mine' };
    await fs.writeFile(
      target(),
      JSON.stringify({ models: [{ slug: 'deepseek-flash' }, custom] }, null, 2) + '\n',
      'utf8',
    );

    await writeModelsJson('glm-models.json');

    const models = JSON.parse(await fs.readFile(target(), 'utf8')) as { models: CatalogModel[] };
    expect(models.models.some((m) => m.slug === 'my-own-model')).toBe(true);
    // 受管的 deepseek 条目已被摘掉
    expect(models.models.some((m) => m.slug === 'deepseek-flash')).toBe(false);
  });

  it('现有文件损坏时整体重写而不是崩溃', async () => {
    await fs.writeFile(target(), '!! not json', 'utf8');
    const r = await writeModelsJson('deepseek-models.json');
    expect(r.skipped).toBe(false);
    expect(r.backup).not.toBeNull();
    expect(await slugsOf()).toContain('deepseek-flash');
  });

  it('每个带 catalogAsset 的供应商资产都可读且 slug 唯一', async () => {
    for (const d of PROVIDER_LIST) {
      if (!d.codex.catalogAsset) continue;
      const models = await readCatalog(d.codex.catalogAsset);
      expect(models.length).toBeGreaterThan(0);
      expect(new Set(models.map((m) => m.slug)).size).toBe(models.length);
    }
  });
});
