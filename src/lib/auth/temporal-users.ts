/**
 * Temporal Auth - Hardcoded Users
 *
 * This is a TEMPORARY solution for the in-house integration.
 * All users belong to the "PijamaFilms" producer.
 *
 * TODO: Replace with proper Pijama API authentication
 */

export interface TemporalUser {
  username: string;
  password: string;
  name: string;
  partnerId: string;
}

// Hardcoded whitelist of users for PijamaFilms
// All users have access to all films as special partner
export const TEMPORAL_USERS: TemporalUser[] = [
  {
    username: 'admin',
    password: 'pijama2026',
    name: 'Administrator',
    partnerId: 'pijamafilms',
  },
  {
    username: 'producer1',
    password: 'pijama2026',
    name: 'Producer 1',
    partnerId: 'pijamafilms',
  },
  {
    username: 'producer2',
    password: 'pijama2026',
    name: 'Producer 2',
    partnerId: 'pijamafilms',
  },
];

/**
 * Validate user credentials against the whitelist
 */
export function validateCredentials(
  username: string,
  password: string
): TemporalUser | null {
  const user = TEMPORAL_USERS.find(
    (u) => u.username === username && u.password === password
  );
  return user || null;
}

/**
 * Get user by username (without password validation)
 */
export function getUserByUsername(username: string): TemporalUser | null {
  return TEMPORAL_USERS.find((u) => u.username === username) || null;
}
