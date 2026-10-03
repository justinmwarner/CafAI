/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';

const require = createRequire(import.meta.url);

// Mock mode only: serve (dev) and emit (build) MSW's service worker script so
// the app can run against mock/ handlers. Production builds never contain it,
// because Decaid skins must not register a service worker.
function mswWorkerInMockMode(mode: string): Plugin {
  const fileName = 'mockServiceWorker.js';
  const source = () => readFileSync(require.resolve('msw/mockServiceWorker.js'), 'utf8');
  return {
    name: 'cafai-msw-worker',
    apply: () => mode === 'mock',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0]?.endsWith(`/${fileName}`)) {
          res.setHeader('content-type', 'text/javascript');
          res.end(source());
          return;
        }
        next();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName, source: source() });
    },
  };
}

// Decaid serves skins from a per-skin origin and the oldest supported tablets
// run an immutable Chromium 91 WebView. Relative asset paths, a chrome91 syntax
// target and usage-based core-js polyfills keep the bundle loadable there
// (verified in real Chromium 91 by tools/chrome91/smoke.mjs).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
    legacy({
      renderLegacyChunks: false,
      modernPolyfills: true,
      modernTargets: ['chrome >= 91'],
    }),
    mswWorkerInMockMode(mode),
  ],
  define: {
    __CAFAI_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
  build: {
    target: 'chrome91',
    cssTarget: 'chrome91',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  test: {
    // Logic tests run in Node; UI tests opt into a DOM with a
    // `// @vitest-environment jsdom` docblock (jsdom start-up is slow).
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'mock/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,mjs}'],
    restoreMocks: true,
    testTimeout: 15000,
  },
}));
