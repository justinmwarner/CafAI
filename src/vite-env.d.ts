/// <reference types="vite/client" />

/** package.json version, injected by vite.config.ts `define`. */
declare const __CAFAI_VERSION__: string;

interface ImportMetaEnv {
  /** Microsoft Clarity's project for release builds (D-USAGE-6), from release.yml; read by production builds only. */
  readonly VITE_CLARITY_PROJECT_ID?: string;
}
