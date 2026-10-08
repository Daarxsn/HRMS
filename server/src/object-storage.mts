import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { del, get, put } from '@vercel/blob';

const useVercelBlob = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
const localRoot = path.resolve(process.cwd(), 'private-uploads');

export async function saveObject(
  key: string,
  buffer: Buffer,
  contentType: string
) {
  if (useVercelBlob) {
    await put(key, buffer, {
      access: 'private',
      contentType,
      addRandomSuffix: false
    });
    return;
  }

  const localPath = path.resolve(localRoot, key);
  await fs.mkdir(path.dirname(localPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(localPath, buffer, { mode: 0o600, flag: 'wx' });
}

export async function deleteObject(key: string) {
  if (!key) return;

  if (useVercelBlob) {
    await del(key);
    return;
  }

  await fs.unlink(path.resolve(localRoot, key)).catch(() => {});
}

export async function readObject(key: string) {
  if (useVercelBlob) {
    const result = await get(key, {
      access: 'private',
      useCache: false
    });

    if (!result) {
      throw Object.assign(new Error('Object not found.'), { status: 404 });
    }

    return {
      kind: 'stream' as const,
      stream: Readable.fromWeb(result.stream as any),
      contentType: result.blob.contentType
    };
  }

  return {
    kind: 'buffer' as const,
    buffer: await fs.readFile(path.resolve(localRoot, key))
  };
}
