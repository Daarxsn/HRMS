import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '../../client/dist');
const distIndex = path.join(distDir, 'index.html');
const createdFixture = !fs.existsSync(distIndex);
if (createdFixture) {
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(distIndex, '<!doctype html><html><head><title>Falchion Xeniaa HRMS</title></head><body><div id="root"></div></body></html>');
}

const { default: app } = await import('../src/index.mts');
const { pool } = await import('../src/db.mts');
const appTsx = fs.readFileSync(path.resolve(__dirname, '../../client/src/App.tsx'), 'utf8');
const viteConfig = fs.readFileSync(path.resolve(__dirname, '../../client/vite.config.ts'), 'utf8');
const vercelJson = fs.readFileSync(path.resolve(__dirname, '../../vercel.json'), 'utf8');
const clientVercelJson = fs.readFileSync(path.resolve(__dirname, '../../client/vercel.json'), 'utf8');

test('Multi-page fallback: non-API deep links stream index.html with no-cache headers', async () => {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    for (const route of ['/attendance', '/leave', '/admin', '/admin/attendance', '/profile', '/notifications']) {
      const res = await fetch(`${baseUrl}${route}`);
      assert.equal(res.status, 200, `Expected 200 for deep route ${route}, got ${res.status}`);
      const text = await res.text();
      assert.match(text, /<!doctype html>/i);
      assert.match(text, /id="root"/);
      assert.match(res.headers.get('cache-control') || '', /no-cache/);
    }
  } finally {
    server.close();
  }
});

test('API 404 guard: unhandled /api/* routes fail closed with structured JSON', async () => {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    for (const method of ['GET', 'POST']) {
      const res = await fetch(`${baseUrl}/api/nonexistent-sub-route`, { method });
      assert.equal(res.status, 404);
      const json = await res.json() as { error: string; requestId?: string };
      assert.equal(json.error, 'That API route was not found.');
      assert.ok(json.requestId);
    }
  } finally {
    server.close();
  }
});

test('Frontend route persistence and 404 page architecture contracts', () => {
  assert.match(appTsx, /function NotFoundPage/);
  assert.match(appTsx, /404 NOT FOUND/);
  assert.match(appTsx, /We couldn’t find that page/);
  assert.match(appTsx, /path="\*"\s*element=\{<NotFoundPage/);
  assert.match(appTsx, /function PageSkeletonLoader/);
  assert.match(appTsx, /<Suspense fallback=\{<PageSkeletonLoader/);
  assert.match(appTsx, /function getSafeReturnUrl/);
  assert.match(appTsx, /fx_hrms_return_url/);
  assert.match(viteConfig, /manualChunks/);
  assert.match(viteConfig, /vendor-react/);
  assert.match(viteConfig, /vendor-icons/);
  assert.match(vercelJson, /"service":\s*"frontend"/);
  assert.match(vercelJson, /"framework":\s*"nextjs"/);
  assert.match(clientVercelJson, /"destination":\s*"\/index\.html"/);
});

test('Next.js multi-page App Router architecture and route contracts', () => {
  const nextConfig = fs.readFileSync(path.resolve(__dirname, '../../client/next.config.mjs'), 'utf8');
  assert.match(nextConfig, /turbopack/);
  assert.match(nextConfig, /router-bridge/);
  assert.match(nextConfig, /destination:\s*process\.env\.NODE_ENV === 'development'/);

  const appDir = path.resolve(__dirname, '../../client/app');
  const requiredNextPages = [
    'page.tsx',
    'layout.tsx',
    'providers.tsx',
    'not-found.tsx',
    'attendance/page.tsx',
    'leave/page.tsx',
    'wfh/page.tsx',
    'out/page.tsx',
    'calendar/page.tsx',
    'profile/page.tsx',
    'notifications/page.tsx',
    'documents/page.tsx',
    'policies/page.tsx',
    'grievance/page.tsx',
    'admin/page.tsx',
    'admin/attendance/page.tsx',
    'admin/approvals/page.tsx',
    'admin/reports/page.tsx',
    'admin/settings/page.tsx',
    'admin/hr/page.tsx',
    'admin/audit/page.tsx',
    'admin/team/page.tsx',
    'admin/calendar/page.tsx'
  ];

  for (const pageRel of requiredNextPages) {
    const fullPath = path.join(appDir, pageRel);
    assert.ok(fs.existsSync(fullPath), `Missing Next.js multi-page route: ${pageRel}`);
  }
});

test.after(async () => {
  await pool.end();
});

