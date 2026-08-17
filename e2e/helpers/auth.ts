import { type Browser, type BrowserContext, type Page, request } from '@playwright/test';

interface AuthUser {
  email: string;
  password: string;
}

/**
 * E2E credentials come from the environment - never hardcode them. Point these
 * at throwaway users in a Firebase test project, provisioned with
 * `scripts/firebase-provision-user.ts`.
 */
function envUser(prefix: string): AuthUser {
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];

  if (!email || !password) {
    throw new Error(`Missing ${prefix}_EMAIL / ${prefix}_PASSWORD for e2e tests`);
  }

  return { email, password };
}

export const TEST_USERS = {
  get admin() {
    return envUser('E2E_ADMIN');
  },
  get producer1() {
    return envUser('E2E_PRODUCER1');
  },
  get producer2() {
    return envUser('E2E_PRODUCER2');
  },
} as const;

const BASE_URL = 'http://localhost:3000';

/**
 * Sign in against Firebase Auth, then exchange the ID token for our session
 * cookie - the same two-step flow the login page performs.
 */
export async function getSessionCookie(user: AuthUser): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

  if (!apiKey) {
    throw new Error('NEXT_PUBLIC_FIREBASE_API_KEY is required for e2e tests');
  }

  const apiContext = await request.newContext({ baseURL: BASE_URL });

  const firebaseRes = await apiContext.post(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      data: {
        email: user.email,
        password: user.password,
        returnSecureToken: true,
      },
    }
  );

  if (!firebaseRes.ok()) {
    throw new Error(
      `Firebase sign-in failed for ${user.email}: ${firebaseRes.status()}`
    );
  }

  const { idToken } = (await firebaseRes.json()) as { idToken: string };

  const response = await apiContext.post('/api/auth/login', {
    data: { idToken },
  });

  if (!response.ok()) {
    throw new Error(`Login failed for ${user.email}: ${response.status()}`);
  }

  const cookies = response.headersArray()
    .filter(h => h.name.toLowerCase() === 'set-cookie')
    .map(h => h.value);

  const sessionCookie = cookies.find(c => c.startsWith('pijama-session='));

  if (!sessionCookie) {
    throw new Error('No pijama-session cookie in login response');
  }

  const value = sessionCookie.split('=')[1].split(';')[0];
  await apiContext.dispose();
  return value;
}

/**
 * Create an authenticated browser context with the session cookie
 */
export async function authenticatedContext(
  browser: Browser,
  user: AuthUser = TEST_USERS.admin,
): Promise<{ context: BrowserContext; page: Page }> {
  const sessionValue = await getSessionCookie(user);

  const context = await browser.newContext({
    storageState: {
      cookies: [{
        name: 'pijama-session',
        value: sessionValue,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
        expires: Date.now() / 1000 + 60 * 60 * 24 * 7,
      }],
      origins: [],
    },
  });

  const page = await context.newPage();
  return { context, page };
}
