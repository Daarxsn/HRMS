import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
const { default: app } = await import('../src/index.mts');
const { pool } = await import('../src/db.mts');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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
  assert.match(clientVercelJson, /"destination":\s*"\/index\.html"/);
});

test.after(async () => {
  await pool.end();
});

