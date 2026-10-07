import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { Storage } from '@google-cloud/storage';

export const profilePhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    cb(allowed.includes(file.mimetype) ? null : Object.assign(new Error('Profile photos must be JPG, PNG, or WebP images.'), { status: 400 }), allowed.includes(file.mimetype));
  }
});

const storage = process.env.GCS_BUCKET
  ? new Storage({ projectId: process.env.GOOGLE_CLOUD_PROJECT })
  : null;

const suffixFor = (contentType: string) => contentType === 'image/jpeg' ? '.jpg' : contentType === 'image/png' ? '.png' : '.webp';

export async function saveProfilePhoto(employeeId: string, file: Express.Multer.File) {
  const id = crypto.randomUUID();
  const key = `${employeeId}/profile/${id}${suffixFor(file.mimetype)}`;
  const localPath = path.resolve(process.cwd(), 'private-uploads', key);

  if (storage) {
    await storage.bucket(process.env.GCS_BUCKET!).file(key).save(file.buffer, {
      resumable: false,
      metadata: { contentType: file.mimetype, cacheControl: 'private, no-store' },
      validation: 'crc32c',
      preconditionOpts: { ifGenerationMatch: 0 }
    });
  } else {
    await fs.mkdir(path.dirname(localPath), { recursive: true, mode: 0o700 });
    await fs.writeFile(localPath, file.buffer, { mode: 0o600, flag: 'wx' });
  }

  return { key, contentType: file.mimetype, filename: path.basename(file.originalname).slice(0, 255), localPath };
}

export async function deleteProfilePhoto(key: string | null | undefined) {
  if (!key) return;
  try {
    if (storage) {
      await storage.bucket(process.env.GCS_BUCKET!).file(key).delete({ ignoreNotFound: true });
    } else {
      await fs.unlink(path.resolve(process.cwd(), 'private-uploads', key)).catch(() => {});
    }
  } catch (error) {
    console.error(JSON.stringify({ type: 'profile_photo_cleanup_error', key, error: String((error as any)?.message || error) }));
  }
}

export async function readProfilePhoto(key: string) {
  if (storage) return storage.bucket(process.env.GCS_BUCKET!).file(key).createReadStream();
  return fs.readFile(path.resolve(process.cwd(), 'private-uploads', key));
}

export const verifyImageSignature = (buffer: Buffer, contentType: string) => {
  const signatures: Record<string, Buffer> = {
    'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
    'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    'image/webp': Buffer.from('RIFF')
  };
  const signature = signatures[contentType];
  if (!signature || !buffer.subarray(0, signature.length).equals(signature)) throw Object.assign(new Error('The uploaded profile photo is not a valid image.'), { status: 400 });
  if (contentType === 'image/webp' && !buffer.subarray(8, 12).equals(Buffer.from('WEBP'))) throw Object.assign(new Error('The uploaded profile photo is not a valid WebP image.'), { status: 400 });
};
