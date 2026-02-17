// Platform minimum daily budgets
export const META_MIN_DAILY_PER_ADSET = 1; // $1/day per adset (impressions billing)
export const META_ASSET_TYPES = 2; // Always image + video
export const GOOGLE_MIN_DAILY = 5; // $5/day for YouTube video campaigns

export interface BudgetValidationInput {
  budget: number; // Lifetime budget in dollars
  platforms: string[]; // ['facebook', 'instagram', 'youtube']
  languages: number; // Count of selected languages
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

export interface BudgetValidationResult {
  valid: boolean;
  minimumBudget: number; // Computed minimum lifetime budget
  dailyMinimum: number; // Combined daily minimum
  scheduledDays: number;
  errorMessage: string | null; // English, only when invalid
  helperMessage: string; // Always present, shows minimum
}

function computeScheduledDays(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  const diffMs = end.getTime() - start.getTime();
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(days, 1);
}

export function validateCampaignBudget(input: BudgetValidationInput): BudgetValidationResult {
  const { budget, platforms, languages, startDate, endDate } = input;

  // Edge cases: no platforms or invalid dates → valid (other validations handle those)
  if (platforms.length === 0 || !startDate || !endDate) {
    return {
      valid: true,
      minimumBudget: 0,
      dailyMinimum: 0,
      scheduledDays: 0,
      errorMessage: null,
      helperMessage: '',
    };
  }

  const hasMeta = platforms.some(p => p === 'facebook' || p === 'instagram');
  const hasGoogle = platforms.includes('youtube');

  const metaAdsets = languages * META_ASSET_TYPES;
  const metaDaily = hasMeta ? metaAdsets * META_MIN_DAILY_PER_ADSET : 0;
  const googleDaily = hasGoogle ? GOOGLE_MIN_DAILY : 0;
  const dailyMinimum = metaDaily + googleDaily;

  const scheduledDays = computeScheduledDays(startDate, endDate);
  if (scheduledDays === 0) {
    return {
      valid: true,
      minimumBudget: 0,
      dailyMinimum: 0,
      scheduledDays: 0,
      errorMessage: null,
      helperMessage: '',
    };
  }

  const minimumBudget = Math.ceil(dailyMinimum * scheduledDays);
  const valid = budget >= minimumBudget;

  const helperMessage = `Min. $${minimumBudget} ($${dailyMinimum}/day × ${scheduledDays} days)`;

  return {
    valid,
    minimumBudget,
    dailyMinimum,
    scheduledDays,
    errorMessage: valid ? null : `Budget must be at least $${minimumBudget} for the selected platforms and schedule`,
    helperMessage,
  };
}
