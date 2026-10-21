import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { del, get, put } from '@vercel/blob';

const localRoot = path.resolve(process.cwd(), 'private-uploads');
export type ObjectStorageReadiness = {
  status: 'PASS' | 'FAIL';
  provider: 'vercel-blob-private' | 'local-private-filesystem';
  detail: string;
};
const usesVercelBlob = () => process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';

export function getObjectStorageReadiness(): ObjectStorageReadiness {
  if (!usesVercelBlob()) return {
    status: 'PASS',
    provider: 'local-private-filesystem',
    detail: 'Local private document storage is available for this non-production runtime.'
  };
  if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) return {
    status: 'FAIL',
    provider: 'vercel-blob-private',
    detail: 'The Vercel private Blob read/write credential is not configured.'
  };
  return {
    status: 'PASS',
    provider: 'vercel-blob-private',
    detail: 'The private Blob read/write credential is configured; connectivity is confirmed only by a successful object operation.'
  };
}

function validateObjectKey(key: string): string {
  if (typeof key !== 'string' || !key.trim() || key.includes('\0') || key.includes('\\') ||
      key.startsWith('/') || path.posix.isAbsolute(key)) {
    throw Object.assign(new Error('Invalid private object key.'), { status: 400, code: 'INVALID_OBJECT_KEY' });
  }
  if (key.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw Object.assign(new Error('Invalid private object key.'), { status: 400, code: 'INVALID_OBJECT_KEY' });
  }
  return key;
}

function localObjectPath(key: string): string {
  const resolved = path.resolve(localRoot, ...validateObjectKey(key).split('/'));
  if (!resolved.startsWith(localRoot + path.sep)) {
    throw Object.assign(new Error('Invalid private object key.'), { status: 400, code: 'INVALID_OBJECT_KEY' });
  }
  return resolved;
}

function assertRemoteStorageConfigured() {
  if (getObjectStorageReadiness().status !== 'PASS') {
    throw Object.assign(new Error('Private document storage is not configured.'), { status: 503, code: 'OBJECT_STORAGE_NOT_CONFIGURED' });
  }
}

function providerError(operation: 'read' | 'write' | 'delete', error: unknown) {
  const rawCode = (error as { code?: unknown } | null)?.code;
  console.error(JSON.stringify({
    type: 'object_storage_operation_failed',
    operation,
    error_code: typeof rawCode === 'string' && /^[A-Z0-9_]{1,80}$/i.test(rawCode) ? rawCode : 'provider_error'
  }));
  return Object.assign(new Error('Private document storage is temporarily unavailable.'), {
    status: 503, code: 'OBJECT_STORAGE_UNAVAILABLE'
  });
}

export async function saveObject(key: string, buffer: Buffer, contentType: string) {
  const safeKey = validateObjectKey(key);
  if (!Buffer.isBuffer(buffer) || typeof contentType !== 'string' || !contentType.trim()) {
    throw Object.assign(new Error('A valid file buffer and content type are required.'), { status: 400, code: 'INVALID_OBJECT_CONTENT' });
  }
  if (usesVercelBlob()) {
    assertRemoteStorageConfigured();
    try {
      await put(safeKey, buffer, { access: 'private', contentType, addRandomSuffix: false });
    } catch (error) {
      throw providerError('write', error);
    }
    return;
  }
  try {
    const location = localObjectPath(safeKey);
    await fs.mkdir(path.dirname(location), { recursive: true, mode: 0o700 });
    await fs.writeFile(location, buffer, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') {
      throw Object.assign(new Error('A private object with this key already exists.'), { status: 409 });
    }
    throw providerError('write', error);
  }
}

export async function deleteObject(key: string) {
  if (!key) return;
  const safeKey = validateObjectKey(key);
  if (usesVercelBlob()) {
    assertRemoteStorageConfigured();
    try {
      await del(safeKey);
    } catch (error) {
      throw providerError('delete', error);
    }
    return;
  }
  try {
    await fs.unlink(localObjectPath(safeKey));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return;
    throw providerError('delete', error);
  }
}

export async function readObject(key: string) {
  const safeKey = validateObjectKey(key);
  if (usesVercelBlob()) {
    assertRemoteStorageConfigured();
    try {
      const result = await get(safeKey, { access: 'private', useCache: false });
      if (!result) throw Object.assign(new Error('Object not found.'), { status: 404 });
      return {
        kind: 'stream' as const,
        stream: Readable.fromWeb(result.stream as any),
        contentType: result.blob.contentType
      };
    } catch (error) {
      if ((error as { status?: number } | null)?.status === 404) throw error;
      throw providerError('read', error);
    }
  }
  try {
    return { kind: 'buffer' as const, buffer: await fs.readFile(localObjectPath(safeKey)) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw Object.assign(new Error('Object not found.'), { status: 404 });
    }
    throw providerError('read', error);
  }
}
