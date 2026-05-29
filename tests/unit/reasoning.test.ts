import { describe, it, expect } from 'vitest';
import { ReasoningStore } from '../../electron/proxy/reasoning';

describe('ReasoningStore', () => {
  it('stores and retrieves reasoning by call id', () => {
    const s = new ReasoningStore();
    s.set('c1', 'thinking...');
    expect(s.get('c1')).toBe('thinking...');
  });
  it('ignores empty key or value', () => {
    const s = new ReasoningStore();
    s.set('', 'x');
    s.set('c1', '');
    expect(s.size()).toBe(0);
  });
  it('clear empties the map', () => {
    const s = new ReasoningStore();
    s.set('c1', 'r');
    s.clear();
    expect(s.size()).toBe(0);
  });
  it('asMap returns a live reference', () => {
    const s = new ReasoningStore();
    s.set('c1', 'r');
    const m = s.asMap();
    expect(m.get('c1')).toBe('r');
  });
});
