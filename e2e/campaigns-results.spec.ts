import { test, expect } from './helpers/fixtures';

test.describe('Campaign results verification', () => {
  test('campaign detail shows Finished status, pre-filled dates, and metrics', async ({ authedPage }) => {
    await authedPage.goto('/films/a939ac9caba041fd8f598139820d45be/campaigns/cmmzax9uy000hpd0144kkunrj');
    await authedPage.waitForTimeout(4000);
    await authedPage.screenshot({ path: '/tmp/campaign-detail.png', fullPage: true });

    // Status should be "Finished"
    await expect(authedPage.getByText('Finished')).toBeVisible();

    // Period date pickers should be pre-filled
    const startInput = authedPage.locator('input[type="date"]').first();
    await expect(startInput).not.toHaveValue('');

    // Metrics should be visible
    await expect(authedPage.getByText('Resumen general')).toBeVisible();
    await expect(authedPage.getByText('Resultados por plataforma')).toBeVisible();
  });

  test('film campaigns list shows metrics summary', async ({ authedPage }) => {
    await authedPage.goto('/films/a939ac9caba041fd8f598139820d45be/campaigns');
    await authedPage.waitForTimeout(5000);
    await authedPage.screenshot({ path: '/tmp/film-campaigns.png', fullPage: true });

    // Period dates should be pre-filled
    const startInput = authedPage.locator('input[type="date"]').first();
    await expect(startInput).not.toHaveValue('');

    // Summary metrics should show real data
    await expect(authedPage.getByText('Impressions')).toBeVisible();
    await expect(authedPage.getByText('Clicks')).toBeVisible();
    await expect(authedPage.getByText('CTR')).toBeVisible();
    await expect(authedPage.getByText('Spend')).toBeVisible();

    // Campaigns should show Finished status
    await expect(authedPage.getByText('Finished').first()).toBeVisible();
  });

  test('global results page shows aggregate metrics', async ({ authedPage }) => {
    await authedPage.goto('/campaigns');
    await authedPage.waitForTimeout(5000);
    await authedPage.screenshot({ path: '/tmp/results-page.png', fullPage: true });

    // Period dates should be pre-filled
    const startInput = authedPage.locator('input[type="date"]').first();
    await expect(startInput).not.toHaveValue('');

    // Campaign Summary with live metrics
    await expect(authedPage.getByText('Campaign Summary')).toBeVisible();
    await expect(authedPage.getByText('Impressions')).toBeVisible();
    await expect(authedPage.getByText('Total Spend')).toBeVisible();
  });
});
