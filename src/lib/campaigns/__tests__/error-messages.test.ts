import { describe, it, expect } from 'vitest';
import { toFriendlyCampaignError } from '@/lib/campaigns/error-messages';
import {
  MetaApiError,
  MetaAuthError,
  MetaRateLimitError,
  MetaConfigError,
} from '@/lib/meta/errors';
import {
  GoogleAdsApiError,
  GoogleAdsAuthError,
  GoogleAdsQuotaError,
} from '@/lib/google/errors';

// Spanish words that must never leak into a user-facing campaign error.
const SPANISH = /(campaña|campana|autorizado|inválid|invalid[oa]|guardó|imágenes|sincronizar|configurado)/i;

describe('toFriendlyCampaignError', () => {
  it('maps Meta auth expiry to a reconnect message', () => {
    const msg = toFriendlyCampaignError(new MetaAuthError('token expired', 401, 190), 'Meta');
    expect(msg).toMatch(/expired/i);
    expect(msg).toMatch(/support/i);
  });

  it('maps a known Meta budget code to friendly budget guidance', () => {
    const msg = toFriendlyCampaignError(new MetaApiError('x', { errorCode: 1487079 }), 'Meta');
    expect(msg).toMatch(/budget/i);
    expect(msg).toMatch(/minimum/i);
  });

  it("prefers Meta's error_user_msg when no known code matches", () => {
    const err = new MetaApiError('raw graph text', {
      errorCode: 999999,
      response: { error: { error_user_title: 'Budget', error_user_msg: 'Your budget is too low' } },
    });
    expect(toFriendlyCampaignError(err, 'Meta')).toBe('Budget: Your budget is too low');
  });

  it('falls back to a clean English Meta message for unknown API errors', () => {
    const msg = toFriendlyCampaignError(new MetaApiError('raw', { errorCode: 999999 }), 'Meta');
    expect(msg).toMatch(/Meta/);
    expect(msg).toMatch(/try again/i);
  });

  it('maps Meta rate limiting', () => {
    const msg = toFriendlyCampaignError(new MetaRateLimitError('slow down'), 'Meta');
    expect(msg).toMatch(/limiting requests/i);
  });

  it('maps Meta config error to a draft/contact-support message', () => {
    const msg = toFriendlyCampaignError(new MetaConfigError('missing', ['META_PAGE_ID']), 'Meta');
    expect(msg).toMatch(/not configured/i);
    expect(msg).toMatch(/draft/i);
  });

  it('maps Google INVALID_ARGUMENT to a settings message', () => {
    const msg = toFriendlyCampaignError(new GoogleAdsApiError('bad', { errorCode: 'INVALID_ARGUMENT' }), 'Google');
    expect(msg).toMatch(/Google/);
    expect(msg).toMatch(/settings/i);
  });

  it('detects a budget problem from the Google message text', () => {
    const msg = toFriendlyCampaignError(new GoogleAdsApiError('The campaign budget is too low'), 'Google');
    expect(msg).toMatch(/budget/i);
  });

  it('maps Google auth and quota errors', () => {
    expect(toFriendlyCampaignError(new GoogleAdsAuthError('unauth', 401), 'Google')).toMatch(/expired/i);
    expect(toFriendlyCampaignError(new GoogleAdsQuotaError('quota'), 'Google')).toMatch(/limiting requests/i);
  });

  it('returns a generic English fallback for a plain Error', () => {
    const msg = toFriendlyCampaignError(new Error('boom'), 'Meta');
    expect(msg).toMatch(/Something went wrong/i);
  });

  it('never includes a platform prefix or Spanish', () => {
    const cases: unknown[] = [
      new MetaAuthError('x', 401, 190),
      new MetaApiError('x', { errorCode: 1487079 }),
      new GoogleAdsApiError('x', { errorCode: 'INVALID_ARGUMENT' }),
      new GoogleAdsAuthError('x', 401),
      new Error('boom'),
    ];
    for (const err of cases) {
      const meta = toFriendlyCampaignError(err, 'Meta');
      const google = toFriendlyCampaignError(err, 'Google');
      expect(meta).not.toMatch(/^Meta:/);
      expect(google).not.toMatch(/^Google:/);
      expect(meta).not.toMatch(SPANISH);
      expect(google).not.toMatch(SPANISH);
    }
  });
});
