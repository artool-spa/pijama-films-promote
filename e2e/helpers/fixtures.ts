import { test as base, type Page } from '@playwright/test';
import { authenticatedContext, TEST_USERS } from './auth';

type AuthFixtures = {
  authedPage: Page;
};

export const test = base.extend<AuthFixtures>({
  authedPage: async ({ browser }, use) => {
    const { context, page } = await authenticatedContext(browser, TEST_USERS.admin);
    await use(page);
    await context.close();
  },
});

export { expect } from '@playwright/test';
