import { describe, it, expect } from 'vitest';
import { atlasAuthEnvelopeSchema } from '@/app/auth/atlas-bridge';
import { buildAuthUrl, buildSimulatorEnvelope } from '../client';

const input = {
  token: 'synthetic-token',
  partnerName: 'Simulated Partner',
  partnerEmail: 'partner@example.test',
};

describe('buildSimulatorEnvelope', () => {
  /**
   * This case used to live in the rejected loop below, under the name
   * `missing-partner`, asserting `success === false`. That assertion was the bug:
   * `{ type, token }` is what the deployed Atlas Console really posts (measured
   * 2026-08-28 from the production bundle), so the simulator declared the
   * production handshake a failure mode — in the one tool built to reproduce it.
   *
   * The polarity of this assertion is therefore reversed on purpose, and it is
   * pinned in both directions: accepted by the schema, and byte-for-byte the shape
   * Console sends, with no `partner` key present at all.
   */
  it('produces the shape Console really sends, and the page accepts it', () => {
    const envelope = buildSimulatorEnvelope('console-shape', input);

    expect(atlasAuthEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(envelope).toEqual({ type: 'ATLAS_AUTH', token: 'synthetic-token' });
    // Absent, not present-and-empty: the two are different claims from a producer.
    expect('partner' in envelope).toBe(false);
  });

  it('still produces the documented shape, and the page still accepts it', () => {
    const envelope = buildSimulatorEnvelope('documented-shape', input);

    expect(atlasAuthEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(envelope).toEqual({
      type: 'ATLAS_AUTH',
      token: 'synthetic-token',
      partner: { name: input.partnerName, email: input.partnerEmail },
    });
  });

  it('produces envelopes the page rejects, one per failure mode', () => {
    // If any of these accidentally validated, the simulator could not reproduce
    // the malformed-envelope path at all.
    for (const shape of ['missing-token', 'wrong-type', 'malformed-partner'] as const) {
      expect(atlasAuthEnvelopeSchema.safeParse(buildSimulatorEnvelope(shape, input)).success).toBe(
        false
      );
    }
  });

  /**
   * Called out on its own rather than left inside the loop above, because it is the
   * invariant most at risk now that `partner` is optional: "optional" must not slide
   * into "any shape is fine". A `partner` that is a bare string has to be rejected,
   * not rendered as an identity.
   */
  it('reproduces a present-but-malformed partner, which the page must reject', () => {
    const envelope = buildSimulatorEnvelope('malformed-partner', input);

    expect(envelope).toEqual({
      type: 'ATLAS_AUTH',
      token: 'synthetic-token',
      partner: input.partnerName,
    });
    expect(atlasAuthEnvelopeSchema.safeParse(envelope).success).toBe(false);
  });
});

describe('buildAuthUrl', () => {
  it('carries the requested session mode', () => {
    expect(buildAuthUrl('probe', 'dev')).toBe('/auth?mode=probe');
    expect(buildAuthUrl('login', 'dev')).toBe('/auth?mode=login');
  });

  it('adds origins=strict so the development self-origin allowance is dropped', () => {
    // This is what makes the "origin not allowed" path reproducible locally.
    expect(buildAuthUrl('probe', 'strict')).toBe('/auth?mode=probe&origins=strict');
  });
});
