import test from 'node:test';
import assert from 'node:assert/strict';
import { accessFor, authCookieOptions, platformFor } from '../src/security.mts';
import { assertProductionConfiguration } from '../src/production-config.mts';

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

test('production startup configuration rejects a missing or weak JWT secret', () => {
  assert.throws(() => assertProductionConfiguration({
    NODE_ENV:'production',
    APP_ORIGIN:'https://hrms.example.test',
    GOOGLE_CLIENT_ID:'test-client.apps.googleusercontent.com'
  }), /Set a private JWT_SECRET of at least 32 bytes in production/);
  assert.throws(() => assertProductionConfiguration({
    NODE_ENV:'production',
    JWT_SECRET:'short-secret',
    APP_ORIGIN:'https://hrms.example.test',
    GOOGLE_CLIENT_ID:'test-client.apps.googleusercontent.com'
  }), /Set a private JWT_SECRET of at least 32 bytes in production/);
});

test('production configuration requires portal origin and Google client id', () => {
  const strongSecret = 'production-secret-0123456789-abcdef';
  assert.throws(() => assertProductionConfiguration({
    NODE_ENV:'production',
    JWT_SECRET:strongSecret,
    GOOGLE_CLIENT_ID:'test-client.apps.googleusercontent.com'
  }), /Set APP_ORIGIN to the exact production portal origin/);
  assert.throws(() => assertProductionConfiguration({
    NODE_ENV:'production',
    JWT_SECRET:strongSecret,
    APP_ORIGIN:'https://hrms.example.test'
  }), /Set GOOGLE_CLIENT_ID in production/);
  assert.doesNotThrow(() => assertProductionConfiguration({
    NODE_ENV:'production',
    JWT_SECRET:strongSecret,
    APP_ORIGIN:'https://hrms.example.test',
    GOOGLE_CLIENT_ID:'test-client.apps.googleusercontent.com'
  }));
  assert.doesNotThrow(() => assertProductionConfiguration({NODE_ENV:'development'}));
});
