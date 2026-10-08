import { describe, expect, it, vi } from 'vitest';
import {
  CHROMIUM_FLOOR,
  dismissEngineWarning,
  ENGINE_WARNING_KEY,
  engineWarning,
  isEngineWarningDismissed,
  readEngineCheck,
  type EngineCheck,
} from './engineCheck.ts';

const OLD: EngineCheck = { chromium: 85, supported: false, reason: 'version' };
const OLD_UNNAMED: EngineCheck = { chromium: null, supported: false, reason: 'probe' };

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('readEngineCheck', () => {
  it("reads the inline script's verdict", () => {
    expect(readEngineCheck({ chromium: 85, supported: false, reason: 'version' })).toEqual(OLD);
    expect(readEngineCheck({ chromium: null, supported: true, reason: 'probe' })).toEqual({ chromium: null, supported: true, reason: 'probe' });
    expect(readEngineCheck({ chromium: null, supported: null, reason: 'probe' })).toEqual({ chromium: null, supported: null, reason: 'probe' });
  });

  it('is null when there was no check (previews, tests, a page without the script)', () => {
    expect(readEngineCheck(undefined)).toBeNull();
    expect(readEngineCheck(null)).toBeNull();
    expect(readEngineCheck('false')).toBeNull();
  });

  it('never trusts a malformed verdict to warn', () => {
    expect(readEngineCheck({ chromium: 85, supported: 'no', reason: 'version' })).toBeNull();
    expect(readEngineCheck({ chromium: 85, reason: 'version' })).toBeNull();
    expect(readEngineCheck({ chromium: '85', supported: false, reason: 'version' })).toEqual({ ...OLD, chromium: null });
    expect(readEngineCheck({ chromium: Number.NaN, supported: false, reason: 'probe' })?.chromium).toBeNull();
    expect(readEngineCheck({ chromium: 85, supported: false, reason: 'guess' })?.reason).toBe('probe');
  });
});

describe('engineWarning', () => {
  it('names the version when the engine gave one', () => {
    expect(engineWarning(OLD)).toBe(
      "This device's browser engine (Chromium 85) is older than CafAI is built for (Chromium 91 or newer), so some parts may not work.",
    );
  });

  it('does not depend on a number (Decaid hides the version)', () => {
    expect(engineWarning(OLD_UNNAMED)).toBe(
      "This device's browser engine is older than CafAI is built for (Chromium 91 or newer), so some parts may not work.",
    );
  });

  it('says nothing for a supported, unknown or unchecked engine', () => {
    expect(engineWarning({ chromium: 120, supported: true, reason: 'probe' })).toBeNull();
    expect(engineWarning({ chromium: null, supported: null, reason: 'probe' })).toBeNull();
    expect(engineWarning(null)).toBeNull();
  });

  it('the floor is the one the build targets', () => {
    expect(CHROMIUM_FLOOR).toBe(91);
  });
});

describe('dismissal, remembered per engine version', () => {
  it('stays dismissed for the same version', () => {
    const storage = memoryStorage();
    expect(isEngineWarningDismissed(OLD, storage)).toBe(false);
    dismissEngineWarning(OLD, storage);
    expect(storage.data.get(ENGINE_WARNING_KEY)).toBe('85');
    expect(isEngineWarningDismissed(OLD, storage)).toBe(true);
  });

  it('warns again when the engine changes', () => {
    const storage = memoryStorage({ [ENGINE_WARNING_KEY]: '85' });
    expect(isEngineWarningDismissed({ ...OLD, chromium: 88 }, storage)).toBe(false);
    expect(isEngineWarningDismissed(OLD_UNNAMED, storage)).toBe(false);
  });

  it('an engine without a version is remembered as "unknown"', () => {
    const storage = memoryStorage();
    dismissEngineWarning(OLD_UNNAMED, storage);
    expect(storage.data.get(ENGINE_WARNING_KEY)).toBe('unknown');
    expect(isEngineWarningDismissed(OLD_UNNAMED, storage)).toBe(true);
  });

  it('survives a WebView that refuses storage (the warning just comes back)', () => {
    const refusing = {
      getItem: vi.fn(() => {
        throw new Error('SecurityError');
      }),
      setItem: vi.fn(() => {
        throw new Error('QuotaExceededError');
      }),
    };
    expect(() => dismissEngineWarning(OLD, refusing)).not.toThrow();
    expect(isEngineWarningDismissed(OLD, refusing)).toBe(false);
  });
});
