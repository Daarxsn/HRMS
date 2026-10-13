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


test('policy center loads with a useful empty or published state', async ({ page }) => {
  await signInDev(page, 'employee');
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/enterprise/policies') && response.request().method() === 'GET'
  );
  await openSidebarLink(page, 'Policy center');
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Policies that stay clear.' })).toBeVisible();
  await expect(page.locator('.employee-policies-panel')).toBeVisible();
  await expect(page.locator('.employee-policy-error')).toHaveCount(0);
  await expect(page.locator('.employee-policy-card, .employee-policy-empty')).not.toHaveCount(0);
});


test('employee portal pages remain navigable and display useful states', async ({ page }) => {
  await signInDev(page, 'employee');
  await expect(page.getByText('What needs your attention')).toBeVisible();

  await openSidebarLink(page, 'Attendance');
  await expect(page.getByRole('heading', { name: 'Attendance', exact: true })).toBeVisible();
  await expect(page.locator('.attendance-overview-card')).toBeVisible();

  await openSidebarLink(page, 'Leave & time off');
  await expect(page.getByRole('heading', { name: 'Leave & time off', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Request time off', exact: true })).toBeVisible();

  // WFH navigation is intentionally hidden for users whose administrator has not enabled it.
  // Direct navigation lets this test verify the disabled state without assuming eligibility.
  await page.goto('/wfh');
  await expect(page.getByRole('heading', { name: 'Work from home', exact: true })).toBeVisible();
  await expect(page.locator('.wfh-banner')).toBeVisible();

  await openSidebarLink(page, 'Out of office');
  await expect(page.getByRole('heading', { name: 'Out of office', exact: true })).toBeVisible();
  await expect(page.locator('.out-layout')).toBeVisible();

  await openSidebarLink(page, 'Notifications');
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
  await expect(page.locator('.notification-page-summary')).toBeVisible();
  await expect(page.locator('.employee-page-error')).toHaveCount(0);
});

test('WFH access outage offers retry instead of claiming access is disabled', async ({ page }) => {
  await signInDev(page, 'employee');
  await page.route('**/api/wfh', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Test service unavailable', requestId: 'phase3-wfh-test' })
    });
  });

  // This nav item is omitted when WFH is not enabled for the account; test the route directly.
  await page.goto('/wfh');
  await expect(page.getByText('We couldn’t verify WFH access.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry access check' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Not enabled for this account' })).toHaveCount(0);
});


test('GPS check-in distinguishes unavailable location from denied permission', async ({ page }) => {
  await page.addInitScript(() => {
    const geolocation = {
      watchPosition(_success: unknown, error: (failure: { code: number; message: string }) => void) {
        window.setTimeout(() => error({ code: 2, message: 'Position unavailable' }), 25);
        return 1;
      },
      clearWatch() {},
      getCurrentPosition(_success: unknown, error: (failure: { code: number; message: string }) => void) {
        window.setTimeout(() => error({ code: 2, message: 'Position unavailable' }), 25);
      }
    };
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geolocation });
  });

  let attendancePostAttempted = false;
  await page.route('**/api/attendance/check-in', async (route) => {
    attendancePostAttempted = true;
    await route.continue();
  });
  await signInDev(page, 'employee');
  await page.locator('.overview-attendance-card').getByRole('button', { name: 'Check in' }).click();
  await expect(page.getByText(/Chrome could not determine your Mac’s location for office check-in/i)).toBeVisible();
  await expect(page.getByText(/open Site settings.*set Location to Allow/i)).toHaveCount(0);
  expect(attendancePostAttempted).toBe(false);
});


test('administrator operational pages load and keep the main actions accessible', async ({ page }) => {
  await signInDev(page, 'admin');
  await expect(page.getByText('Workplace pulse')).toBeVisible();

  await openSidebarLink(page, 'People');
  await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible();
  await expect(page.locator('.people-table-card')).toBeVisible();

  await openSidebarLink(page, 'Attendance');
  await expect(page.getByRole('heading', { name: 'Attendance', exact: true })).toBeVisible();
  await expect(page.locator('.admin-attendance-card')).toBeVisible();

  await openSidebarLink(page, 'Requests');
  await expect(page.getByRole('heading', { name: 'Requests', exact: true })).toBeVisible();
  await expect(page.locator('.approval-workspace')).toBeVisible();

  await openSidebarLink(page, 'Reports');
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
  await expect(page.locator('.report-filter-card')).toBeVisible();

  await openSidebarLink(page, 'Office settings');
  await expect(page.getByRole('heading', { name: 'Office settings', exact: true })).toBeVisible();
  await expect(page.locator('.settings-layout, .admin-empty-recovery')).toBeVisible();

  await openSidebarLink(page, 'Audit trail');
  await expect(page.getByRole('heading', { name: 'Audit trail', exact: true })).toBeVisible();
  await expect(page.locator('.audit-table-card')).toBeVisible();
});
