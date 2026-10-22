import { test, expect } from '@playwright/test';

async function signInDev(page: any, account: 'employee' | 'admin') {
  const email = account === 'admin' ? 'om.admin@example.test' : 'aarav.mehta@example.test';
  const apiBase = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:3001/api';
  const response = await page.request.post(`${apiBase}/auth/demo`, { data: { email } });
  expect(response.ok()).toBeTruthy();
  await page.goto('/');
}

test('login reference composition is measured and captured on desktop', async ({ page }, testInfo) => {
  testInfo.skip(testInfo.project.name !== 'chromium', 'Reference-sized screenshot is captured in desktop Chromium.');
  await page.setViewportSize({ width: 1536, height: 878 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /THE WORKPLACE BUILDS PEOPLE\./i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible();
  await expect(page.locator('.login-feature')).toHaveCount(3);
  await expect(page.locator('.login-auth-card')).toBeVisible();
  await expect(page.locator('.login-art-footer')).toContainText('CULTURE TODAY. STRONGER TOMORROW.');
  await expect(page.locator('.login-panel-inner .login-trust')).toHaveCount(0);
  const desktopTrustBox = await page.locator('.login-trust').boundingBox();
  const desktopFooterBox = await page.locator('.login-footer').boundingBox();
  expect(desktopTrustBox).not.toBeNull();
  expect(desktopFooterBox).not.toBeNull();
  expect(desktopFooterBox!.y).toBeGreaterThanOrEqual(desktopTrustBox!.y + desktopTrustBox!.height - 1);
  const desktopBackground = await page.locator('.login-art').evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(desktopBackground).toContain('login-architectural-scene.webp');
  await expect(page.locator('.fx-architectural-scene')).toHaveCount(0);
  await expect(page.locator('.art-orbit')).toHaveCount(0);
  expect(await page.locator('.login-feature').first().evaluate(el => getComputedStyle(el, '::after').content)).toBe('none');
  const geometry = await page.locator('.login-page').evaluate((root) => {
    const page = root.getBoundingClientRect();
    const art = root.querySelector('.login-art')!.getBoundingClientRect();
    const panel = root.querySelector('.login-panel')!.getBoundingClientRect();
    const card = root.querySelector('.login-panel-inner')!.getBoundingClientRect();
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      page: { width: page.width, height: page.height },
      art: { x: art.x, width: art.width, height: art.height },
      panel: { x: panel.x, width: panel.width, height: panel.height },
      card: { x: card.x, y: card.y, width: card.width, height: card.height },
      overflowX: document.documentElement.scrollWidth > window.innerWidth
    };
  });
  expect(geometry.art.width / geometry.page.width).toBeGreaterThan(0.57);
  expect(geometry.art.width / geometry.page.width).toBeLessThan(0.62);
  expect(geometry.panel.x).toBeGreaterThan(geometry.art.width - 1);
  expect(geometry.art.height).toBe(878);
  expect(geometry.overflowX).toBe(false);
  await testInfo.attach('login-reference-desktop-1536x878.png', {
    body: await page.screenshot({ fullPage: true, animations: 'disabled' }),
    contentType: 'image/png'
  });
  await testInfo.attach('login-reference-desktop-geometry.json', {
    body: Buffer.from(JSON.stringify(geometry, null, 2)),
    contentType: 'application/json'
  });
});

test('login reference composition is captured and readable on mobile', async ({ page }, testInfo) => {
  testInfo.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile reference screenshot is captured in mobile Chromium.');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /THE WORKPLACE BUILDS PEOPLE\./i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible();
  await expect(page.locator('.login-feature')).toHaveCount(3);
  await expect(page.locator('.login-auth-card')).toBeVisible();
  await expect(page.locator('.login-panel-inner .login-trust')).toHaveCount(0);
  const mobileTrustBox = await page.locator('.login-trust').boundingBox();
  const mobileFooterBox = await page.locator('.login-footer').boundingBox();
  expect(mobileTrustBox).not.toBeNull();
  expect(mobileFooterBox).not.toBeNull();
  expect(mobileFooterBox!.y).toBeGreaterThanOrEqual(mobileTrustBox!.y + mobileTrustBox!.height - 1);
  const mobileBackground = await page.locator('.login-art').evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(mobileBackground).toContain('login-architectural-scene.webp');
  await expect(page.locator('.fx-architectural-scene')).toHaveCount(0);
  await expect(page.locator('.art-orbit')).toHaveCount(0);
  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
    artHeight: document.querySelector('.login-art')!.getBoundingClientRect().height,
    panelHeight: document.querySelector('.login-panel')!.getBoundingClientRect().height
  }));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.artHeight).toBeGreaterThan(500);
  expect(layout.panelHeight).toBeGreaterThan(500);
  await testInfo.attach('login-reference-mobile.png', {
    body: await page.screenshot({ fullPage: true, animations: 'disabled' }),
    contentType: 'image/png'
  });
  await testInfo.attach('login-reference-mobile-geometry.json', {
    body: Buffer.from(JSON.stringify(layout, null, 2)),
    contentType: 'application/json'
  });
});

function todayInIndia() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

// Attendance tests exercise punch behavior, not the date-specific holiday calendar.
// Keep their UI fixture deterministic, while the real attendance API test still
// sends check-in/check-out requests to the backend.
async function stubNoHolidayCalendar(page: any) {
  await page.route(/\/api\/calendar(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ holidays: [] })
    });
  });
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


test('GPS check-in falls back to approved office Wi-Fi when laptop location is unavailable', async ({ page }) => {
  await stubNoHolidayCalendar(page);
  await page.route(/\/api\/attendance(?:\?.*)?$/, async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ records: [] })
  }));
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

  let attendancePostBody: Record<string, unknown> | null = null;
  await page.route('**/api/attendance/check-in', async (route) => {
    attendancePostBody = route.request().postDataJSON();
    // Keep this as a client fallback test and avoid mutating the shared E2E attendance record.
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, status: 'ON_TIME', method: 'WIFI', attendanceId: 'e2e-wifi-fallback' })
    });
  });
  await signInDev(page, 'employee');
  await page.locator('.overview-attendance-card').getByRole('button', { name: /At the office\? Check in with office verification/ })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(() => attendancePostBody?.method).toBe('WIFI');
  await expect(page.getByText(/Check-in recorded using approved office Wi-Fi/i)).toBeVisible();
  await expect(page.getByText(/open Site settings.*set Location to Allow/i)).toHaveCount(0);
});



test('denied GPS permission falls back to approved office Wi-Fi with a clear recovery status', async ({ page }) => {
  await stubNoHolidayCalendar(page);
  await page.route(/\/api\/attendance(?:\?.*)?$/, async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ records: [] })
  }));
  await page.addInitScript(() => {
    const fail = (error: (failure: { code: number; message: string }) => void) => {
      window.setTimeout(() => error({ code: 1, message: 'Permission denied' }), 20);
    };
    const geolocation = {
      watchPosition(_success: unknown, error: (failure: { code: number; message: string }) => void) {
        fail(error); return 1;
      },
      clearWatch() {},
      getCurrentPosition(_success: unknown, error: (failure: { code: number; message: string }) => void) {
        fail(error);
      }
    };
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geolocation });
  });

  let attendancePostBody: Record<string, unknown> | null = null;
  await page.route('**/api/attendance/check-in', async (route) => {
    attendancePostBody = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, status: 'ON_TIME', method: 'WIFI', attendanceId: 'e2e-denied-gps' })
    });
  });
  await signInDev(page, 'employee');
  await page.locator('.overview-attendance-card').getByRole('button', { name: /At the office\? Check in with office verification/ })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(() => attendancePostBody?.method).toBe('WIFI');
  await expect(page.getByText(/Check-in recorded using approved office Wi-Fi/i)).toBeVisible();
});

test('slow but accurate GPS acquisition completes check-in without Wi-Fi fallback', async ({ page }) => {
  await stubNoHolidayCalendar(page);
  await page.route(/\/api\/attendance(?:\?.*)?$/, async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ records: [] })
  }));
  await page.addInitScript(() => {
    const succeed = (success: (position: { coords: { latitude: number; longitude: number; accuracy: number } }) => void) => {
      window.setTimeout(() => success({ coords: { latitude: 18.506633, longitude: 73.857692, accuracy: 15 } }), 1400);
    };
    const geolocation = {
      watchPosition(success: (position: { coords: { latitude: number; longitude: number; accuracy: number } }) => void) {
        succeed(success); return 1;
      },
      clearWatch() {},
      getCurrentPosition(success: (position: { coords: { latitude: number; longitude: number; accuracy: number } }) => void) {
        succeed(success);
      }
    };
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geolocation });
  });

  let attendancePostBody: Record<string, unknown> | null = null;
  await page.route('**/api/attendance/check-in', async (route) => {
    attendancePostBody = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, status: 'ON_TIME', method: 'GPS', attendanceId: 'e2e-slow-gps' })
    });
  });
  await signInDev(page, 'employee');
  await page.locator('.overview-attendance-card').getByRole('button', { name: /At the office\? Check in with office verification/ })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(() => attendancePostBody?.method, { timeout: 7000 }).toBe('GPS');
  await expect(page.getByText('Check-in recorded.')).toBeVisible();
});

test('inaccurate indoor GPS falls back to the approved office network', async ({ page }) => {
  await stubNoHolidayCalendar(page);
  await page.route(/\/api\/attendance(?:\?.*)?$/, async (route) => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify({records:[]})
  }));
  await page.addInitScript(() => {
    const provideInaccuratePosition=(success:(position:{coords:{latitude:number;longitude:number;accuracy:number}})=>void)=>{
      window.setTimeout(()=>success({coords:{latitude:18.506633,longitude:73.857692,accuracy:350}}),40);
    };
    const geolocation={
      watchPosition(success:(position:{coords:{latitude:number;longitude:number;accuracy:number}})=>void){provideInaccuratePosition(success);return 1;},
      clearWatch(){},
      getCurrentPosition(success:(position:{coords:{latitude:number;longitude:number;accuracy:number}})=>void){provideInaccuratePosition(success);}
    };
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:geolocation});
  });
  let attendancePostBody:Record<string,unknown>|null=null;
  await page.route('**/api/attendance/check-in',async(route)=>{
    attendancePostBody=route.request().postDataJSON();
    await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({ok:true,status:'ON_TIME',method:'WIFI',attendanceId:'e2e-inaccurate-gps'})});
  });
  await signInDev(page,'employee');
  await page.locator('.overview-attendance-card').getByRole('button',{name:/At the office\? Check in with office verification/})
    .evaluate((button:HTMLButtonElement)=>button.click());
  await expect.poll(()=>attendancePostBody?.method,{timeout:8000}).toBe('WIFI');
  await expect(page.getByText(/Check-in recorded using approved office Wi-Fi/i)).toBeVisible();
});

test('GPS acquisition timeout falls back to Wi-Fi instead of leaving the employee waiting indefinitely', async ({ page }) => {
  await stubNoHolidayCalendar(page);
  await page.route(/\/api\/attendance(?:\?.*)?$/, async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ records: [] })
  }));
  await page.addInitScript(() => {
    const geolocation = {
      watchPosition() { return 1; },
      clearWatch() {},
      getCurrentPosition() {}
    };
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geolocation });
  });

  let attendancePostBody: Record<string, unknown> | null = null;
  await page.route('**/api/attendance/check-in', async (route) => {
    attendancePostBody = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, status: 'ON_TIME', method: 'WIFI', attendanceId: 'e2e-gps-timeout' })
    });
  });
  await signInDev(page, 'employee');
  await page.locator('.overview-attendance-card').getByRole('button', { name: /At the office\? Check in with office verification/ })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(() => attendancePostBody?.method, { timeout: 8000 }).toBe('WIFI');
  await expect(page.getByText(/Check-in recorded using approved office Wi-Fi/i)).toBeVisible();
});

test('WFH-enabled employee can check in from the overview without a daily approval or GPS', async ({ page }) => {
  await stubNoHolidayCalendar(page);
  await page.addInitScript(() => {
    const geolocation = {
      watchPosition(_success: unknown, error: (failure: { code: number; message: string }) => void) {
        window.setTimeout(() => error({ code: 2, message: 'Position unavailable' }), 0);
        return 1;
      },
      clearWatch() {},
      getCurrentPosition(_success: unknown, error: (failure: { code: number; message: string }) => void) {
        window.setTimeout(() => error({ code: 2, message: 'Position unavailable' }), 0);
      }
    };
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geolocation });
  });
  await page.route('**/api/wfh', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ enabled: true, approvedToday: false, today: todayInIndia(), monthlyCap: 4, requests: [] })
  }));
  await page.route(/\/api\/attendance(?:\?.*)?$/, async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ records: [] })
  }));
  let attendancePostBody: Record<string, unknown> | null = null;
  await page.route('**/api/attendance/check-in', async (route) => {
    attendancePostBody = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, status: 'ON_TIME', method: 'WFH', attendanceId: 'e2e-approved-wfh-home' })
    });
  });
  await signInDev(page, 'employee');
  await expect(page.locator('.overview-attendance-card').getByRole('button', { name: 'Check in remotely' })).toBeVisible();
  await page.locator('.overview-attendance-card').getByRole('button', { name: 'Check in remotely' })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(() => attendancePostBody?.method).toBe('WFH');
  await expect(page.getByText('Remote check-in recorded.')).toBeVisible();
});

test('WFH-enabled employee can check in from Attendance without a daily approval or GPS', async ({ page }) => {
  await stubNoHolidayCalendar(page);
  await page.addInitScript(() => {
    const geolocation = {
      watchPosition(_success: unknown, error: (failure: { code: number; message: string }) => void) {
        window.setTimeout(() => error({ code: 2, message: 'Position unavailable' }), 0);
        return 1;
      },
      clearWatch() {},
      getCurrentPosition(_success: unknown, error: (failure: { code: number; message: string }) => void) {
        window.setTimeout(() => error({ code: 2, message: 'Position unavailable' }), 0);
      }
    };
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geolocation });
  });
  await page.route('**/api/wfh', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ enabled: true, approvedToday: false, today: todayInIndia(), monthlyCap: 4, requests: [] })
  }));
  await page.route(/\/api\/attendance(?:\?.*)?$/, async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ records: [] })
  }));
  let attendancePostBody: Record<string, unknown> | null = null;
  await page.route('**/api/attendance/check-in', async (route) => {
    attendancePostBody = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, status: 'ON_TIME', method: 'WFH', attendanceId: 'e2e-approved-wfh-attendance' })
    });
  });
  await signInDev(page, 'employee');
  await page.goto('/attendance');
  await expect(page.locator('.attendance-overview-card').getByRole('button', { name: 'Check in remotely' })).toBeVisible();
  await page.locator('.attendance-overview-card').getByRole('button', { name: 'Check in remotely' })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(() => attendancePostBody?.method).toBe('WFH');
  await expect(page.getByText('Remote check-in recorded.')).toBeVisible();
});

test('employee documents page uses the real authenticated API', async ({ page }) => {
  await signInDev(page, 'employee');
  await openSidebarLink(page, 'My documents');
  await expect(page.getByRole('heading', { name: 'My documents', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Personal documents', exact: true })).toBeVisible();
  await expect(page.getByText('No documents available yet')).toBeVisible();
});

test('employee check-in and checkout exercise the real attendance API', async ({ page }) => {
  await stubNoHolidayCalendar(page);
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude:18.506633, longitude:73.857692, accuracy:10 });
  await signInDev(page, 'employee');
  const apiBase = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:3001/api';
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit'
  }).format(new Date());
  const readToday = async () => {
    const response = await page.request.get(`${apiBase}/attendance?from=${date}&to=${date}`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    return (data.records||[]).find((row:any)=>row.attendance_date===date);
  };
  let record = await readToday();
  if (!record?.check_in_at) {
    await page.getByRole('button', { name:/Check in/i }).first().click();
    await expect(page.getByText(/Remote check-in recorded\.|Check-in recorded\.|Check-in recorded using approved office Wi-Fi\./)).toBeVisible();
    record = await readToday();
  }
  expect(record?.check_in_at).toBeTruthy();
  if (!record?.check_out_at) {
    await page.getByRole('button', { name:/Check out/i }).first().click();
    await expect(page.getByText(/Remote check-out recorded\.|Check-out recorded\.|Check-out recorded using approved office Wi-Fi\./)).toBeVisible();
    record = await readToday();
  }
  expect(record?.check_out_at).toBeTruthy();
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
