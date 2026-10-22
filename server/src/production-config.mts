export function assertProductionConfiguration(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== 'production') return;
  if (!env.JWT_SECRET || Buffer.byteLength(env.JWT_SECRET) < 32) {
    throw new Error('Set a private JWT_SECRET of at least 32 bytes in production.');
  }
  if (!env.APP_ORIGIN) {
    throw new Error('Set APP_ORIGIN to the exact production portal origin.');
  }
  if (!env.GOOGLE_CLIENT_ID) {
    throw new Error('Set GOOGLE_CLIENT_ID in production.');
  }
}
