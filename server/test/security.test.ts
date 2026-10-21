import test from 'node:test';
import assert from 'node:assert/strict';
import { accessFor, authCookieOptions, platformFor } from '../src/security.mts';

test('session cookie is HttpOnly, SameSite Lax and Secure in production', () => {
  const old = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    const options = authCookieOptions();
    assert.equal(options.httpOnly, true);
    assert.equal(options.secure, true);
    assert.equal(options.sameSite, 'lax');
    assert.equal(options.path, '/');
    assert.equal(options.maxAge, 8 * 60 * 60 * 1000);
    process.env.NODE_ENV = 'development';
    assert.equal(authCookieOptions().secure, false);
  } finally {
    if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old;
  }
});

test('only the exact ADMIN/ADMIN pair receives administrator platform capabilities', () => {
  assert.equal(platformFor({role:'ADMIN', user_type:'ADMIN'}), 'ADMIN');
  assert.equal(platformFor({role:'ADMIN', user_type:'EMPLOYEE'}), 'PEOPLE');
  assert.equal(platformFor({role:'EMPLOYEE', user_type:'ADMIN'}), 'PEOPLE');
  const mismatch = accessFor({id:'invalid', role:'ADMIN', user_type:'EMPLOYEE'});
  assert.equal(mismatch.platform, 'PEOPLE');
  assert.ok(!mismatch.capabilities.includes('admin_dashboard'));
});
