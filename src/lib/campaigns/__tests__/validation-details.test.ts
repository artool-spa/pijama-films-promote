import { describe, it, expect } from 'vitest';
import { describeApiError, formatValidationDetails } from '@/lib/campaigns/validation-details';

describe('formatValidationDetails', () => {
  it('names the offending fields', () => {
    const body = {
      error: 'Invalid campaign data',
      details: { formErrors: [], fieldErrors: { draftId: ['Invalid cuid'] } },
    };

    expect(formatValidationDetails(body)).toBe('draftId: Invalid cuid');
  });

  it('joins several fields and form-level errors', () => {
    const body = {
      details: {
        formErrors: ['At least one image or video is required'],
        fieldErrors: { campaignId: ['Required'], budget: ['Too small', 'Not a number'] },
      },
    };

    expect(formatValidationDetails(body)).toBe(
      'campaignId: Required | budget: Too small, Not a number | At least one image or video is required'
    );
  });

  it('returns null when there is nothing usable', () => {
    expect(formatValidationDetails(null)).toBeNull();
    expect(formatValidationDetails(undefined)).toBeNull();
    expect(formatValidationDetails({ error: 'Boom' })).toBeNull();
    // A platform error carries a string in `details`, not a Zod shape.
    expect(formatValidationDetails({ error: 'Boom', details: 'upstream exploded' })).toBeNull();
    expect(formatValidationDetails({ details: { formErrors: [], fieldErrors: {} } })).toBeNull();
  });
});

describe('describeApiError', () => {
  it('appends the detail to the message', () => {
    const body = {
      error: 'Invalid campaign data',
      details: { fieldErrors: { draftId: ['Invalid cuid'] } },
    };

    expect(describeApiError(body, 'fallback')).toBe(
      'Invalid campaign data (draftId: Invalid cuid)'
    );
  });

  it('keeps the message alone when there is no detail', () => {
    expect(describeApiError({ error: 'Rate limited' }, 'fallback')).toBe('Rate limited');
  });

  it('falls back when the body has no message', () => {
    expect(describeApiError({}, 'Could not publish')).toBe('Could not publish');
    expect(describeApiError(null, 'Could not publish')).toBe('Could not publish');
  });
});
