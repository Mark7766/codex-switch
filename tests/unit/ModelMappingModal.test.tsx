/**
 * ModelMappingModal unit tests.
 * v2.2.0: the DeepSeek preset list exposes the vision model deepseek-v4-flash-vision-exp
 * only for Claude Code CLI (vision default true); Claude Desktop (vision=false) omits it.
 *
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModelMappingModal } from '../../src/components/ModelMappingModal';

const DEEPSEEK_MODELS = ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'];

function selectValues(el: Element): string[] {
  return Array.from((el as HTMLSelectElement).options).map((o) => o.value);
}

describe('ModelMappingModal', () => {
  it('offers the three deepseek models (incl. vision-exp) for every Claude slot', () => {
    render(
      <ModelMappingModal
        open
        onClose={vi.fn()}
        provider="deepseek"
        mapping={{}}
        onSave={vi.fn()}
      />,
    );

    const selects = screen.getAllByRole('combobox');
    // Opus / Sonnet / Haiku slots
    expect(selects.length).toBe(3);
    for (const sel of selects) {
      const values = selectValues(sel);
      for (const m of DEEPSEEK_MODELS) {
        expect(values).toContain(m);
      }
      expect(values).toContain('__custom__');
    }
  });

  it('preselects the deepseek default trio per slot when mapping is empty', () => {
    render(
      <ModelMappingModal
        open
        onClose={vi.fn()}
        provider="deepseek"
        mapping={{}}
        onSave={vi.fn()}
      />,
    );

    const [opus, sonnet, haiku] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(opus.value).toBe('deepseek-v4-pro');
    expect(sonnet.value).toBe('deepseek-v4-flash');
    expect(haiku.value).toBe('deepseek-v4-flash-vision-exp');
  });

  it('omits the vision model for Claude Desktop (vision=false) and defaults haiku to flash', () => {
    render(
      <ModelMappingModal
        open
        onClose={vi.fn()}
        provider="deepseek"
        mapping={{}}
        onSave={vi.fn()}
        vision={false}
      />,
    );

    const [opus, sonnet, haiku] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const values = selectValues(opus);
    expect(values).toContain('deepseek-v4-pro');
    expect(values).toContain('deepseek-v4-flash');
    expect(values).not.toContain('deepseek-v4-flash-vision-exp');
    // Desktop default: opus→pro / sonnet→flash / haiku→flash (no vision)
    expect(opus.value).toBe('deepseek-v4-pro');
    expect(sonnet.value).toBe('deepseek-v4-flash');
    expect(haiku.value).toBe('deepseek-v4-flash');
  });

  it('saves a mapping that points a Claude slot to deepseek-v4-flash-vision-exp', () => {
    const onSave = vi.fn();
    render(
      <ModelMappingModal open onClose={vi.fn()} provider="deepseek" mapping={{}} onSave={onSave} />,
    );

    // Sonnet slot is the 2nd combobox (CLAUDE_MODELS order: opus, sonnet, haiku).
    const sonnet = screen.getAllByRole('combobox')[1] as HTMLSelectElement;
    fireEvent.change(sonnet, { target: { value: 'deepseek-v4-flash-vision-exp' } });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));

    // Unmapped slots fall back to their role defaults (haiku defaults to vision now).
    expect(onSave).toHaveBeenCalledWith({
      'claude-opus-4-7': 'deepseek-v4-pro',
      'claude-sonnet-4-6': 'deepseek-v4-flash-vision-exp',
      'claude-haiku-4-5': 'deepseek-v4-flash-vision-exp',
    });
  });
});
