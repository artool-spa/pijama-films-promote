/**
 * The admin bypass in canManageCampaign needs BOTH the reserved partner id and
 * an internal session origin. The id alone is a value Console could return.
 */
import { describe, it, expect } from 'vitest';
import { canManageCampaign, type SessionPartner } from '../access-control';

const base = { name: 'P', createdAt: new Date(), updatedAt: new Date() };
const partner = (over: Partial<SessionPartner>): SessionPartner =>
  ({ id: 'docX', partnerId: 'ext-x', ...base, ...over }) as SessionPartner;

describe('canManageCampaign', () => {
  it('lets an owner manage their own campaign, whatever the origin', () => {
    expect(canManageCampaign(partner({ sessionOrigin: 'sso' }), 'docX').allowed).toBe(true);
  });

  it('denies a foreign campaign to an ordinary partner', () => {
    expect(canManageCampaign(partner({ sessionOrigin: 'internal' }), 'docOther').allowed).toBe(false);
  });

  it('gives the admin bypass to pijamafilms on an internal session', () => {
    expect(
      canManageCampaign(partner({ partnerId: 'pijamafilms', sessionOrigin: 'internal' }), 'docOther').allowed
    ).toBe(true);
  });

  it('denies the bypass to pijamafilms on an SSO session', () => {
    expect(
      canManageCampaign(partner({ partnerId: 'pijamafilms', sessionOrigin: 'sso' }), 'docOther').allowed
    ).toBe(false);
  });

  it('fails closed when the origin is unknown', () => {
    expect(canManageCampaign(partner({ partnerId: 'pijamafilms' }), 'docOther').allowed).toBe(false);
  });
});
