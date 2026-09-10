import { describe, it, expect } from 'vitest';
import { redactSensitive } from '../../electron/config/redact';

/**
 * v3.0.0: 从 `tests/unit/errors.test.ts` 拆出。`translateError` / `truncateMessages`
 * 是代理路径专属，随 `electron/proxy/errors.ts` 一并删除；`redactSensitive` 迁到
 * `electron/config/redact.ts`（诊断包与遥测清洗仍需要），故单独成文件。
 */
describe('redactSensitive', () => {
  it('redacts sk-* tokens', () => {
    const out = redactSensitive('Authorization: Bearer sk-abc1234567890XYZ');
    expect(out).not.toContain('sk-abc1234567890XYZ');
    expect(out).toContain('***');
  });
  it('redacts api_key=...', () => {
    const out = redactSensitive('api_key=secret_value_here');
    expect(out).toContain('***');
    expect(out).not.toContain('secret_value_here');
  });
  it('redacts OPENAI_API_KEY in JSON', () => {
    const out = redactSensitive('{"OPENAI_API_KEY":"sk-zzz999AAA"}');
    expect(out).not.toContain('sk-zzz999AAA');
    expect(out).toContain('***');
  });
  it('keeps unrelated text intact', () => {
    expect(redactSensitive('hello world')).toBe('hello world');
  });
});
