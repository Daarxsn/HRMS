import test from 'node:test';
import assert from 'node:assert/strict';
import { EMAIL_OUTBOX_MAX_ATTEMPTS, EMAIL_OUTBOX_MAX_BACKOFF_MS, retryBackoffMs } from '../src/email-outbox.mts';

test('email retry backoff grows exponentially and remains bounded', () => {
  assert.equal(retryBackoffMs(1), 30_000);
  assert.equal(retryBackoffMs(2), 60_000);
  assert.equal(retryBackoffMs(3), 120_000);
  assert.equal(retryBackoffMs(4), 240_000);
  assert.equal(retryBackoffMs(6), EMAIL_OUTBOX_MAX_BACKOFF_MS);
  assert.equal(retryBackoffMs(99), EMAIL_OUTBOX_MAX_BACKOFF_MS);
  assert.equal(retryBackoffMs(0), 30_000);
});

test('email outbox retry ceiling is finite and explicit', () => {
  assert.equal(EMAIL_OUTBOX_MAX_ATTEMPTS, 8);
  assert.equal(EMAIL_OUTBOX_MAX_BACKOFF_MS, 15 * 60 * 1000);
});
