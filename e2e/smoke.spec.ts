import { test, expect } from './helpers/fixtures';

test.describe('Dashboard smoke test', () => {
  test('should access films page when authenticated', async ({ authedPage }) => {
    await authedPage.goto('/films');
    await expect(authedPage).toHaveURL(/\/films/);
    await expect(authedPage.locator('body')).not.toContainText('Log in');
  });

  test('should redirect to login when not authenticated', async ({ page }) => {
    await page.goto('/films');
    await expect(page).toHaveURL(/\/login/);
  });
});
