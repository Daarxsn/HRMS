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

async function openSidebarLink(page: any, name: string) {
  const openNav = page.getByRole('button', { name: 'Open navigation' });
  if (await openNav.isVisible()) await openNav.click();
  await page.locator('.sidebar').getByRole('link', { name, exact: true }).click();
}

test('profile and calendar surfaces remain readable when switching themes', async ({ page }) => {
  await signInDev(page, 'employee');

  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await openSidebarLink(page, 'My profile');
  const profileCell = page.locator('.profile-info-grid > div').first();
  await expect(profileCell).toBeVisible();
  await expect(profileCell).toHaveCSS('background-color', 'rgb(27, 27, 27)');
  const darkProfile = await profileCell.evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    color: getComputedStyle(el.querySelector('b') || el).color
  }));
  expect(darkProfile.background).toBe('rgb(27, 27, 27)');
  expect(darkProfile.color).toBe('rgb(255, 255, 255)');

  await openSidebarLink(page, 'Holiday calendar');
  const calendarCell = page.locator('.calendar-day:not(.calendar-day-empty):not(.calendar-today)').first();
  await expect(calendarCell).toBeVisible();
  await expect(calendarCell).toHaveCSS('background-color', 'rgb(27, 27, 27)');
  await expect(calendarCell.locator('b')).toHaveCSS('color', 'rgb(199, 199, 199)');
  const darkCalendar = await calendarCell.evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    color: getComputedStyle(el.querySelector('b') || el).color
  }));
  expect(darkCalendar.background).toBe('rgb(27, 27, 27)');
  expect(darkCalendar.color).toBe('rgb(199, 199, 199)');

  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  /* Theme changes animate surfaces briefly; assert the settled state, not an intermediate frame. */
  await expect(calendarCell).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(calendarCell.locator('b')).toHaveCSS('color', 'rgb(85, 85, 85)');
  const lightCalendar = await calendarCell.evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    color: getComputedStyle(el.querySelector('b') || el).color
  }));
  expect(lightCalendar.background).toBe('rgb(255, 255, 255)');
  expect(lightCalendar.color).toBe('rgb(85, 85, 85)');

  await openSidebarLink(page, 'My profile');
  const lightProfileCell = page.locator('.profile-info-grid > div').first();
  await expect(lightProfileCell).toBeVisible();
  await expect(lightProfileCell).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(lightProfileCell.locator('b')).toHaveCSS('color', 'rgb(17, 17, 17)');
  const lightProfile = await lightProfileCell.evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    color: getComputedStyle(el.querySelector('b') || el).color
  }));
  expect(lightProfile.background).toBe('rgb(255, 255, 255)');
  expect(lightProfile.color).toBe('rgb(17, 17, 17)');
});
