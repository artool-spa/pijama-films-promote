# Playwright E2E Testing Guidelines

## Overview

Guidelines for writing end-to-end tests using Playwright in the Pijama Films platform. E2E tests validate full user flows by driving a real Chromium browser against the running dev server.

## Test Structure

### File Organization
```
e2e/
  helpers/
    auth.ts           # Auth helper (login via API, cookie injection)
    fixtures.ts       # Custom test fixtures with authenticated page
  smoke.spec.ts       # Basic smoke tests
  films.spec.ts       # Film management flows
  campaigns.spec.ts   # Campaign flows
```

### Naming Convention
- Test files: `[feature].spec.ts`
- Descriptive test names in English

## Authentication

All dashboard pages require authentication. The auth helper logs in via `POST /api/auth/login` and injects the `pijama-session` JWT cookie into a Playwright browser context.

### Using the `authedPage` Fixture

✅ CORRECT: Use the custom fixture for authenticated pages
```typescript
import { test, expect } from './helpers/fixtures';

test('should list films', async ({ authedPage }) => {
  await authedPage.goto('/films');
  await expect(authedPage.locator('h1')).toContainText('Films');
});
```

❌ WRONG: Manual cookie setup in individual tests
```typescript
test('should list films', async ({ page }) => {
  await page.context().addCookies([{ name: 'pijama-session', value: '...' }]);
});
```

### Available Test Users
- `TEST_USERS.admin` — admin@pijamafilms.com (default for `authedPage`)
- `TEST_USERS.producer1` — producer1@pijamafilms.com
- `TEST_USERS.producer2` — producer2@pijamafilms.com
- All use password: `pijama2026`

### Using a Specific User
```typescript
import { test } from './helpers/fixtures';
import { authenticatedContext, TEST_USERS } from './helpers/auth';

test('producer-specific test', async ({ browser }) => {
  const { context, page } = await authenticatedContext(browser, TEST_USERS.producer1);
  await page.goto('/films');
  // ... assertions
  await context.close();
});
```

## Writing E2E Tests

### Page Navigation
```typescript
test('navigate to film detail', async ({ authedPage }) => {
  await authedPage.goto('/films');
  await authedPage.getByRole('link', { name: /film title/i }).click();
  await expect(authedPage).toHaveURL(/\/films\/.+/);
});
```

### Form Interaction
```typescript
test('create a campaign', async ({ authedPage }) => {
  await authedPage.goto('/campaigns/new');
  await authedPage.getByLabel('Campaign Name').fill('Test Campaign');
  await authedPage.getByRole('button', { name: /create/i }).click();
  await expect(authedPage.locator('.MuiAlert-message')).toContainText('created');
});
```

### MUI Component Selectors
- ✅ `getByRole('button', { name: /submit/i })` — ARIA roles
- ✅ `getByLabel('Campaign Name')` — form field labels
- ✅ `getByText('Films')` — visible text content
- ❌ `.MuiButton-root` — MUI CSS classes change across versions

### Screenshots for Debugging
```typescript
test('capture page state', async ({ authedPage }) => {
  await authedPage.goto('/films');
  await authedPage.screenshot({ path: 'screenshots/films.png', fullPage: true });
});
```

## Running E2E Tests

```bash
yarn e2e              # Run all E2E tests (headless)
yarn e2e:headed       # Run with visible browser
yarn e2e:ui           # Interactive Playwright UI mode
yarn e2e:debug        # Debug mode with Playwright inspector
```

The dev server must be running on port 3000. The `webServer` config in `playwright.config.ts` starts it automatically if not already running.

## Key Rules

1. ✅ Always use the `authedPage` fixture for authenticated pages
2. ✅ Use `TEST_USERS` from `e2e/helpers/auth.ts` — never hardcode credentials in tests
3. ✅ Use Playwright locators (`getByRole`, `getByLabel`, `getByText`) not CSS selectors
4. ✅ Keep tests independent — no shared state between tests
5. ✅ Group related tests with `test.describe`
6. ✅ Clean up contexts: call `context.close()` when using `authenticatedContext` directly
7. ✅ Only Chromium is configured — this is a dev/navigation tool, not cross-browser CI
