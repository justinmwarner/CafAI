/** The MapLibre worker's source, compiled for Chromium 91 (vite.config.ts, maplibreWorkerInline). */
declare module 'virtual:maplibre-worker-source' {
  const source: string;
  export default source;
}

/** MapLibre's worker module (no types of its own): its default export is the worker, started with the worker's global scope. */
declare module 'maplibre-gl/dist/maplibre-gl-worker.mjs' {
  const MaplibreWorker: new (scope: unknown) => unknown;
  export default MaplibreWorker;
}
