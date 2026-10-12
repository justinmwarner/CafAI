import { describe, expect, it } from 'vitest';
import {
  emailBody,
  entryLine,
  formatBytes,
  formatEntry,
  formatTrafficLog,
  logFileName,
  logTitle,
  mailtoHref,
  MAILTO_MAX_CHARS,
  prettyBody,
  type LogContext,
} from './format.ts';
import type { TrafficEntry } from './recorder.ts';
import { KEY_MARKER } from './redact.ts';

/** Local times, so the clock reads the same in any time zone. */
const AT = new Date(2026, 9, 11, 21, 4, 5, 123).getTime();

function entry(overrides: Partial<TrafficEntry> = {}): TrafficEntry {
  return {
    id: 1,
    at: AT,
    direction: 'received',
    channel: 'rest',
    what: 'GET /api/v1/workflow',
    status: '200',
    failed: false,
    durationMs: 57,
    size: 3277,
    headers: '',
    body: '{"profile":{"title":"Kiambu AA v2"}}',
    raw: '',
    frame: false,
    more: 0,
    ...overrides,
  };
}

const CONTEXT: LogContext = {
  appVersion: '0.1.0',
  decaidVersion: '0.8.8+2850',
  decaidOrigin: 'http://192.168.1.20:8080',
  userAgent: 'Mozilla/5.0 (Linux; Android 11) Chrome/91.0',
  screen: '962 x 602, pixel ratio 1.33 (screen 1280 x 800)',
  now: new Date(2026, 9, 11, 21, 15, 0),
};

describe('entryLine', () => {
  it('says when, which way, where, what, and how it went', () => {
    expect(entryLine(entry())).toBe('21:04:05.123 ↓ REST GET /api/v1/workflow · 200 · 57 ms · 3.2 KB');
    expect(entryLine(entry({ direction: 'sent', status: '', durationMs: null, size: null }))).toBe('21:04:05.123 ↑ REST GET /api/v1/workflow');
    expect(
      entryLine(entry({ channel: 'socket', what: 'ws/v1/machine/snapshot', status: 'frame', durationMs: null, size: 412, more: 4, frame: true })),
    ).toBe('21:04:05.123 ↓ WS ws/v1/machine/snapshot · frame · 412 B · +4 more');
    expect(entryLine(entry({ channel: 'coach', what: 'POST api.anthropic.com/v1/messages', status: '200 end_turn' }))).toContain('↓ Coach POST');
  });

  it('writes sizes in B, KB and MB', () => {
    expect([formatBytes(0), formatBytes(1023), formatBytes(1536), formatBytes(3 * 1024 * 1024)]).toEqual(['0 B', '1023 B', '1.5 KB', '3.0 MB']);
  });
});

describe('formatEntry', () => {
  it('puts the headers, the body and the stream events under the line', () => {
    const text = formatEntry(entry({ channel: 'coach', headers: 'content-type: text/event-stream', raw: 'event: ping\ndata: {}\n\n' }));
    expect(text.split('\n')).toEqual([
      '21:04:05.123 ↓ Coach GET /api/v1/workflow · 200 · 57 ms · 3.2 KB',
      'content-type: text/event-stream',
      '{"profile":{"title":"Kiambu AA v2"}}',
      'Stream events:',
      'event: ping',
      'data: {}',
    ]);
  });

  it('shortens a body only when asked', () => {
    const long = entry({ body: 'x'.repeat(1000) });
    expect(formatEntry(long)).toContain('x'.repeat(1000));
    expect(formatEntry(long, 100)).toContain(`${'x'.repeat(100)} [… shortened]`);
  });
});

describe('formatTrafficLog', () => {
  it('starts with versions, the device, the time range, the count and that the key is never in it', () => {
    const entries = [entry({ id: 1, direction: 'sent', status: '', durationMs: null, size: null }), entry({ id: 2, at: AT + 57 })];
    const text = formatTrafficLog(entries, CONTEXT);
    const lines = text.split('\n');
    expect(lines.slice(0, 7)).toEqual([
      'CafAI log, 2026-10-11 21:15',
      'CafAI 0.1.0, Decaid 0.8.8+2850 at http://192.168.1.20:8080',
      'Browser: Mozilla/5.0 (Linux; Android 11) Chrome/91.0',
      'Screen: 962 x 602, pixel ratio 1.33 (screen 1280 x 800)',
      expect.stringMatching(/^Entries: 2 entries, 2026-10-11 21:04:05 to 21:04:05 \(UTC[+-]\d\d:\d\d\), oldest first$/),
      expect.stringContaining('Live frames:'),
      `The API key and CafAI Bridge's pairing code are never in this log: ${KEY_MARKER} marks where one was taken out.`,
    ]);
    expect(text).toContain('\n\n21:04:05.123 ↑ REST GET /api/v1/workflow\n{"profile"');
    expect(text.indexOf('↑ REST')).toBeLessThan(text.indexOf('↓ REST'));
  });

  it('dates the end of a log that runs past midnight', () => {
    const late = new Date(2026, 9, 11, 23, 59, 30).getTime();
    const early = new Date(2026, 9, 12, 0, 0, 30).getTime();
    const text = formatTrafficLog([entry({ at: late }), entry({ id: 2, at: early })], CONTEXT);
    expect(text).toMatch(/Entries: 2 entries, 2026-10-11 23:59:30 to 2026-10-12 00:00:30 \(UTC/);
  });

  it('says when Decaid did not say its version, and when there is nothing', () => {
    const text = formatTrafficLog([], { ...CONTEXT, decaidVersion: null });
    expect(text).toContain('Decaid version unknown at http://192.168.1.20:8080');
    expect(text).toContain('Entries: No entries.');
  });
});

describe('emailBody', () => {
  const many = Array.from({ length: 200 }, (_, i) => entry({ id: i + 1, at: AT + i * 1000, what: `GET /api/v1/shots/${i + 1}`, body: `{"n":${i + 1}}` }));

  it('keeps the newest entries that fit in a mailto: link, oldest first, and says what was cut', () => {
    const body = emailBody(many, CONTEXT);
    const href = mailtoHref(logTitle(CONTEXT.now), body);
    expect(href.length).toBeLessThanOrEqual(MAILTO_MAX_CHARS);
    expect(body).toMatch(/Cut to fit an email: the oldest \d+ of 200 entries are left out\. Share or Copy in CafAI's Settings > Log has all of it\./);
    expect(body).toContain('GET /api/v1/shots/200');
    expect(body).not.toContain('GET /api/v1/shots/1 ');
    expect(body.indexOf('/shots/199')).toBeLessThan(body.indexOf('/shots/200'));
    expect(body.startsWith('CafAI log, 2026-10-11 21:15\n')).toBe(true);
  });

  it('keeps everything when it fits, shortening long bodies and saying so', () => {
    expect(emailBody(many.slice(0, 3), CONTEXT)).not.toContain('Cut to fit');
    const long = emailBody([entry({ body: 'y'.repeat(5000) })], CONTEXT);
    expect(long).toContain('Long bodies are shortened to fit an email.');
    expect(long).toContain('[… shortened]');
  });

  it('never throws on an emoji where a body is shortened, nor on half of one', () => {
    // An emoji across the 600th character: a plain slice would leave half of it, which encodeURIComponent throws on.
    const body = `${'x'.repeat(599)}😀${'y'.repeat(100)}`;
    const text = emailBody([entry({ body })], CONTEXT);
    expect(text).toContain(`${'x'.repeat(599)} [… shortened]`);
    expect(() => mailtoHref(logTitle(CONTEXT.now), text)).not.toThrow();
    expect(() => mailtoHref('s', `lone ${'\uD83D'} half`)).not.toThrow();
    expect(decodeURIComponent(mailtoHref('s', `a\uD83Db`).split('&body=')[1]!)).toBe('a�b');
  });

  it('is encoded as RFC 6068 asks: CRLF line breaks, everything percent-encoded', () => {
    const href = mailtoHref('CafAI log, 2026-10-11 21:15', 'a & b\n↑');
    expect(href).toBe('mailto:?subject=CafAI%20log%2C%202026-10-11%2021%3A15&body=a%20%26%20b%0D%0A%E2%86%91');
  });
});

describe('prettyBody', () => {
  it('pretty-prints JSON and leaves anything else as it is', () => {
    expect(prettyBody('{"a":1,"b":[1,2]}')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
    expect(prettyBody('Route not found')).toBe('Route not found');
    expect(prettyBody('{"cut":"x\n[cut here: 2 KB more]')).toBe('{"cut":"x\n[cut here: 2 KB more]');
  });

  it('leaves JSON as it is when re-printing would change a number in it', () => {
    expect(prettyBody('{"id":12345678901234567890}')).toBe('{"id":12345678901234567890}');
    expect(prettyBody('{"id":"12345678901234567890","t":1760212345678}')).toBe('{\n  "id": "12345678901234567890",\n  "t": 1760212345678\n}');
  });
});

describe('names', () => {
  it("dates the shared file and the email's subject", () => {
    expect(logTitle(CONTEXT.now)).toBe('CafAI log, 2026-10-11 21:15');
    expect(logFileName(CONTEXT.now)).toBe('cafai-log-2026-10-11-2115.txt');
  });
});
