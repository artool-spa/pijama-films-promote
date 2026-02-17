import { describe, it, expect } from 'vitest';
import {
  META_MIN_DAILY_PER_ADSET,
  META_ASSET_TYPES,
  GOOGLE_MIN_DAILY,
  validateCampaignBudget,
} from '../budget-validation';

describe('Campaign budget validation', () => {
  describe('constants', () => {
    it('should have correct Meta minimum daily per adset', () => {
      expect(META_MIN_DAILY_PER_ADSET).toBe(1);
    });

    it('should have correct Meta asset types count', () => {
      expect(META_ASSET_TYPES).toBe(2);
    });

    it('should have correct Google minimum daily', () => {
      expect(GOOGLE_MIN_DAILY).toBe(5);
    });
  });

  describe('validateCampaignBudget', () => {
    it('Meta only, 1 language, 7 days: min = 2 × 7 = $14', () => {
      const result = validateCampaignBudget({
        budget: 14,
        platforms: ['facebook', 'instagram'],
        languages: 1,
        startDate: '2026-03-01',
        endDate: '2026-03-08',
      });
      expect(result.valid).toBe(true);
      expect(result.minimumBudget).toBe(14);
      expect(result.dailyMinimum).toBe(2);
      expect(result.scheduledDays).toBe(7);
    });

    it('Meta only, 2 languages, 7 days: min = 4 × 7 = $28', () => {
      const result = validateCampaignBudget({
        budget: 28,
        platforms: ['facebook', 'instagram'],
        languages: 2,
        startDate: '2026-03-01',
        endDate: '2026-03-08',
      });
      expect(result.valid).toBe(true);
      expect(result.minimumBudget).toBe(28);
      expect(result.dailyMinimum).toBe(4);
    });

    it('Google only, 7 days: min = 5 × 7 = $35', () => {
      const result = validateCampaignBudget({
        budget: 35,
        platforms: ['youtube'],
        languages: 1,
        startDate: '2026-03-01',
        endDate: '2026-03-08',
      });
      expect(result.valid).toBe(true);
      expect(result.minimumBudget).toBe(35);
      expect(result.dailyMinimum).toBe(5);
    });

    it('Both platforms, 2 languages, 7 days: min = (4+5) × 7 = $63', () => {
      const result = validateCampaignBudget({
        budget: 63,
        platforms: ['facebook', 'instagram', 'youtube'],
        languages: 2,
        startDate: '2026-03-01',
        endDate: '2026-03-08',
      });
      expect(result.valid).toBe(true);
      expect(result.minimumBudget).toBe(63);
      expect(result.dailyMinimum).toBe(9);
    });

    it('exact minimum → valid', () => {
      const result = validateCampaignBudget({
        budget: 14,
        platforms: ['facebook'],
        languages: 1,
        startDate: '2026-03-01',
        endDate: '2026-03-08',
      });
      expect(result.valid).toBe(true);
      expect(result.errorMessage).toBeNull();
    });

    it('1 below minimum → invalid', () => {
      const result = validateCampaignBudget({
        budget: 13,
        platforms: ['facebook'],
        languages: 1,
        startDate: '2026-03-01',
        endDate: '2026-03-08',
      });
      expect(result.valid).toBe(false);
      expect(result.errorMessage).toContain('$14');
    });

    it('no platforms → valid', () => {
      const result = validateCampaignBudget({
        budget: 0,
        platforms: [],
        languages: 1,
        startDate: '2026-03-01',
        endDate: '2026-03-08',
      });
      expect(result.valid).toBe(true);
    });

    it('1-day campaign edge case', () => {
      const result = validateCampaignBudget({
        budget: 2,
        platforms: ['facebook'],
        languages: 1,
        startDate: '2026-03-01',
        endDate: '2026-03-02',
      });
      expect(result.valid).toBe(true);
      expect(result.minimumBudget).toBe(2);
      expect(result.scheduledDays).toBe(1);
    });

    it('Meta with only facebook counts as hasMeta', () => {
      const result = validateCampaignBudget({
        budget: 14,
        platforms: ['facebook'],
        languages: 1,
        startDate: '2026-03-01',
        endDate: '2026-03-08',
      });
      expect(result.valid).toBe(true);
      expect(result.dailyMinimum).toBe(2);
    });

    it('Meta with only instagram counts as hasMeta', () => {
      const result = validateCampaignBudget({
        budget: 14,
        platforms: ['instagram'],
        languages: 1,
        startDate: '2026-03-01',
        endDate: '2026-03-08',
      });
      expect(result.valid).toBe(true);
      expect(result.dailyMinimum).toBe(2);
    });

    it('helperMessage always shows minimum info', () => {
      const result = validateCampaignBudget({
        budget: 100,
        platforms: ['facebook', 'youtube'],
        languages: 2,
        startDate: '2026-03-01',
        endDate: '2026-03-08',
      });
      expect(result.helperMessage).toContain('Min. $63');
      expect(result.helperMessage).toContain('$9/day');
      expect(result.helperMessage).toContain('7 days');
    });

    it('missing dates → valid', () => {
      const result = validateCampaignBudget({
        budget: 0,
        platforms: ['facebook'],
        languages: 1,
        startDate: '',
        endDate: '',
      });
      expect(result.valid).toBe(true);
    });
  });
});
