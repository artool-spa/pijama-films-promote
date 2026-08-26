import { describe, it, expect, beforeEach } from 'vitest';
import {
  callerKey,
  consumeAtlasSessionQuota,
  resetAtlasSessionQuota,
} from '../rate-limit';

/**
 * Time is injected rather than mocked: the limiter takes `now` so a window
 * rollover can be tested without waiting a minute or freezing the clock.
 */
const T0 = 1_700_000_000_000;

beforeEach(resetAtlasSessionQuota);

describe('callerKey', () => {
  it('takes the original client from the x-forwarded-for chain', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' });

    expect(callerKey(headers)).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip', () => {
    expect(callerKey(new Headers({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('puts every unattributable caller in one shared bucket', () => {
    // Not "one fresh budget each": that would make the limiter free to defeat
    // by simply omitting the header.
    expect(
      callerKey(new Headers()),
      'traffic we cannot attribute must share a bucket, or dropping the header ' +
        'becomes the way around the limiter'
    ).toBe('unattributed');
  });
});

describe('consumeAtlasSessionQuota', () => {
  it('allows a human pace without ever noticing the limit', () => {
    for (let i = 0; i < 20; i++) {
      expect(consumeAtlasSessionQuota('1.1.1.1', T0).allowed).toBe(true);
    }
  });

  it('refuses once the window budget is spent', () => {
    for (let i = 0; i < 20; i++) consumeAtlasSessionQuota('1.1.1.1', T0);

    const result = consumeAtlasSessionQuota('1.1.1.1', T0);

    expect(
      result.allowed,
      'the endpoint is unauthenticated and each call costs one outbound request to ' +
        'Atlas; without a ceiling a loop is free'
    ).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('gives each caller its own budget', () => {
    for (let i = 0; i < 20; i++) consumeAtlasSessionQuota('1.1.1.1', T0);

    expect(
      consumeAtlasSessionQuota('2.2.2.2', T0).allowed,
      'one noisy caller must not lock out JP running the real test from elsewhere'
    ).toBe(true);
  });

  it('refills when the window rolls over', () => {
    for (let i = 0; i < 21; i++) consumeAtlasSessionQuota('1.1.1.1', T0);

    expect(consumeAtlasSessionQuota('1.1.1.1', T0 + 60_001).allowed).toBe(true);
  });

  it('reports a retry delay that never rounds down to zero', () => {
    for (let i = 0; i < 21; i++) consumeAtlasSessionQuota('1.1.1.1', T0);

    // 1ms before the rollover: a naive floor would say "retry in 0s", which a
    // client reads as "retry immediately" and turns into a hot loop.
    const result = consumeAtlasSessionQuota('1.1.1.1', T0 + 59_999);

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});
