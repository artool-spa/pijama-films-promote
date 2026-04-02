import { type Browser, type BrowserContext, type Page, request } from '@playwright/test';

interface AuthUser {
  email: string;
  password: string;
}

export const TEST_USERS = {
  admin: { email: 'admin@pijamafilms.com', password: 'pijama2026' },
  producer1: { email: 'producer1@pijamafilms.com', password: 'pijama2026' },
  producer2: { email: 'producer2@pijamafilms.com', password: 'pijama2026' },
} as const;

const BASE_URL = 'http://localhost:3000';

/**
 * Login via API and return the session cookie value
 */
export async function getSessionCookie(user: AuthUser): Promise<string> {
  const apiContext = await request.newContext({ baseURL: BASE_URL });
  const response = await apiContext.post('/api/auth/login', {
    data: { email: user.email, password: user.password },
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
