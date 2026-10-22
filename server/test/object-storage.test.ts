import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deleteObject, getObjectStorageReadiness, readObject, saveObject } from '../src/object-storage.mts';

test('private local storage round-trips bytes and deletes objects', async () => {
  const key = 'step4-test/' + randomUUID() + '.bin';
  const contents = Buffer.from('private-document-test-content');
  try {
    await saveObject(key, contents, 'application/octet-stream');
    const result = await readObject(key);
    assert.equal(result.kind, 'buffer');
    if (result.kind === 'buffer') assert.deepEqual(result.buffer, contents);
  } finally {
    await deleteObject(key);
  }
  await assert.rejects(() => readObject(key), (error: any) => error.status === 404);
});

test('private object keys reject traversal and absolute paths', async () => {
  for (const key of ['../outside', '/absolute/path', 'one/../two', 'one//two', 'one\\\\two', '.']) {
    await assert.rejects(() => saveObject(key, Buffer.from('x'), 'text/plain'), (error: any) => error.status === 400);
  }
});

test('production private Blob operations fail closed when the token is absent', async () => {
  const old = {nodeEnv:process.env.NODE_ENV, vercel:process.env.VERCEL, token:process.env.BLOB_READ_WRITE_TOKEN};
  try {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL = '1';
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const readiness = getObjectStorageReadiness();
    assert.equal(readiness.status, 'FAIL');
    assert.equal(readiness.provider, 'vercel-blob-private');
    await assert.rejects(() => saveObject('step4-test/no-token.bin', Buffer.from('x'), 'text/plain'),
      (error: any) => error.status === 503 && error.code === 'OBJECT_STORAGE_NOT_CONFIGURED');
    await assert.rejects(() => readObject('step4-test/no-token.bin'),
      (error: any) => error.status === 503 && error.code === 'OBJECT_STORAGE_NOT_CONFIGURED');
  } finally {
    if (old.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old.nodeEnv;
    if (old.vercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = old.vercel;
    if (old.token === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = old.token;
  }
});

test('private Blob readiness never serializes the credential', () => {
  const old = {nodeEnv:process.env.NODE_ENV, vercel:process.env.VERCEL, token:process.env.BLOB_READ_WRITE_TOKEN};
  try {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL = '1';
    process.env.BLOB_READ_WRITE_TOKEN = 'step4-dummy-secret-token';
    const readiness = getObjectStorageReadiness();
    assert.equal(readiness.status, 'PASS');
    assert.equal(JSON.stringify(readiness).includes('step4-dummy-secret-token'), false);
  } finally {
    if (old.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old.nodeEnv;
    if (old.vercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = old.vercel;
    if (old.token === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = old.token;
  }
});
