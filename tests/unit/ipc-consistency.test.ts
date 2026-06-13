/**
 * IPC constant consistency check (M3).
 *
 * Verifies that the IPC channel map in preload.ts stays in sync with
 * channels.ts. The preload inlines its IPC constants to avoid asar
 * dependency-loading issues, creating a maintenance drift risk.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { IPC } from '../../electron/ipc/channels';

describe('IPC channel consistency', () => {
  it('all channel values are unique', () => {
    const values = Object.values(IPC);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('all channel values follow naming convention', () => {
    for (const value of Object.values(IPC)) {
      expect(value).toMatch(/^[a-z-]+:[a-z-]+$/);
    }
  });

  it('preload IPC values match channels.ts IPC values', () => {
    const preloadPath = path.resolve(__dirname, '../../electron/preload.ts');
    const preloadSrc = fs.readFileSync(preloadPath, 'utf-8');

    // Extract IPC string values from preload: 'proxy:start', 'proxy:stop', etc.
    const preloadValues = new Set<string>();
    const regex = /:\s*'([a-z-]+:[a-z-]+)'/g;
    let match;
    while ((match = regex.exec(preloadSrc)) !== null) {
      preloadValues.add(match[1]!);
    }

    const channelsValues = new Set(Object.values(IPC));

    // Every preload value must exist in channels
    for (const pv of preloadValues) {
      expect(
        channelsValues.has(pv),
        `preload IPC value "${pv}" missing from channels.ts — add it or remove from preload`,
      ).toBe(true);
    }

    // Every channels value must exist in preload
    for (const cv of channelsValues) {
      expect(
        preloadValues.has(cv),
        `channels IPC value "${cv}" missing from preload.ts — add it or remove from channels`,
      ).toBe(true);
    }
  });
});
