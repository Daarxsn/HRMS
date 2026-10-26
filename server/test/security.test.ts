import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { accessFor, authCookieOptions, platformFor, signToken, parseDeviceName } from '../src/security.mts';
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

    const thirtyDayOptions = authCookieOptions(true);
    assert.equal(thirtyDayOptions.maxAge, 30 * 24 * 60 * 60 * 1000);

    process.env.NODE_ENV = 'development';
    assert.equal(authCookieOptions().secure, false);
  } finally {
    if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old;
  }
});

test('signToken supports rememberMe 30-day persistence', () => {
  const user = { id: 'test-user-123', role: 'EMPLOYEE', user_type: 'EMPLOYEE', session_version: 2 };
  const standardToken = signToken(user, false, 'session-abc');
  const decodedStandard: any = jwt.decode(standardToken);
  assert.equal(decodedStandard.sub, 'test-user-123');
  assert.equal(decodedStandard.sid, 'session-abc');
  assert.equal(decodedStandard.remember_me, false);

  const persistentToken = signToken(user, true, 'session-xyz');
  const decodedPersistent: any = jwt.decode(persistentToken);
  assert.equal(decodedPersistent.sub, 'test-user-123');
  assert.equal(decodedPersistent.sid, 'session-xyz');
  assert.equal(decodedPersistent.remember_me, true);
  // Verify expiration is approximately 30 days ahead (within 60 seconds tolerance)
  const diffDays = (decodedPersistent.exp - decodedPersistent.iat) / (24 * 60 * 60);
  assert.equal(Math.round(diffDays), 30);
});

test('parseDeviceName extracts human-readable device tags from User-Agent', () => {
  assert.equal(parseDeviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'), 'macOS · Chrome');
  assert.equal(parseDeviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'), 'Windows · Edge');
  assert.equal(parseDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'), 'iOS · Safari');
  assert.equal(parseDeviceName(''), 'Web Browser');
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
