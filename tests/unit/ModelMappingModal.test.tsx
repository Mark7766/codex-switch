/**
 * ModelMappingModal 单元测试。
 *
 * v3.0.0: 弹窗改为注册表驱动——供应商数据（选项列表、档位、档位默认值、是否含 Haiku）
 * 全部来自 `provider` 描述符（与设置页同源，经 providers:list 下发）。这里用手写的
 * 描述符桩（形状与 electron/config/providers.ts 一致）验证渲染与保存逻辑。
 *
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModelMappingModal } from '../../src/components/ModelMappingModal';

function makeDescriptor(overrides: Partial<ProviderDescriptor> = {}): ProviderDescriptor {
  const base: ProviderDescriptor = {
    id: 'deepseek',
    label: 'DeepSeek',
    codex: {
      providerId: 'deepseek',
      name: 'deepseek',
      baseUrl: 'https://api.deepseek.com/',
      reasoningEffort: 'high',
      bearerTokenInToml: true,
      requiresOpenAiAuth: false,
      contextWindowOverrides: false,
      featureFlags: false,
      models: ['deepseek-flash', 'deepseek-v4-pro'],
      defaultModel: 'deepseek-flash',
      catalogAsset: 'deepseek-models.json',
      retiredPrefixes: ['deepseek-v4-flash'],
    },
    claude: {
      baseUrl: 'https://api.deepseek.com/anthropic',
      models: ['deepseek-v4-pro', 'deepseek-flash'],
      slots: [
        { id: 'claude-opus-4-7', tier: 'opus', label: 'Claude Opus 4.7' },
        { id: 'claude-sonnet-4-6', tier: 'sonnet', label: 'Claude Sonnet 4.6' },
        { id: 'claude-haiku-4-5', tier: 'haiku', label: 'Claude Haiku 4.5' },
      ],
      roleDefaults: { opus: 'deepseek-v4-pro', sonnet: 'deepseek-flash', haiku: 'deepseek-flash' },
      includeHaiku: true,
      acceptedModelPrefixes: ['deepseek'],
    },
    key: {
      account: 'deepseek-api-key',
      fallbackField: 'apiKey',
      minLength: 10,
      placeholder: '新的 sk-...',
      hint: '',
    },
  };
  return { ...base, ...overrides };
}

const CUSTOM_DESCRIPTOR = makeDescriptor({
  id: 'custom',
  label: '自定义',
  codex: {
    ...makeDescriptor().codex,
    baseUrl: 'custom',
    catalogAsset: undefined,
    retiredPrefixes: undefined,
  },
  claude: {
    baseUrl: 'custom',
    models: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    slots: makeDescriptor().claude.slots,
    roleDefaults: {
      opus: 'claude-opus-4-7',
      sonnet: 'claude-sonnet-4-6',
      haiku: 'claude-haiku-4-5',
    },
    includeHaiku: false,
    acceptedModelPrefixes: ['claude-'],
  },
});

function selectValues(el: Element): string[] {
  return Array.from((el as HTMLSelectElement).options).map((o) => o.value);
}

describe('ModelMappingModal', () => {
  it('offers the descriptor models for every Claude slot', () => {
    render(
      <ModelMappingModal
        open
        onClose={vi.fn()}
        descriptor={makeDescriptor()}
        mapping={{}}
        onSave={vi.fn()}
      />,
    );

    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(3);
    for (const sel of selects) {
      const values = selectValues(sel);
      expect(values).toContain('deepseek-v4-pro');
      expect(values).toContain('deepseek-flash');
      expect(values).toContain('__custom__');
    }
  });

  it('preselects the descriptor role defaults per slot when mapping is empty', () => {
    render(
      <ModelMappingModal
        open
        onClose={vi.fn()}
        descriptor={makeDescriptor()}
        mapping={{}}
        onSave={vi.fn()}
      />,
    );

    const [opus, sonnet, haiku] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(opus.value).toBe('deepseek-v4-pro');
    expect(sonnet.value).toBe('deepseek-flash');
    expect(haiku.value).toBe('deepseek-flash');
  });

  it('hides the Haiku slot when the descriptor says includeHaiku=false', () => {
    render(
      <ModelMappingModal
        open
        onClose={vi.fn()}
        descriptor={CUSTOM_DESCRIPTOR}
        mapping={{}}
        onSave={vi.fn()}
      />,
    );
    // 自定义供应商只配 Opus + Sonnet
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
  });

  it('folds persisted retired names instead of showing a custom input', () => {
    // 存量用户存着 deepseek-v4-flash* 时必须折叠为默认模型，否则会被当成自定义值渲染出输入框
    render(
      <ModelMappingModal
        open
        onClose={vi.fn()}
        descriptor={makeDescriptor()}
        mapping={{
          'claude-sonnet-4-6': 'deepseek-v4-flash',
          'claude-haiku-4-5': 'deepseek-v4-flash-vision-exp',
        }}
        onSave={vi.fn()}
      />,
    );

    const [opus, sonnet, haiku] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(opus.value).toBe('deepseek-v4-pro');
    expect(sonnet.value).toBe('deepseek-flash');
    expect(haiku.value).toBe('deepseek-flash');
    expect(screen.queryByPlaceholderText('输入模型名')).toBeNull();
  });

  it('does not fold a deepseek-looking value for the custom provider', () => {
    // custom 供应商未声明折叠规则，手填的 deepseek-* 名应保留为自定义值
    render(
      <ModelMappingModal
        open
        onClose={vi.fn()}
        descriptor={CUSTOM_DESCRIPTOR}
        mapping={{ 'claude-sonnet-4-6': 'deepseek-v4-flash' }}
        onSave={vi.fn()}
      />,
    );

    const sonnet = screen.getAllByRole('combobox')[1] as HTMLSelectElement;
    expect(sonnet.value).toBe('__custom__');
    expect(screen.getByDisplayValue('deepseek-v4-flash')).toBeTruthy();
  });

  it('saves a mapping, filling unmapped slots from role defaults', () => {
    const onSave = vi.fn();
    render(
      <ModelMappingModal
        open
        onClose={vi.fn()}
        descriptor={makeDescriptor()}
        mapping={{}}
        onSave={onSave}
      />,
    );

    // Sonnet 槽位是第 2 个 combobox（slots 顺序：opus, sonnet, haiku）
    const sonnet = screen.getAllByRole('combobox')[1] as HTMLSelectElement;
    fireEvent.change(sonnet, { target: { value: 'deepseek-v4-pro' } });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));

    expect(onSave).toHaveBeenCalledWith({
      'claude-opus-4-7': 'deepseek-v4-pro',
      'claude-sonnet-4-6': 'deepseek-v4-pro',
      'claude-haiku-4-5': 'deepseek-flash',
    });
  });
});
