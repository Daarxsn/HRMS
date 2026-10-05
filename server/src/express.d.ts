import type { AuthenticatedUser, UploadedFile } from './types.ts';

declare global {
  namespace Express {
    interface Request {
      user: AuthenticatedUser;
      requestId: string;
      cookies?: Record<string, string>;
      file?: UploadedFile;
    }
  }
}

export {};
