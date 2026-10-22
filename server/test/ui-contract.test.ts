import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app=await readFile(new URL('../../client/src/App.tsx',import.meta.url),'utf8');
const css=await readFile(new URL('../../client/src/styles.css',import.meta.url),'utf8');
const tokens=await readFile(new URL('../../client/src/design-tokens.css',import.meta.url),'utf8');
const api=await readFile(new URL('../../client/src/api.ts',import.meta.url),'utf8');
const main=await readFile(new URL('../../client/src/main.tsx',import.meta.url),'utf8');

test('navigation exposes expanded state, a labelled navigation region, and a skip link',()=>{
 assert.match(app,/className="skip-link" href="#main-content"/);
 assert.match(app,/id="primary-navigation"[^>]*aria-label="Primary navigation"/);
 assert.match(app,/aria-expanded=\{mobileOpen\}/);
 assert.match(app,/aria-controls="primary-navigation"/);
 assert.match(app,/<nav className="main-nav" aria-label="Workspace">/);
});
test('theme has semantic light/dark tokens and stylesheet loads them before legacy overrides',()=>{
 for(const token of ['--color-bg','--color-surface','--color-text','--color-text-muted','--color-border','--color-primary','--color-success','--color-warning','--color-danger','--focus-ring']) assert.ok(tokens.includes(token), 'Missing '+token);
 assert.match(tokens,/html\[data-theme="dark"\]/);
 assert.match(main,/import '\.\/design-tokens\.css';\s*import '\.\/styles\.css';/);
 assert.match(css,/overflow-x:\s*auto/);
 assert.match(css,/forced-colors:\s*active/);
 assert.match(css,/prefers-reduced-motion:\s*reduce/);
});
test('API wrapper times out and dispatches session expiry on protected 401 responses',()=>{
 assert.match(api,/setTimeout\(\(\) => controller\.abort\(\), 15000\)/);
 assert.match(api,/response\.status === 401 && !authEndpoint/);
 assert.match(api,/hrms:session-expired/);
 assert.match(api,/credentials:\s*'include'/);
});
test('navigation uses semantic active state and mobile layout has dedicated navigation',()=>{
 assert.match(app,/className=\{\(\{isActive\}\)=>`nav-link/);
 assert.match(app,/className="mobile-bottom-nav" aria-label="Mobile navigation"/);
});
