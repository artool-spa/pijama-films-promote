import prisma from '#prisma';
import { z } from 'zod';

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const EmailSchema = z.string().email();

export const UserPreferenceSchema = z.object({
  id: z.string().cuid(),
  email: z.string().email(),
  howItWorksDismissed: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type UserPreference = z.infer<typeof UserPreferenceSchema>;

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

/**
 * Get user preference by email
 */
export async function getUserPreference(email: string): Promise<UserPreference | null> {
  const validEmail = EmailSchema.parse(email);

  const result = await prisma.userPreference.findUnique({
    where: { email: validEmail },
  });

  if (!result) return null;

  return UserPreferenceSchema.parse(result);
}

// ============================================================================
// MUTATION FUNCTIONS
// ============================================================================

/**
 * Dismiss "How it Works" modal for a user
 */
export async function dismissHowItWorks(email: string): Promise<UserPreference> {
  const validEmail = EmailSchema.parse(email);

  const result = await prisma.userPreference.upsert({
    where: { email: validEmail },
    update: { howItWorksDismissed: true },
    create: { email: validEmail, howItWorksDismissed: true },
  });

  return UserPreferenceSchema.parse(result);
}
