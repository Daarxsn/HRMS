import crypto from 'node:crypto';
import multer from 'multer';
import {
  saveObject,
  deleteObject,
  readObject
} from './object-storage.ts';

export const profilePhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    cb(
      allowed.includes(file.mimetype)
        ? null
        : Object.assign(
            new Error('Profile photos must be JPG, PNG, or WebP images.'),
            { status: 400 }
          ),
      allowed.includes(file.mimetype)
    );
  }
});

const suffixFor = (contentType: string) =>
  contentType === 'image/jpeg'
    ? '.jpg'
    : contentType === 'image/png'
      ? '.png'
      : '.webp';

export type ProfilePhotoFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
};

export async function saveProfilePhoto(
  employeeId: string,
  file: ProfilePhotoFile
) {
  const id = crypto.randomUUID();
  const key = `${employeeId}/profile/${id}${suffixFor(file.mimetype)}`;

  await saveObject(key, file.buffer, file.mimetype);

  return {
    key,
    contentType: file.mimetype,
    filename: file.originalname.slice(0, 255)
  };
}

export async function deleteProfilePhoto(
  key: string | null | undefined
) {
  if (!key) return;

  try {
    await deleteObject(key);
  } catch (error) {
    console.error(
      JSON.stringify({
        type: 'profile_photo_cleanup_error',
        key,
        error: String((error as any)?.message || error)
      })
    );
  }
}

export async function readProfilePhoto(key: string) {
  return readObject(key);
}

export const verifyImageSignature = (
  buffer: Buffer,
  contentType: string
) => {
  const signatures: Record<string, Buffer> = {
    'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
    'image/png': Buffer.from([
      0x89, 0x50, 0x4e, 0x47,
      0x0d, 0x0a, 0x1a, 0x0a
    ]),
    'image/webp': Buffer.from('RIFF')
  };

  const signature = signatures[contentType];

  if (
    !signature ||
    !buffer.subarray(0, signature.length).equals(signature)
  ) {
    throw Object.assign(
      new Error('The uploaded profile photo is not a valid image.'),
      { status: 400 }
    );
  }

  if (
    contentType === 'image/webp' &&
    !buffer.subarray(8, 12).equals(Buffer.from('WEBP'))
  ) {
    throw Object.assign(
      new Error('The uploaded profile photo is not a valid WebP image.'),
      { status: 400 }
    );
  }
};
