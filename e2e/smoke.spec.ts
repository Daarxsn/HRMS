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

test('profile and calendar surfaces remain readable when switching themes', async ({ page }) => {
  await signInDev(page, 'employee');

  const themeToggle = page.getByRole('button', { name: 'Switch to dark mode' });
  await themeToggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('link', { name: 'My profile', exact: true }).first().click();
  const profileCell = page.locator('.profile-info-grid > div').first();
  await expect(profileCell).toBeVisible();
  const darkProfile = await profileCell.evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    color: getComputedStyle(el.querySelector('b') || el).color
  }));
  expect(darkProfile.background).not.toBe('rgb(255, 255, 255)');
  expect(darkProfile.color).not.toBe('rgb(17, 17, 17)');
  expect(darkProfile.color).not.toBe('rgb(0, 0, 0)');

  await page.getByRole('link', { name: 'Holiday calendar', exact: true }).click();
  const calendarCell = page.locator('.calendar-day:not(.calendar-day-empty):not(.calendar-today)').first();
  await expect(calendarCell).toBeVisible();
  const darkCalendar = await calendarCell.evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    color: getComputedStyle(el.querySelector('b') || el).color
  }));
  expect(darkCalendar.background).not.toBe('rgb(255, 255, 255)');
  expect(darkCalendar.color).not.toBe('rgb(17, 17, 17)');
  expect(darkCalendar.color).not.toBe('rgb(0, 0, 0)');

  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const lightCalendar = await calendarCell.evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    color: getComputedStyle(el.querySelector('b') || el).color
  }));
  expect(lightCalendar.background).toBe('rgb(255, 255, 255)');
  expect(lightCalendar.color).not.toBe('rgb(255, 255, 255)');
});
