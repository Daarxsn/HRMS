import { defineConfig, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function emitServiceWorker() {
  return {
    name: 'emit-service-worker',
    async generateBundle() {
      const source = readFileSync(path.resolve(process.cwd(), 'src/sw.ts'), 'utf8');
      const result = await transformWithEsbuild(source, 'sw.ts', { loader: 'ts', target: 'es2022', format: 'iife' });
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: result.code });
    }
  };
}

export default defineConfig({
  plugins: [react(), emitServiceWorker()],
  server: {
    port: 3000,
    strictPort: true,
    proxy: { '/api': 'http://localhost:3001' }
  }
});
