/// <reference types="vite/client" />

/** package.json version, injected by vite.config.ts `define`. */
declare const __CAFAI_VERSION__: string;

interface ImportMetaEnv {
  /** Microsoft Clarity's project for release builds (D215), from release.yml; read by production builds only. */
  readonly VITE_CLARITY_PROJECT_ID?: string;
  /** "1" builds CafAI with its DEBUG flag on from the first page (docs/DEBUG.md), whatever Decaid's store says. */
  readonly VITE_CAFAI_DEBUG?: string;
}
