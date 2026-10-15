import { describe, expect, it } from 'vitest';
import { outsideLinkProps, videoPlaysInPlace } from './videoPlace.ts';

describe('videoPlaysInPlace', () => {
  it('in a browser, and inside Decaid on Android', () => {
    expect(videoPlaysInPlace({ insideDecaid: false, platform: null })).toBe(true);
    expect(videoPlaysInPlace({ insideDecaid: true, platform: 'android' })).toBe(true);
  });

  it('nowhere else inside Decaid, nor where Decaid does not say', () => {
    for (const platform of ['windows', 'macos', 'ios', 'linux', 'fuchsia', null]) {
      expect(videoPlaysInPlace({ insideDecaid: true, platform })).toBe(false);
    }
  });
});

describe('outsideLinkProps', () => {
  it('a plain link inside Decaid, which opens it in the system browser', () => {
    expect(outsideLinkProps({ insideDecaid: true })).toEqual({});
  });

  it('a new tab in a browser, so CafAI stays open', () => {
    expect(outsideLinkProps({ insideDecaid: false })).toEqual({ target: '_blank', rel: 'noopener noreferrer' });
  });
});
