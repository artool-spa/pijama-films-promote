import { describe, it, expect } from 'vitest';
import {
  ATLAS_ERROR_STAGES,
  ATLAS_LAB_ORIGIN,
  ATLAS_PRODUCTION_ORIGIN,
  defaultAllowedOrigins,
  describeAtlasOutcome,
  STAGE_CONCLUSION,
  atlasAuthEnvelopeSchema,
  describeStage,
  describeToken,
  formatTokenFingerprint,
  isOriginAllowed,
  isSafeRedirect,
  isValidOriginLiteral,
  parseAllowedOrigins,
  parseSessionResponse,
  stageConclusion,
} from '../atlas-bridge';

import type { AtlasSessionStage } from '@/lib/atlas/types';
import type { AtlasErrorStage } from '../atlas-bridge';

/**
 * Compile-time, not runtime: `tsc --noEmit` covers this file, so if the two types
 * ever stop being the same these two lines stop compiling. This is the assertion
 * that the taxonomy is *derived* and not merely equal by coincidence today.
 */
const _stageIsTheServerType: AtlasErrorStage = null as unknown as AtlasSessionStage;
const _serverTypeIsTheStage: AtlasSessionStage = null as unknown as AtlasErrorStage;
void _stageIsTheServerType;
void _serverTypeIsTheStage;

const LAB = 'https://dashboard-lab.pijamafilms.com';
const PROD = 'https://dashboard.pijamafilms.com';

describe('parseAllowedOrigins', () => {
  it('splits, trims and de-duplicates the env var', () => {
    expect(parseAllowedOrigins(` ${LAB} , ${PROD},${LAB} `)).toEqual([LAB, PROD]);
  });

  it('returns an empty list when the var is missing or blank', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins('')).toEqual([]);
    expect(parseAllowedOrigins('   ,  ')).toEqual([]);
  });

  it('drops wildcards, paths and non-origins instead of repairing them', () => {
    // A repaired entry is how a too-wide match gets shipped without anyone noticing.
    expect(
      parseAllowedOrigins(`https://*.pijamafilms.com,${LAB}/dashboard,not-a-url,*,${LAB}`)
    ).toEqual([LAB]);
  });
});

describe('defaultAllowedOrigins', () => {
  it('accepts only the production Console in production', () => {
    // An absent variable must not make a working SSO look broken, but it must
    // also not quietly admit a third party's *testing* console into our
    // production sign-in. The lab origin buys nothing there.
    expect(defaultAllowedOrigins('production')).toEqual([PROD]);
    expect(defaultAllowedOrigins('production')).not.toContain(LAB);
  });

  it('accepts both outside production, production first', () => {
    for (const env of ['development', 'test', undefined]) {
      expect(defaultAllowedOrigins(env)).toEqual([PROD, LAB]);
    }
  });

  it('names the same origins the rest of the module uses', () => {
    expect(ATLAS_PRODUCTION_ORIGIN).toBe(PROD);
    expect(ATLAS_LAB_ORIGIN).toBe(LAB);
  });
});

describe('isValidOriginLiteral', () => {
  it('accepts scheme://host and scheme://host:port', () => {
    expect(isValidOriginLiteral(PROD)).toBe(true);
    expect(isValidOriginLiteral('http://localhost:3000')).toBe(true);
  });

  it('rejects trailing slashes, credentials and non-http schemes', () => {
    expect(isValidOriginLiteral(`${PROD}/`)).toBe(false);
    expect(isValidOriginLiteral('https://user:pass@dashboard.pijamafilms.com')).toBe(false);
    expect(isValidOriginLiteral('javascript://dashboard.pijamafilms.com')).toBe(false);
    expect(isValidOriginLiteral('file:///etc/passwd')).toBe(false);
    // These are the ones the exact-origin check alone would let through:
    // `new URL('ws://host').origin` is `ws://host`, so it matches itself.
    expect(isValidOriginLiteral('ws://dashboard.pijamafilms.com')).toBe(false);
    expect(isValidOriginLiteral('wss://dashboard.pijamafilms.com')).toBe(false);
    expect(isValidOriginLiteral('ftp://dashboard.pijamafilms.com')).toBe(false);
  });
});

describe('isOriginAllowed', () => {
  const allowed = [LAB, PROD];

  it('matches only on an exact origin', () => {
    expect(isOriginAllowed(PROD, allowed)).toBe(true);
    expect(isOriginAllowed(LAB, allowed)).toBe(true);
  });

  it('rejects suffix and prefix lookalikes', () => {
    // The whole point of exact matching: startsWith/endsWith would let these in.
    expect(isOriginAllowed('https://dashboard.pijamafilms.com.evil.io', allowed)).toBe(false);
    expect(isOriginAllowed('https://evil-dashboard.pijamafilms.com', allowed)).toBe(false);
    expect(isOriginAllowed(`${PROD}:8443`, allowed)).toBe(false);
    expect(isOriginAllowed('http://dashboard.pijamafilms.com', allowed)).toBe(false);
  });

  it('rejects the opaque "null" origin and an empty origin', () => {
    expect(isOriginAllowed('null', allowed)).toBe(false);
    expect(isOriginAllowed('', allowed)).toBe(false);
  });

  it('rejects everything when the allowlist is empty', () => {
    // Fail-closed: an unset env var must not mean "anyone".
    expect(isOriginAllowed(PROD, [])).toBe(false);
  });
});

describe('describeToken', () => {
  const token = 'eyJhbGciOiJIUzI1NiJ9.payload-that-must-never-be-shown.signature';

  it('reports presence, length and a six-character prefix only', () => {
    const fingerprint = describeToken(token);

    expect(fingerprint).toEqual({ present: true, length: token.length, prefix: 'eyJhbG' });
    expect(fingerprint.prefix).toHaveLength(6);
  });

  it('never leaks the token through the fingerprint or its rendered form', () => {
    const rendered = formatTokenFingerprint(describeToken(token));

    expect(JSON.stringify(describeToken(token))).not.toContain('payload-that-must-never-be-shown');
    expect(rendered).not.toContain('payload-that-must-never-be-shown');
    expect(rendered).toContain(String(token.length));
  });

  it('reports absence for a missing, empty or non-string token', () => {
    expect(describeToken(undefined).present).toBe(false);
    expect(describeToken('').present).toBe(false);
    expect(describeToken(12345).present).toBe(false);
    expect(formatTokenFingerprint(describeToken(null))).toBe('absent');
  });
});

describe('isSafeRedirect', () => {
  it('accepts same-site absolute paths', () => {
    expect(isSafeRedirect('/films')).toBe(true);
    expect(isSafeRedirect('/films?tab=1')).toBe(true);
  });

  it('rejects protocol-relative and absolute URLs', () => {
    expect(isSafeRedirect('//evil.example.com')).toBe(false);
    expect(isSafeRedirect('/\\evil.example.com')).toBe(false);
    expect(isSafeRedirect('https://evil.example.com')).toBe(false);
    expect(isSafeRedirect('films')).toBe(false);
    expect(isSafeRedirect(undefined)).toBe(false);
  });
});

describe('atlasAuthEnvelopeSchema (Contract B)', () => {
  const valid = {
    type: 'ATLAS_AUTH',
    token: 'a-token',
    partner: { name: 'Pijama', email: 'p@example.test' },
  };

  it('accepts the envelope with a partner attached', () => {
    expect(atlasAuthEnvelopeSchema.safeParse(valid).success).toBe(true);
  });

  /**
   * This is the envelope the *deployed* Atlas Console actually posts. Measured on
   * 2026-08-28 from the public production bundle
   * (`dashboard.pijamafilms.com/resources/entry.js?v=d4c06ad`), whose
   * `openMarketingPortal` posts `{ type: 'ATLAS_AUTH', token }` and nothing else.
   *
   * Requiring `partner` rejected a *correct* handoff — the precise false negative
   * this page exists to prevent — so it is optional, and its absence is a fact to
   * display rather than an error.
   */
  it('accepts the envelope Atlas Console really sends, with no partner at all', () => {
    const consoleShape = { type: 'ATLAS_AUTH', token: 'a-token' };

    expect(atlasAuthEnvelopeSchema.safeParse(consoleShape).success).toBe(true);
  });

  it('reads an absent partner as undefined rather than inventing one', () => {
    const parsed = atlasAuthEnvelopeSchema.safeParse({ type: 'ATLAS_AUTH', token: 'a-token' });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.partner).toBeUndefined();
  });

  /**
   * Optional is not "anything goes". `partner` is untrusted postMessage data used
   * only for the diagnostics panel, and a panel that renders `[object Object]` or
   * `123 <undefined>` for a garbage partner is worse than one that says the
   * envelope is malformed.
   */
  it('rejects a partner that is present but malformed', () => {
    for (const partner of [
      'texto',
      123,
      [],
      true,
      { name: 123, email: 'p@example.test' },
      { name: 'Pijama', email: 456 },
      { name: 'Pijama' },
      { email: 'p@example.test' },
    ]) {
      expect(atlasAuthEnvelopeSchema.safeParse({ ...valid, partner }).success).toBe(false);
    }
  });

  it('still rejects a null partner: absent and explicitly empty are not the same claim', () => {
    expect(atlasAuthEnvelopeSchema.safeParse({ ...valid, partner: null }).success).toBe(false);
  });

  it('rejects a missing token, an empty token and a wrong type', () => {
    expect(atlasAuthEnvelopeSchema.safeParse({ ...valid, token: undefined }).success).toBe(false);
    expect(atlasAuthEnvelopeSchema.safeParse({ ...valid, token: '' }).success).toBe(false);
    expect(atlasAuthEnvelopeSchema.safeParse({ ...valid, type: 'ATLAS_AUTH_V2' }).success).toBe(false);
    // Without a partner to lean on, the type and token checks are all that stand
    // between us and an arbitrary cross-origin message.
    expect(atlasAuthEnvelopeSchema.safeParse({ type: 'ATLAS_AUTH' }).success).toBe(false);
    expect(atlasAuthEnvelopeSchema.safeParse({ token: 'a-token' }).success).toBe(false);
  });
});

describe('the stage taxonomy', () => {
  it('is the nine stages the server domain defines, in its order', () => {
    // The *type* is now imported from the server domain, so a stage added there
    // fails this build. What the type cannot catch is this runtime array being
    // short — it validates fine as a subset — so the list is pinned here and to
    // STAGE_CONCLUSION's keys below.
    expect([...ATLAS_ERROR_STAGES]).toEqual([
      'input',
      'rate_limited',
      'config',
      'atlas_call',
      'contract',
      'no_partner',
      'disabled',
      'allowlist',
      'session',
    ]);
  });

  it('has exactly one conclusion per stage, and no orphans either way', () => {
    // The two structures drifting apart is the failure this guards: a stage in the
    // list with no conclusion renders blank, and a conclusion with no stage is a
    // rename nobody finished.
    expect(Object.keys(STAGE_CONCLUSION).sort()).toEqual([...ATLAS_ERROR_STAGES].sort());
  });

  /**
   * `config` and `atlas_call` are one keystroke apart in the route and worlds
   * apart on screen. An unset ATLAS_API_BASE_URL used to arrive as `atlas_call`,
   * so this panel told the reader "Atlas could not be reached at all" about a
   * variable of ours - and someone nearly wrote to Crazy Cake about it.
   */
  it('blames the deployment, not Atlas, for a configuration failure', () => {
    const said = stageConclusion('config') ?? '';

    expect(said).toMatch(/configur/i);
    expect(said).toContain('ATLAS_API_BASE_URL');
    expect(
      said,
      'nothing was sent, so this stage may not say anything about the token or ' +
        'about whether the integration works'
    ).not.toMatch(/could not be reached|Atlas answered|token was/i);
  });

  it('keeps atlas_call meaning what it now exclusively means', () => {
    expect(stageConclusion('atlas_call')).toMatch(/could not be reached/i);
    expect(describeStage('config', 'x').known).toBe(true);
    expect(describeStage('config', 'x').label).toBe('config');
  });

  it('says something for every one of them', () => {
    for (const stage of ATLAS_ERROR_STAGES) {
      expect(stageConclusion(stage)?.length ?? 0).toBeGreaterThan(20);
    }
  });
});

describe('parseSessionResponse (Contract A)', () => {
  it('reads a probe success with its diagnostics', () => {
    const parsed = parseSessionResponse({
      ok: true,
      diagnostics: {
        atlasUrlTried: 'https://dashboard-lab.pijamafilms.com/movies/by-partner',
        atlasStatus: 302,
        contractMatched: false,
        partner: null,
        movieCount: 0,
        movieSample: [],
        responseShapeKeys: ['error'],
      },
    });

    expect(parsed?.ok).toBe(true);
    expect(parsed?.diagnostics?.atlasStatus).toBe(302);
    expect(parsed?.diagnostics?.responseShapeKeys).toEqual(['error']);
  });

  it('reads a login success', () => {
    const parsed = parseSessionResponse({ ok: true, redirectTo: '/films' });

    expect(parsed?.redirectTo).toBe('/films');
  });

  it('marks all documented stages as contractual', () => {
    for (const stage of [
      'input',
      'config',
      'atlas_call',
      'contract',
      'no_partner',
      'disabled',
      'allowlist',
      'session',
    ]) {
      expect(parseSessionResponse({ ok: false, stage })?.stageIsContractual).toBe(true);
    }
  });

  it('surfaces an unknown stage instead of hiding it', () => {
    // A stage outside the contract is a finding for T0, so it must stay visible.
    const parsed = parseSessionResponse({ ok: false, stage: 'quota', message: 'rate limited' });

    expect(parsed?.stage).toBe('quota');
    expect(parsed?.stageIsContractual).toBe(false);
  });

  it('returns null rather than throwing on a body that is not Contract A', () => {
    // While the server domain is in flight this is an HTML 404 body.
    expect(parseSessionResponse('<!doctype html>')).toBeNull();
    expect(parseSessionResponse({ error: 'Not found' })).toBeNull();
    expect(parseSessionResponse(null)).toBeNull();
  });
});

/**
 * `describeAtlasOutcome` had **no test at all** until now, which is how a false
 * accusation lived in it unnoticed: its 3xx branch said "either the token was
 * rejected or ATLAS_API_BASE_URL points at the wrong host".
 *
 * That sentence renders in the "What Atlas did" row, four rows under a banner that
 * says nothing can be concluded about the token — so one screen made two
 * incompatible claims, and it was on its way into a screenshot to Crazy Cake.
 *
 * Measured 2026-08-28: the same token that gets a 302 from our server (Bearer only)
 * returns a 200 with a well-formed Contract C body from JP's browser (cookie +
 * Bearer). The token is valid and the route works. Whether Atlas looks at the token
 * before redirecting is still not visible from our side — which is exactly why no
 * branch of this function may assign a cause to it, in either direction.
 */
describe('describeAtlasOutcome — reports observations, never causes it cannot see', () => {
  const REJECTS_TOKEN = /token was rejected|invalid token|token is invalid/i;
  const CLEARS_TOKEN = /token was (never )?(evaluated|examined|read|judged)|token was accepted/i;

  it('describes a 302 as a redirect, without blaming or clearing the token', () => {
    const text = describeAtlasOutcome({ atlasStatus: 302, contractMatched: false }) ?? '';

    expect(text).toMatch(/redirect/i);
    expect(text).not.toMatch(REJECTS_TOKEN);
    expect(text).not.toMatch(CLEARS_TOKEN);
  });

  it('says the same for every 3xx, not just the 302 we happened to measure', () => {
    for (const status of [301, 302, 303, 307, 308]) {
      const text = describeAtlasOutcome({ atlasStatus: status, contractMatched: false }) ?? '';

      expect(text, `status ${status}`).toMatch(/redirect/i);
      expect(text, `status ${status}`).not.toMatch(REJECTS_TOKEN);
      expect(text, `status ${status}`).not.toMatch(CLEARS_TOKEN);
    }
  });

  /**
   * This branch only runs for a 2xx, and it used to open with "Atlas answered
   * normally, so the token was accepted". A 200 carrying an error body does not
   * establish that. Same overclaim as the 3xx one, pointing the other way.
   */
  it('does not turn a 2xx with a non-contract body into "the token was accepted"', () => {
    const text = describeAtlasOutcome({ atlasStatus: 200, contractMatched: false }) ?? '';

    expect(text).toMatch(/Contract C/);
    expect(text).not.toMatch(CLEARS_TOKEN);
    expect(text).not.toMatch(REJECTS_TOKEN);
  });

  it('still says nothing can be concluded when the request never completed', () => {
    const text = describeAtlasOutcome({ atlasStatus: 0 }) ?? '';

    expect(text).toMatch(/nothing can be concluded/i);
    expect(text).not.toMatch(REJECTS_TOKEN);
  });

  it('returns null when there is nothing measured to describe', () => {
    expect(describeAtlasOutcome(undefined)).toBeNull();
    expect(describeAtlasOutcome({})).toBeNull();
    expect(describeAtlasOutcome({ contractMatched: true })).toBeNull();
  });
});
