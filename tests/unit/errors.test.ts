import { describe, it, expect } from 'vitest';
import { translateError, redactSensitive } from '../../electron/proxy/errors';

describe('translateError', () => {
  it('translates auth_invalid 401', () => {
    const r = translateError({
      statusCode: 401,
      body: { error: { message: 'Invalid API key', type: 'authentication_error' } },
    });
    expect(r.reason).toContain('API Key');
    expect(r.action).toBe('open-settings-key');
  });
  it('translates rate limit 429', () => {
    const r = translateError({ statusCode: 429, body: { error: { type: 'rate_limit_exceeded' } } });
    expect(r.reason).toContain('限流');
    expect(r.action).toBe('open-rate-limit-help');
  });
  it('translates insufficient quota', () => {
    const r = translateError({ statusCode: 402, body: { error: { code: 'insufficient_quota' } } });
    expect(r.reason).toContain('额度');
    expect(r.action).toBe('open-deepseek-billing');
  });
  it('translates model not accepted (400 model)', () => {
    const r = translateError({
      statusCode: 400,
      body: { error: { message: 'model gpt-5.4-mini does not exist' } },
    });
    expect(r.reason).toContain('模型');
    expect(r.action).toBe('open-settings-mapping');
  });
  it('translates network timeout', () => {
    const r = translateError({ networkErrorMessage: 'connect ETIMEDOUT' });
    expect(r.reason).toContain('网络');
    expect(r.action).toBe('open-network-help');
  });
  it('5xx → server error', () => {
    const r = translateError({ statusCode: 503, body: {} });
    expect(r.reason).toContain('服务异常');
  });
  it('falls back to raw message when no pattern matches', () => {
    const r = translateError({ statusCode: 418, body: { error: { message: '我是一只茶壶' } } });
    expect(r.reason).toContain('茶壶');
  });
});

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
