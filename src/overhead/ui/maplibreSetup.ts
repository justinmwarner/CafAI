/**
 * Points MapLibre at its worker, compiled for Chromium 91 and inlined in the
 * bundle (vite.config.ts, maplibreWorkerInline; DECISIONS O7): a blob: URL on
 * the page's own origin, which MapLibre starts as a module worker.
 */
import { setWorkerUrl } from 'maplibre-gl';
import workerSource from 'virtual:maplibre-worker-source';

let workerUrl: string | null = null;

export function ensureMaplibreWorker(): void {
  if (workerUrl !== null) return;
  workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  setWorkerUrl(workerUrl);
}
