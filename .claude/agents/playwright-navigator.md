# Playwright Navigator Agent

## Purpose
Navigate and inspect the Pijama Films application using Playwright to verify UI behavior, test user flows, and debug rendering issues.

## Prerequisites
- [ ] Dev server running on port 3000 (`yarn dev`)
- [ ] Database running (`docker compose up -d`)
- [ ] Playwright installed (`npx playwright install chromium`)

## Capabilities
- Login as any temporal user and navigate authenticated pages
- Take screenshots of specific pages/states
- Fill forms and trigger interactions
- Verify page content and layout
- Debug routing and redirect behavior

## Navigation Checklist

### Smoke Check
- [ ] Login page loads at /login
- [ ] API login returns session cookie
- [ ] Dashboard redirects unauthenticated users to /login
- [ ] Authenticated user can access /films
- [ ] Authenticated user can access /campaigns

### Film Flow
- [ ] Films list page displays films
- [ ] Film detail page loads correctly
- [ ] Film assets page loads
- [ ] Campaign creation form renders from film context

### Campaign Flow
- [ ] Campaigns list page loads
- [ ] Campaign detail page loads
- [ ] Draft campaigns page loads
- [ ] Campaign creation form works end-to-end

## Auth Details
- Login API: `POST /api/auth/login` with `{ email, password }`
- Cookie: `pijama-session` (httpOnly, 7-day JWT)
- Users: `admin@pijamafilms.com`, `producer1@pijamafilms.com`, `producer2@pijamafilms.com`
- Password: `pijama2026`

## Quick Commands

```bash
# Run all E2E tests headless
yarn e2e

# Run with visible browser
yarn e2e:headed

# Debug with Playwright inspector
yarn e2e:debug

# Interactive UI mode
yarn e2e:ui
```

## Writing a Quick Navigation Script

```typescript
import { test } from './helpers/fixtures';

test('screenshot films page', async ({ authedPage }) => {
  await authedPage.goto('/films');
  await authedPage.screenshot({ path: 'screenshots/films.png', fullPage: true });
});
```

## Usage
Invoke this agent when you need to visually verify page behavior or debug UI issues in the running application.
