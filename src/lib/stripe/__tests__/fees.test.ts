import { describe, it, expect } from 'vitest';
import {
  STRIPE_FEE_RATE,
  STRIPE_FEE_FIXED,
  calculateWorstCaseFee,
  calculateTotalCharge,
} from '../fees';

describe('Stripe fee calculations', () => {
  describe('constants', () => {
    it('should have correct fee rate', () => {
      expect(STRIPE_FEE_RATE).toBe(0.059);
    });

    it('should have correct fixed fee', () => {
      expect(STRIPE_FEE_FIXED).toBe(0.30);
    });
  });

  describe('calculateWorstCaseFee', () => {
    it('should calculate fee for $100 deposit', () => {
      // 100 * 0.059 + 0.30 = 6.20
      expect(calculateWorstCaseFee(100)).toBe(6.20);
    });

    it('should calculate fee for $5 minimum deposit', () => {
      // 5 * 0.059 + 0.30 = 0.595 → rounded to 0.60
      expect(calculateWorstCaseFee(5)).toBe(0.60);
    });

    it('should calculate fee for $50 deposit', () => {
      // 50 * 0.059 + 0.30 = 3.25
      expect(calculateWorstCaseFee(50)).toBe(3.25);
    });

    it('should calculate fee for $250 deposit', () => {
      // 250 * 0.059 + 0.30 = 15.05
      expect(calculateWorstCaseFee(250)).toBe(15.05);
    });

    it('should calculate fee for $1000 deposit', () => {
      // 1000 * 0.059 + 0.30 = 59.30
      expect(calculateWorstCaseFee(1000)).toBe(59.30);
    });
  });

  describe('calculateTotalCharge', () => {
    it('should return deposit + fee for $100', () => {
      // 100 + 6.20 = 106.20
      expect(calculateTotalCharge(100)).toBe(106.20);
    });

    it('should return deposit + fee for $5', () => {
      // 5 + 0.60 = 5.60
      expect(calculateTotalCharge(5)).toBe(5.60);
    });

    it('should return deposit + fee for $1000', () => {
      // 1000 + 59.30 = 1059.30
      expect(calculateTotalCharge(1000)).toBe(1059.30);
    });

    it('should always be greater than the deposit amount', () => {
      for (const amount of [5, 10, 25, 50, 100, 250, 500, 1000]) {
        expect(calculateTotalCharge(amount)).toBeGreaterThan(amount);
      }
    });
  });
});
