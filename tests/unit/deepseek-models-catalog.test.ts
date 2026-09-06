import { describe, it, expect } from 'vitest';
import { readModelsJsonAsset } from '../../electron/codex/models-catalog';

interface CatalogModel {
  slug: string;
  input_modalities?: string[];
  supports_image_detail_original?: boolean;
}
interface Catalog {
  models: CatalogModel[];
}

/**
 * Codex 通过 model_catalog_json=~/.codex/models.json 判断模型能否收图——
 * 打包资产必须与 DeepSeek 官方 Codex 一键脚本一致，含 deepseek-v4-flash-vision-exp。
 */
describe('deepseek-models.json asset (Codex model catalog)', () => {
  it('ships the official three DeepSeek Codex models in order', async () => {
    const { models } = JSON.parse(await readModelsJsonAsset()) as Catalog;
    expect(models.map((m) => m.slug)).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-v4-flash-vision-exp',
    ]);
  });

  it('declares vision-exp image-capable while text models stay text-only', async () => {
    const { models } = JSON.parse(await readModelsJsonAsset()) as Catalog;
    const vis = models.find((m) => m.slug === 'deepseek-v4-flash-vision-exp');
    expect(vis?.input_modalities).toContain('image');
    expect(vis?.supports_image_detail_original).toBe(true);

    for (const m of models) {
      if (m.slug.includes('vision')) continue;
      expect(m.input_modalities).not.toContain('image');
      expect(m.supports_image_detail_original).toBe(false);
    }
  });
});
