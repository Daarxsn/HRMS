import { defineConfig, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
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

function emitSpaFallbackFiles() {
  const routes = [
    'attendance', 'leave', 'wfh', 'out', 'calendar', 'profile', 'notifications',
    'documents', 'policies', 'grievance', 'admin', 'team', 'approvals', 'reports', 'settings', 'audit',
    'admin/calendar', 'admin/team', 'admin/attendance', 'admin/approvals', 'admin/reports', 'admin/settings',
    'admin/hr', 'admin/audit'
  ];
  return {
    name: 'emit-spa-fallbacks',
    closeBundle() {
      const distDir = path.resolve(process.cwd(), 'dist');
      const indexPath = path.join(distDir, 'index.html');
      if (!existsSync(indexPath)) return;

      copyFileSync(indexPath, path.join(distDir, '404.html'));
      for (const route of routes) {
        const routeDir = path.join(distDir, route);
        mkdirSync(routeDir, { recursive: true });
        copyFileSync(indexPath, path.join(routeDir, 'index.html'));
        if (!route.includes('/')) {
          copyFileSync(indexPath, path.join(distDir, `${route}.html`));
        }
      }
    }
  };
}

export default defineConfig({
  plugins: [react(), emitServiceWorker(), emitSpaFallbackFiles()],
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
