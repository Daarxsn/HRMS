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
  },
  build: {
    chunkSizeWarningLimit: 600,
    cssCodeSplit: true,
    minify: 'esbuild',
    rollupOptions: {
      treeshake: {
        moduleSideEffects: false,
        propertyReadSideEffects: false,
        tryCatchDeoptimization: false
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/react-router-dom/') || id.includes('node_modules/react-router/')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/lucide-react/')) {
            return 'vendor-icons';
          }
        }
      }
    }
  }
});
