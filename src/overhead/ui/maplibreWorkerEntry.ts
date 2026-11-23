/**
 * MapLibre's worker, as CafAI builds it (vite.config.ts, maplibreWorkerInline;
 * docs/overhead/DECISIONS.md, O7): compiled for Chromium 91 with the
 * polyfills it needs there (it uses Array.prototype.at and Object.hasOwn,
 * Chromium 92 and 93) and inlined in the one bundle, so no second file can
 * go missing while Decaid updates the skin in place.
 *
 * MapLibre's package says its JS has no side effects, so the module's own
 * start (`self.worker = new Worker(self)`) would be shaken out of a bundle
 * that only imports it: its class is imported and started here instead,
 * unless the module already did.
 */
import 'core-js/actual/array/at';
import 'core-js/actual/object/has-own';
import 'core-js/actual/string/at';
import 'core-js/actual/typed-array/at';
import MaplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs';

const scope = self as unknown as { worker?: unknown };
if (!scope.worker) scope.worker = new MaplibreWorker(self);
