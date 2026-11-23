/**
 * Builds the Overhead plugin for Decaid (docs/overhead/README.md):
 * dist-plugin/overhead.reaplugin/{plugin.js, manifest.json}, and the same two
 * files zipped as dist-plugin/overhead.reaplugin-<version>.zip for Decaid's
 * Plugins screen (Install plugin > ZIP file).
 *
 * plugin.js is one script, no imports: Decaid pastes it inside its loader
 * function and then calls `createPlugin(host)`, so the bundle is an IIFE and
 * the footer declares that function. It runs in QuickJS (ES2020 is plenty:
 * DISCOVERY.md section 2), not in the tablet's WebView, so none of the skin's
 * Chromium 91 polyfills belong in it. Not minified, so anyone can read what
 * runs on their tablet.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { zipSync, strToU8 } from 'fflate';
import { overheadManifest } from './src/overhead/plugin/manifest.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const outDir = `${root}dist-plugin/overhead.reaplugin`;

function manifestAndZip(): Plugin {
  return {
    name: 'cafai:overhead-manifest-and-zip',
    apply: 'build',
    writeBundle() {
      const manifest = `${JSON.stringify(overheadManifest(version), null, 2)}\n`;
      writeFileSync(`${outDir}/manifest.json`, manifest);
      const plugin = readFileSync(`${outDir}/plugin.js`);
      mkdirSync(`${root}dist-plugin`, { recursive: true });
      // One wrapper folder: Decaid accepts a zip whose single top-level folder holds manifest.json and plugin.js.
      const zip = zipSync({ 'overhead.reaplugin': { 'manifest.json': strToU8(manifest), 'plugin.js': new Uint8Array(plugin) } }, { level: 9 });
      writeFileSync(`${root}dist-plugin/overhead.reaplugin-${version}.zip`, zip);
    },
  };
}

export default defineConfig({
  publicDir: false,
  define: {
    __OVERHEAD_VERSION__: JSON.stringify(version),
  },
  plugins: [manifestAndZip()],
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2020',
    minify: false,
    sourcemap: false,
    lib: {
      entry: fileURLToPath(new URL('./src/overhead/plugin/entry.ts', import.meta.url)),
      formats: ['iife'],
      name: 'OverheadPluginBundle',
      fileName: () => 'plugin.js',
    },
    rollupOptions: {
      output: {
        banner: `/* overhead.reaplugin ${version}: built from CafAI's src/overhead/plugin (GPL-3.0-only). */`,
        footer: 'function createPlugin(host) { return OverheadPluginBundle.createPlugin(host); }',
      },
    },
  },
});
