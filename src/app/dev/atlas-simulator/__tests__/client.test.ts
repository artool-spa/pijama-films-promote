import { describe, it, expect } from 'vitest';
import { atlasAuthEnvelopeSchema } from '@/app/auth/atlas-bridge';
import { buildAuthUrl, buildSimulatorEnvelope } from '../client';

const input = {
  token: 'synthetic-token',
  partnerName: 'Simulated Partner',
  partnerEmail: 'partner@example.test',
};

describe('buildSimulatorEnvelope', () => {
  it('produces an envelope the page accepts', () => {
    const envelope = buildSimulatorEnvelope('valid', input);

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
    for (const shape of ['missing-token', 'wrong-type', 'missing-partner'] as const) {
      expect(atlasAuthEnvelopeSchema.safeParse(buildSimulatorEnvelope(shape, input)).success).toBe(
        false
      );
    }
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
