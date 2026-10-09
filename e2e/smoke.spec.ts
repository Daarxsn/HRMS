import { test, expect } from '@playwright/test';

async function signInDev(page: any, account: 'employee' | 'admin') {
  const email = account === 'admin' ? 'om.admin@example.test' : 'aarav.mehta@example.test';
  const apiBase = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:3001/api';
  const response = await page.request.post(`${apiBase}/auth/demo`, { data: { email } });
  expect(response.ok()).toBeTruthy();
  await page.goto('/');
}

test('employee can sign in and reach the action center', async ({ page }) => {
  await signInDev(page, 'employee');
  await expect(page.getByText('What needs your attention')).toBeVisible();
  await expect(page.getByRole('link', { name: /Attendance/i }).first()).toBeVisible();
});

test('administrator can sign in and reach workplace pulse', async ({ page }) => {
  await signInDev(page, 'admin');
  await expect(page.getByText('Workplace pulse')).toBeVisible();
  await expect(page.getByRole('complementary').getByRole('link', { name: 'Reports', exact: true })).toBeVisible();
});

test('mobile navigation opens and remains usable', async ({ page }, testInfo) => {
  testInfo.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile navigation is only rendered at mobile viewport widths.');
  await signInDev(page, 'employee');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('button', { name: 'Close menu' })).toBeVisible();
  await expect(page.locator('nav.main-nav').getByRole('link', { name: 'Attendance', exact: true })).toBeVisible();
});
