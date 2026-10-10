import { describe, expect, inject, it } from 'vitest';
import { DECAID_SUITE_FLAG, decaidMode, suite } from './env.ts';

describe('decaidMode', () => {
  const url = { DECAID_URL: 'http://192.168.1.42:8080' };

  it('runs read-only against DECAID_URL under the Decaid config', () => {
    expect(decaidMode(url, true)).toEqual({ url: 'http://192.168.1.42:8080', reason: '', write: false, sim: false, require: false });
  });

  it('never runs outside the Decaid config, whatever the environment says (npm test)', () => {
    const mode = decaidMode({ ...url, DECAID_WRITE: '1', DECAID_SIM: '1', DECAID_REQUIRE: '1' }, false);
    expect(mode).toMatchObject({ url: null, write: false, sim: false, require: false });
    expect(mode.reason).toContain('npm run test:decaid');
  });

  it('skips without DECAID_URL, and a blank one counts as none', () => {
    for (const env of [{}, { DECAID_URL: '' }, { DECAID_URL: '  \n', DECAID_WRITE: '1' }]) {
      expect(decaidMode(env, true)).toEqual({ url: null, reason: 'DECAID_URL is not set', write: false, sim: false, require: false });
    }
  });

  it('keeps the origin alone: no trailing slash, no spaces', () => {
    expect(decaidMode({ DECAID_URL: ' http://localhost:8080/ ' }, true).url).toBe('http://localhost:8080');
    expect(decaidMode({ DECAID_URL: 'https://decaid.local' }, true).url).toBe('https://decaid.local');
  });

  it('writes only for exactly DECAID_WRITE=1, and DECAID_SIM=1 writes too', () => {
    expect(decaidMode({ ...url, DECAID_WRITE: '1' }, true)).toMatchObject({ write: true, sim: false });
    expect(decaidMode({ ...url, DECAID_WRITE: ' 1 ' }, true)).toMatchObject({ write: true, sim: false });
    expect(decaidMode({ ...url, DECAID_SIM: '1' }, true)).toMatchObject({ write: true, sim: true });
    for (const value of ['', '0', 'true', 'yes', 'on']) {
      expect(decaidMode({ ...url, DECAID_WRITE: value, DECAID_SIM: value }, true)).toMatchObject({ write: false, sim: false });
    }
  });

  it('requires every check to run only for exactly DECAID_REQUIRE=1, with or without DECAID_URL', () => {
    expect(decaidMode({ ...url, DECAID_REQUIRE: '1' }, true).require).toBe(true);
    expect(decaidMode({ DECAID_REQUIRE: ' 1 ' }, true)).toEqual({ url: null, reason: 'DECAID_URL is not set', write: false, sim: false, require: true });
    for (const value of ['', '0', 'true', 'yes']) expect(decaidMode({ ...url, DECAID_REQUIRE: value }, true).require).toBe(false);
  });

  it('refuses an address that is not an http origin, with an example', () => {
    for (const value of ['localhost:8080', '192.168.1.42', 'ws://localhost:8080', 'http://localhost:8080/api/v1', 'http://x:8080/?a=1']) {
      expect(() => decaidMode({ DECAID_URL: value }, true), value).toThrow('like http://192.168.1.42:8080');
    }
  });

  it('is off under the unit config: only vitest.decaid.config.ts provides the flag', () => {
    expect(inject(DECAID_SUITE_FLAG)).toBeUndefined();
  });
});

describe('suite', () => {
  const origin = 'http://localhost:8080';
  const read = decaidMode({ DECAID_URL: origin }, true);
  const sim = decaidMode({ DECAID_URL: origin, DECAID_SIM: '1' }, true);
  const none = decaidMode({}, true);

  it('runs the read-only checks whenever there is a Decaid', () => {
    expect(suite(read, 'read')).toEqual({ title: `Decaid at ${origin}, read-only`, url: origin, refusal: null });
    expect(suite(none, 'read')).toEqual({ title: 'Decaid, read-only (skipped: DECAID_URL is not set)', url: null, refusal: null });
  });

  it('runs writes and the shot only when asked for, and says how', () => {
    expect(suite(read, 'write')).toEqual({ title: 'Decaid, writes (skipped: needs DECAID_WRITE=1, against a simulator only)', url: null, refusal: null });
    expect(suite(read, 'shot')).toEqual({ title: 'Decaid, a simulated shot (skipped: needs DECAID_SIM=1, against a simulator only)', url: null, refusal: null });
    expect(suite(sim, 'write')).toEqual({ title: `Decaid at ${origin}, writes, each put back`, url: origin, refusal: null });
    expect(suite(sim, 'shot')).toEqual({ title: `Decaid at ${origin}, a simulated shot`, url: origin, refusal: null });
    expect(suite(none, 'shot').title).toBe('Decaid, a simulated shot (skipped: DECAID_URL is not set)');
  });

  it('under DECAID_REQUIRE=1 turns every skip into a refusal that says why, so the gate cannot pass on checks that never ran', () => {
    const noUrl = decaidMode({ DECAID_REQUIRE: '1' }, true);
    expect(suite(noUrl, 'read')).toEqual({
      title: 'Decaid, read-only (cannot run: DECAID_URL is not set)',
      url: null,
      refusal: 'DECAID_REQUIRE=1 lets nothing be skipped, but the read-only checks cannot run: DECAID_URL is not set.',
    });
    const readOnly = decaidMode({ DECAID_URL: origin, DECAID_REQUIRE: '1' }, true);
    expect(suite(readOnly, 'read')).toEqual({ title: `Decaid at ${origin}, read-only`, url: origin, refusal: null });
    expect(suite(readOnly, 'write').refusal).toBe(
      'DECAID_REQUIRE=1 lets nothing be skipped, but the writes cannot run: needs DECAID_WRITE=1, against a simulator only.',
    );
    expect(suite(readOnly, 'shot').refusal).toBe(
      'DECAID_REQUIRE=1 lets nothing be skipped, but the simulated shot cannot run: needs DECAID_SIM=1, against a simulator only.',
    );
    const all = decaidMode({ DECAID_URL: origin, DECAID_SIM: '1', DECAID_REQUIRE: '1' }, true);
    for (const kind of ['read', 'write', 'shot'] as const) expect(suite(all, kind)).toMatchObject({ url: origin, refusal: null });
  });
});
