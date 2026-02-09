/**
 * Temporal Auth - Hardcoded Users
 *
 * This is a TEMPORARY solution for the in-house integration.
 * All users belong to the "PijamaFilms" producer.
 *
 * TODO: Replace with proper Pijama API authentication
 */

export interface TemporalUser {
  email: string;
  password: string;
  name: string;
  partnerId: string;
}

// Hardcoded whitelist of users for PijamaFilms
// All users have access to all films as special partner
export const TEMPORAL_USERS: TemporalUser[] = [
  {
    email: 'admin@pijamafilms.com',
    password: 'pijama2026',
    name: 'Administrator',
    partnerId: 'pijamafilms',
  },
  {
    email: 'producer1@pijamafilms.com',
    password: 'pijama2026',
    name: 'Producer 1',
    partnerId: 'pijamafilms',
  },
  {
    email: 'producer2@pijamafilms.com',
    password: 'pijama2026',
    name: 'Producer 2',
    partnerId: 'pijamafilms',
  },
];

/**
 * Validate user credentials against the whitelist
 */
export function validateCredentials(
  email: string,
  password: string
): TemporalUser | null {
  const user = TEMPORAL_USERS.find(
    (u) => u.email === email && u.password === password
  );
  return user || null;
}

/**
 * Get user by email (without password validation)
 */
export function getUserByEmail(email: string): TemporalUser | null {
  return TEMPORAL_USERS.find((u) => u.email === email) || null;
}
