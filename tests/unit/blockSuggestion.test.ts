import { describe, it, expect } from 'vitest';
import { isBackgroundSuggestionRequest } from '../../electron/proxy/server';

describe('isBackgroundSuggestionRequest', () => {
  it('detects fingerprint in array string content', () => {
    const msg = {
      input: [
        {
          type: 'message',
          role: 'user',
          content:
            '# Overview\nGenerate 0 to 3 hyperpersonalized suggestions for what this user can do next.',
        },
      ],
    };
    expect(isBackgroundSuggestionRequest(msg)).toBe(true);
  });

  it('detects fingerprint in array part text', () => {
    const msg = {
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'Generate 0 to 3 hyperpersonalized suggestions please.' },
          ],
        },
      ],
    };
    expect(isBackgroundSuggestionRequest(msg)).toBe(true);
  });

  it('detects fingerprint in instructions', () => {
    expect(
      isBackgroundSuggestionRequest({
        instructions: 'You must Generate 0 to 3 hyperpersonalized suggestions.',
      }),
    ).toBe(true);
  });

  it('returns false for normal user prompts', () => {
    expect(
      isBackgroundSuggestionRequest({
        input: [
          { type: 'message', role: 'user', content: '如果让你写PPT，你需要安装什么技能或者插件' },
        ],
      }),
    ).toBe(false);
  });

  it('returns false for empty inputs', () => {
    expect(isBackgroundSuggestionRequest({})).toBe(false);
    expect(isBackgroundSuggestionRequest({ input: [] })).toBe(false);
  });

  // empty warm-up handling lives inline in handleWs; documented here for posterity.
  it('returns false for empty warm-up handshake (handled separately by isEmptyWarmup)', () => {
    expect(isBackgroundSuggestionRequest({ input: [], instructions: '' })).toBe(false);
  });
});
