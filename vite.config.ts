/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build, defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';

const require = createRequire(import.meta.url);

// Mock mode only: serve (dev) and emit (build) MSW's service worker script so
// the app can run against mock/ handlers. Production builds never contain it,
// because Decaid skins must not register a service worker.
// MSW's worker names each request with crypto.randomUUID(), which Chromium 91
// lacks; without this its fetch handler throws and every mocked call falls
// through to the network in the Chromium 91 smoke test.
const RANDOM_UUID_POLYFILL = `if (self.crypto && typeof self.crypto.randomUUID !== 'function') {
  self.crypto.randomUUID = function () {
    var b = self.crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x + 0x100).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  };
}
`;

function mswWorkerInMockMode(mode: string): Plugin {
  const fileName = 'mockServiceWorker.js';
  const source = () => RANDOM_UUID_POLYFILL + readFileSync(require.resolve('msw/mockServiceWorker.js'), 'utf8');
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

// MapLibre 6 loads its worker from a second file, written for ES2022
// (docs/overhead/DECISIONS.md, O7). The skin is one bundle for Chromium 91,
// so the worker is compiled here for chrome91 with the core-js polyfills it
// needs (src/overhead/ui/maplibreWorkerEntry.ts) and inlined as a string,
// which src/overhead/ui/maplibreSetup.ts hands MapLibre as a blob: URL.
function maplibreWorkerInline(): Plugin {
  const id = 'virtual:maplibre-worker-source';
  const resolved = `\0${id}`;
  let compiled: Promise<string> | null = null;
  const compile = async () => {
    const result = await build({
      configFile: false,
      logLevel: 'warn',
      publicDir: false,
      build: {
        write: false,
        target: 'chrome91',
        minify: true,
        sourcemap: false,
        lib: {
          entry: fileURLToPath(new URL('./src/overhead/ui/maplibreWorkerEntry.ts', import.meta.url)),
          formats: ['iife'],
          name: 'MaplibreWorker',
          fileName: () => 'maplibre-worker.js',
        },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result]) as Array<{ output: Array<{ type: string; code?: string }> }>;
    const chunk = outputs.flatMap((output) => output.output).find((file) => file.type === 'chunk');
    if (!chunk?.code) throw new Error('The MapLibre worker did not build.');
    return chunk.code;
  };
  return {
    name: 'cafai:maplibre-worker-inline',
    resolveId: (source) => (source === id ? resolved : null),
    async load(loadId) {
      if (loadId !== resolved) return null;
      compiled ??= compile();
      return `export default ${JSON.stringify(await compiled)};`;
    },
  };
}

// plugin-legacy re-derives build.target from `modernTargets` and warns that it
// overrode the explicit target below (the result is the same chrome91). Fail
// the build if the resolved target is ever anything else.
function assertChrome91Target(): Plugin {
  return {
    name: 'cafai:assert-chrome91-target',
    apply: 'build',
    configResolved(config) {
      const target = [config.build.target].flat().join(',');
      if (target !== 'chrome91') throw new Error(`build.target resolved to "${target}"; CafAI must target chrome91.`);
    },
  };
}

// Decaid serves skins from a per-skin origin and the oldest supported tablets
// run an immutable Chromium 91 WebView. Relative asset paths, a chrome91 syntax
// target and usage-based core-js polyfills keep the bundle loadable there
// (verified in real Chromium 91 by tools/chrome91/smoke.mjs).
export default defineConfig(({ mode }) => ({
  base: './',
  // Mock mode's own dependency cache: its extra plugin changes the optimizer's
  // config hash, so with one shared cache `npm run dev` and a mock-mode server
  // (dev:mock, dev:sim) running side by side would keep re-optimizing it.
  cacheDir: mode === 'mock' ? 'node_modules/.vite-mock' : undefined,
  resolve: {
    alias: [
      // @mui/x-chat lazily imports `remend` to repair half-streamed markdown.
      // CafAI renders model text with its own safe renderer, so point the
      // import at x-chat's own "unavailable" stub: no extra lazy chunk, which
      // Decaid's in-place skin updates could 404.
      {
        find: /^#remend$/,
        replacement: fileURLToPath(new URL('./node_modules/@mui/x-chat/internals/remendUnavailable.mjs', import.meta.url)),
      },
    ],
  },
  plugins: [
    react(),
    legacy({
      renderLegacyChunks: false,
      modernPolyfills: true,
      modernTargets: ['chrome >= 91'],
    }),
    mswWorkerInMockMode(mode),
    maplibreWorkerInline(),
    assertChrome91Target(),
  ],
  define: {
    __CAFAI_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
  build: {
    target: 'chrome91',
    cssTarget: 'chrome91',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      // One entry chunk: Decaid replaces skin files in place while the page
      // runs, so any lazily loaded chunk could 404 mid-session.
      output: { codeSplitting: false },
    },
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
    include: ['src/**/*.test.{ts,tsx}', 'mock/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,mjs}', 'bridge/**/*.test.mjs'],
    restoreMocks: true,
    testTimeout: 15000,
  },
}));
