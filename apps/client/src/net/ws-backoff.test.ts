import { describe, expect, it } from 'vitest';
import { RECONNECT_BACKOFF, reconnectDelay } from './ws-backoff.js';

describe('reconnectDelay', () => {
  const top = () => 0.999_999;

  it('doubles the ceiling each attempt', () => {
    expect(reconnectDelay(0, top)).toBe(RECONNECT_BACKOFF.baseMs - 1);
    expect(reconnectDelay(1, top)).toBe(RECONNECT_BACKOFF.baseMs * 2 - 1);
    expect(reconnectDelay(3, top)).toBe(RECONNECT_BACKOFF.baseMs * 8 - 1);
  });

  it('caps at the maximum, even after many attempts', () => {
    expect(reconnectDelay(10, top)).toBe(RECONNECT_BACKOFF.maxMs - 1);
    expect(reconnectDelay(1000, top)).toBe(RECONNECT_BACKOFF.maxMs - 1);
  });

  it('spreads clients out with full jitter', () => {
    expect(reconnectDelay(4, () => 0)).toBe(0);
    expect(reconnectDelay(4, () => 0.5)).toBe(RECONNECT_BACKOFF.baseMs * 8);
  });
});
