import { test, expect } from '@playwright/test';

async function signInDemo(page: any, account: 'employee' | 'admin') {
  await page.goto('/');
  const select = page.getByLabel('Choose an account');
  await expect(select).toBeVisible({ timeout: 15000 });
  const options = await select.locator('option').allTextContents();
  const target = options.find((value) =>
    account === 'admin'
      ? value.startsWith('Admin ·')
      : !value.startsWith('Admin ·') && value.includes('Aarav Mehta')
  );
  if (!target) throw new Error(`Could not find ${account} demo account.`);
  await select.selectOption({ label: target });
  await page.getByRole('button', { name: /Continue to preview/i }).click();
}

test('employee can sign in and reach the action center', async ({ page }) => {
  await signInDemo(page, 'employee');
  await expect(page.getByText('What needs your attention')).toBeVisible();
  await expect(page.getByRole('link', { name: /Attendance/i }).first()).toBeVisible();
});

test('administrator can sign in and reach workplace pulse', async ({ page }) => {
  await signInDemo(page, 'admin');
  await expect(page.getByText('Workplace pulse')).toBeVisible();
  await expect(page.getByRole('link', { name: /Reports/i })).toBeVisible();
});

test('mobile navigation opens and remains usable', async ({ page }, testInfo) => {
  testInfo.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile navigation is only rendered at mobile viewport widths.');
  await signInDemo(page, 'employee');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('button', { name: 'Close menu' })).toBeVisible();
  await expect(page.locator('nav.main-nav').getByRole('link', { name: 'Attendance', exact: true })).toBeVisible();
});
