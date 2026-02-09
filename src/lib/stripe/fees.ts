// Stripe fee constants (worst-case scenario for international cards)
export const STRIPE_FEE_RATE = 0.059; // 5.9%
export const STRIPE_FEE_FIXED = 0.30; // $0.30 fixed

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Calculate worst-case Stripe fee for a given deposit amount
 */
export function calculateWorstCaseFee(depositAmount: number): number {
  return round2(depositAmount * STRIPE_FEE_RATE + STRIPE_FEE_FIXED);
}

/**
 * Calculate total charge (deposit + worst-case fee)
 */
export function calculateTotalCharge(depositAmount: number): number {
  return round2(depositAmount + calculateWorstCaseFee(depositAmount));
}
