import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getAtlasAllowedOrigins,
  getAtlasAllowedPartnerIds,
  getAtlasBaseUrl,
  getAtlasMoviesUrl,
  isAtlasLoginEnabled,
  isPartnerAllowed,
} from '../config';

const ATLAS_ENV_KEYS = [
  'ATLAS_API_BASE_URL',
  'ATLAS_LOGIN_ENABLED',
  'ATLAS_LOGIN_ALLOWED_PARTNER_IDS',
  'NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS',
] as const;

function clearAtlasEnv() {
  for (const key of ATLAS_ENV_KEYS) delete process.env[key];
}

beforeEach(clearAtlasEnv);
afterEach(clearAtlasEnv);

describe('getAtlasBaseUrl', () => {
  it('strips trailing slashes so the movies path is not doubled', () => {
    process.env.ATLAS_API_BASE_URL = 'https://dashboard.pijamafilms.com///';

    expect(getAtlasBaseUrl()).toBe('https://dashboard.pijamafilms.com');
    expect(getAtlasMoviesUrl()).toBe(
      'https://dashboard.pijamafilms.com/movies/by-partner'
    );
  });

  it('reports null rather than building a URL against an unset base', () => {
    // A base of '' would produce '/movies/by-partner' and fetch would resolve it
    // against nothing. The route needs to say "not configured" instead.
    expect(getAtlasBaseUrl()).toBeNull();
    expect(getAtlasMoviesUrl()).toBeNull();
  });

  it('treats a whitespace-only base URL as unset', () => {
    process.env.ATLAS_API_BASE_URL = '   ';

    expect(getAtlasBaseUrl()).toBeNull();
  });
});

describe('isAtlasLoginEnabled', () => {
  it('enables login only for the exact string "true"', () => {
    process.env.ATLAS_LOGIN_ENABLED = 'true';
    expect(isAtlasLoginEnabled()).toBe(true);

    process.env.ATLAS_LOGIN_ENABLED = ' TRUE ';
    expect(isAtlasLoginEnabled()).toBe(true);
  });

  it.each(['', 'false', '1', 'yes', 'on', 'True-ish'])(
    'stays disabled for %o',
    (value) => {
      process.env.ATLAS_LOGIN_ENABLED = value;

      expect(
        isAtlasLoginEnabled(),
        `"${value}" must not enable Atlas login: anything but a deliberate "true" ` +
          'has to leave SSO login off, or a typo in the env var silently opens it'
      ).toBe(false);
    }
  );

  it('stays disabled when the variable is absent', () => {
    expect(isAtlasLoginEnabled()).toBe(false);
  });
});

describe('getAtlasAllowedPartnerIds', () => {
  it('splits, trims and de-duplicates the comma-separated list', () => {
    process.env.ATLAS_LOGIN_ALLOWED_PARTNER_IDS = ' partner-a , partner-b ,partner-a, ';

    expect(getAtlasAllowedPartnerIds()).toEqual(['partner-a', 'partner-b']);
  });

  it('returns an empty list when the variable is absent', () => {
    expect(getAtlasAllowedPartnerIds()).toEqual([]);
  });
});

describe('isPartnerAllowed', () => {
  it('admits a partner named in the list', () => {
    process.env.ATLAS_LOGIN_ALLOWED_PARTNER_IDS = 'partner-a,partner-b';

    expect(isPartnerAllowed('partner-b')).toBe(true);
  });

  it('rejects everyone when the allowlist is absent', () => {
    // Fail-closed. "Empty means all" would turn a forgotten env var into a door
    // to the whole catalogue: getFilms() does not filter by partner, so any
    // session at all sees every partner's films.
    expect(
      isPartnerAllowed('partner-a'),
      'an absent ATLAS_LOGIN_ALLOWED_PARTNER_IDS must reject every partner; ' +
        'reading it as "allow all" hands the full catalogue to anyone Atlas mints a token for'
    ).toBe(false);
  });

  it('rejects everyone when the allowlist is empty or only separators', () => {
    for (const value of ['', '   ', ',', ' , , ']) {
      process.env.ATLAS_LOGIN_ALLOWED_PARTNER_IDS = value;

      expect(
        isPartnerAllowed('partner-a'),
        `ATLAS_LOGIN_ALLOWED_PARTNER_IDS=${JSON.stringify(value)} contains no partner ` +
          'id, so it must admit nobody'
      ).toBe(false);
    }
  });

  it('rejects a partner that is not on a populated list', () => {
    process.env.ATLAS_LOGIN_ALLOWED_PARTNER_IDS = 'partner-a';

    expect(isPartnerAllowed('partner-z')).toBe(false);
  });

  it('is not fooled by surrounding whitespace on either side', () => {
    process.env.ATLAS_LOGIN_ALLOWED_PARTNER_IDS = ' partner-a ';

    expect(isPartnerAllowed(' partner-a ')).toBe(true);
  });

  it('does not match a partner id by prefix', () => {
    process.env.ATLAS_LOGIN_ALLOWED_PARTNER_IDS = 'partner-a';

    expect(
      isPartnerAllowed('partner-a-evil'),
      'the allowlist compares whole ids; a prefix match would let a neighbouring ' +
        'partner id slip through'
    ).toBe(false);
  });
});

describe('getAtlasAllowedOrigins', () => {
  it('parses the list with production first and no trailing slashes', () => {
    process.env.NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS =
      'https://dashboard.pijamafilms.com/, https://dashboard-lab.pijamafilms.com';

    expect(getAtlasAllowedOrigins()).toEqual([
      'https://dashboard.pijamafilms.com',
      'https://dashboard-lab.pijamafilms.com',
    ]);
  });

  it('returns an empty list when unset', () => {
    expect(getAtlasAllowedOrigins()).toEqual([]);
  });
});
