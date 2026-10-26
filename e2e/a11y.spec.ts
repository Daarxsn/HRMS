import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function signInDev(page: any, account: 'employee' | 'superadmin' | 'admin') {
  const email = account === 'employee' ? 'aarav.mehta@example.test' : 'om.admin@example.test';
  const apiBase = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:3001/api';
  const response = await page.request.post(`${apiBase}/auth/demo`, { data: { email } });
  expect(response.ok()).toBeTruthy();
  await page.goto('/');
}

function createAxeScanner(page: any) {
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules(['color-contrast', 'scrollable-region-focusable']);
}

test.describe('Automated Accessibility (A11y) Regression Suite - WCAG 2.1 AA', () => {

  test('login page meets WCAG 2.1 AA accessibility standards in light and dark mode', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /Welcome in/i })).toBeVisible();

    // Scan Light Mode
    const lightScan = await createAxeScanner(page).analyze();
    expect(lightScan.violations).toEqual([]);

    // Switch to Dark Mode and Scan
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    const darkScan = await createAxeScanner(page).analyze();
    expect(darkScan.violations).toEqual([]);
  });

  test('employee action center meets WCAG 2.1 AA accessibility standards', async ({ page }) => {
    await signInDev(page, 'employee');
    await expect(page.getByText('What needs your attention')).toBeVisible();

    const scan = await createAxeScanner(page).analyze();
    expect(scan.violations).toEqual([]);
  });

  test('attendance overview and punch controls meet WCAG 2.1 AA standards', async ({ page }) => {
    await signInDev(page, 'employee');
    await page.goto('/attendance');
    await expect(page.getByRole('heading', { name: 'Attendance', exact: true })).toBeVisible();

    const scan = await createAxeScanner(page).analyze();
    expect(scan.violations).toEqual([]);
  });

  test('leave request form, balance cards, and history meet WCAG 2.1 AA standards', async ({ page }) => {
    await signInDev(page, 'employee');
    await page.goto('/leave');
    await expect(page.getByRole('heading', { name: 'Leave & time off', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Request time off', exact: true })).toBeVisible();

    const scan = await createAxeScanner(page).analyze();
    expect(scan.violations).toEqual([]);
  });

  test('holiday calendar page meets WCAG 2.1 AA standards across themes', async ({ page }) => {
    await signInDev(page, 'employee');
    await page.goto('/calendar');
    await expect(page.getByRole('heading', { name: /Holiday calendar/i })).toBeVisible();

    const lightScan = await createAxeScanner(page).analyze();
    expect(lightScan.violations).toEqual([]);

    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    const darkScan = await createAxeScanner(page).analyze();
    expect(darkScan.violations).toEqual([]);
  });

  test('employee profile and credentials meet WCAG 2.1 AA standards', async ({ page }) => {
    await signInDev(page, 'employee');
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'My profile', exact: true })).toBeVisible();

    const scan = await createAxeScanner(page).analyze();
    expect(scan.violations).toEqual([]);
  });

  test('policy center catalog meets WCAG 2.1 AA standards', async ({ page }) => {
    await signInDev(page, 'employee');
    await page.goto('/policies');
    await expect(page.getByRole('heading', { name: /Policies that stay clear/i })).toBeVisible();

    const scan = await createAxeScanner(page).analyze();
    expect(scan.violations).toEqual([]);
  });

  test('admin workplace pulse meets WCAG 2.1 AA standards', async ({ page }) => {
    await signInDev(page, 'superadmin');
    await expect(page.getByText('Workplace pulse')).toBeVisible();

    const scan = await createAxeScanner(page).analyze();
    expect(scan.violations).toEqual([]);
  });

  test('admin people directory and tier controls meet WCAG 2.1 AA standards', async ({ page }) => {
    await signInDev(page, 'superadmin');
    await page.goto('/admin/team');
    await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible();
    await expect(page.locator('.people-table-card')).toBeVisible();

    const scan = await createAxeScanner(page).analyze();
    expect(scan.violations).toEqual([]);
  });

  test('admin requests review queue meets WCAG 2.1 AA standards', async ({ page }) => {
    await signInDev(page, 'superadmin');
    await page.goto('/admin/approvals');
    await expect(page.getByRole('heading', { name: 'Requests', exact: true })).toBeVisible();
    await expect(page.locator('.approval-workspace')).toBeVisible();

    const scan = await createAxeScanner(page).analyze();
    expect(scan.violations).toEqual([]);
  });

  test('admin office settings and policy governance meet WCAG 2.1 AA standards', async ({ page }) => {
    await signInDev(page, 'superadmin');
    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { name: 'Office settings', exact: true })).toBeVisible();

    const scan = await createAxeScanner(page).analyze();
    expect(scan.violations).toEqual([]);
  });

  test('admin audit trail and filter controls meet WCAG 2.1 AA standards', async ({ page }) => {
    await signInDev(page, 'superadmin');
    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { name: 'Audit trail', exact: true })).toBeVisible();

    const scan = await createAxeScanner(page).analyze();
    expect(scan.violations).toEqual([]);
  });

});
