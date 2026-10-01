import { describe, it, expect } from 'vitest';

import { resolveServiceAccount } from '../service-account';

describe('resolveServiceAccount', () => {
  it('resolves the production project', () => {
    expect(resolveServiceAccount('pijama-promote-firebase')).toBe(
      '603164121416-compute@developer.gserviceaccount.com'
    );
  });

  // The whole point of the module: never hand back another environment's
  // identity. A fallback would deploy triggers that authenticate as production
  // from a development project, and the only symptom would be 401s with no
  // indication of why.
  it('refuses an unknown project instead of falling back', () => {
    expect(() => resolveServiceAccount('some-other-project')).toThrow(
      /No trigger service account configured for project "some-other-project"/
    );
  });

  it('names the known projects so the fix is obvious from the error', () => {
    expect(() => resolveServiceAccount('some-other-project')).toThrow(
      /pijama-promote-firebase/
    );
  });

  it('refuses when no project is in the environment', () => {
    expect(() => resolveServiceAccount(undefined)).toThrow(/no project id/);
    expect(() => resolveServiceAccount('')).toThrow(/no project id/);
  });

  // Guards the pairing this module exists to keep: every address it can return
  // has to be a service account, because the backend compares it literally
  // against CRON_INVOKER_SERVICE_ACCOUNTS.
  it('returns a service account address', () => {
    expect(resolveServiceAccount('pijama-promote-firebase')).toMatch(
      /^[^@\s]+@[^@\s]+\.gserviceaccount\.com$/
    );
  });
});
