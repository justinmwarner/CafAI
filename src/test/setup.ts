// Global test setup: DOM matchers, an in-memory IndexedDB, and React Testing
// Library cleanup after each DOM test (RTL only auto-cleans with vitest globals).
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';

afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
