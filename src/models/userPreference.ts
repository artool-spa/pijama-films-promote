import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { COLLECTIONS, IdSchema, docData } from '@/lib/firestore';

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const EmailSchema = z.string().email();

export const UserPreferenceSchema = z.object({
  id: IdSchema,
  email: z.string().email(),
  howItWorksDismissed: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type UserPreference = z.infer<typeof UserPreferenceSchema>;

// The email is the document id: it was the unique key under Postgres, and
// Firestore expresses uniqueness through the id.
function docRef(email: string) {
  return adminDb().collection(COLLECTIONS.userPreferences).doc(email);
}

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

/**
 * Get user preference by email
 */
export async function getUserPreference(email: string): Promise<UserPreference | null> {
  const validEmail = EmailSchema.parse(email);

  const snap = await docRef(validEmail).get();
  const result = docData(snap);

  if (!result) return null;

  return UserPreferenceSchema.parse(result);
}

// ============================================================================
// MUTATION FUNCTIONS
// ============================================================================

/**
 * Dismiss "How it Works" modal for a user
 *
 * Upsert: the transaction keeps `createdAt` from the original document instead
 * of resetting it on every dismissal.
 */
export async function dismissHowItWorks(email: string): Promise<UserPreference> {
  const validEmail = EmailSchema.parse(email);
  const ref = docRef(validEmail);
  const now = new Date();

  const written = await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = docData(snap);

    const data = {
      email: validEmail,
      howItWorksDismissed: true,
      createdAt: (existing?.createdAt as Date | undefined) ?? now,
      updatedAt: now,
    };

    tx.set(ref, data, { merge: true });

    return { id: validEmail, ...data };
  });

  return UserPreferenceSchema.parse(written);
}
