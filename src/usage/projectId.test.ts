import { afterEach, describe, expect, it, vi } from 'vitest';
import { clarityProjectId, MOCK_PROJECT_ID } from './projectId.ts';

const at = (search: string) => ({ location: { search } }) as unknown as Window;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('clarityProjectId (D-USAGE-6)', () => {
  it("is a production build's VITE_CLARITY_PROJECT_ID, trimmed", () => {
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_CLARITY_PROJECT_ID', ' abc123 ');
    expect(clarityProjectId(at(''))).toBe('abc123');
  });

  it('is none for a production build without one', () => {
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_CLARITY_PROJECT_ID', '');
    expect(clarityProjectId(at(''))).toBeNull();
  });

  it('is none in dev and tests, whatever the shell holds', () => {
    vi.stubEnv('VITE_CLARITY_PROJECT_ID', 'abc123');
    for (const mode of ['development', 'test']) {
      vi.stubEnv('MODE', mode);
      expect(clarityProjectId(at('')), mode).toBeNull();
    }
  });

  it("is the e2e's stand-in in mock mode only with ?mockUsage=1, never in the demo or against a real Decaid", () => {
    vi.stubEnv('MODE', 'mock');
    expect(clarityProjectId(at('?mockUsage=1'))).toBe(MOCK_PROJECT_ID);
    expect(clarityProjectId(at('?mockUsage=1&demo=1'))).toBeNull();
    expect(clarityProjectId(at('?mockUsage=1&mockDecaid=0'))).toBeNull();
    expect(clarityProjectId(at('?mockSpeed=25'))).toBeNull();
  });
});
