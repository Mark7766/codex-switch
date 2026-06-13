import { randomBytes } from 'node:crypto';
import { describe, it, expect } from 'vitest';

// Test pure utility functions that don't depend on electron
// (buildUrl + generateClientId extracted for testing)

describe('buildUrl', () => {
  // Inline buildUrl to avoid importing from config.ts (which imports electron)
  function buildUrl(baseUrl: string, path: string): string {
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${baseUrl}${p}`;
  }

  it('joins baseUrl and path with /', () => {
    expect(buildUrl('https://example.com/api/v1', '/telemetry/events')).toBe(
      'https://example.com/api/v1/telemetry/events',
    );
  });

  it('adds / when path missing leading slash', () => {
    expect(buildUrl('https://example.com/api/v1', 'telemetry/events')).toBe(
      'https://example.com/api/v1/telemetry/events',
    );
  });

  it('works with root path', () => {
    expect(buildUrl('https://example.com/api/v1', '/')).toBe('https://example.com/api/v1/');
  });

  it('works with empty baseUrl', () => {
    expect(buildUrl('', '/test')).toBe('/test');
  });
});

describe('generateClientId', () => {
  function generateClientId(): string {
    return randomBytes(8).toString('hex');
  }

  it('returns 16 hex characters', () => {
    const id = generateClientId();
    expect(id).toHaveLength(16);
    expect(/^[0-9a-f]{16}$/.test(id)).toBe(true);
  });

  it('generates unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateClientId()));
    expect(ids.size).toBe(100);
  });
});
