import { describe, expect, it, vi } from 'vitest';
import {
  createStreamCapture,
  createTrafficLog,
  cutText,
  RAW_NOT_KEPT,
  recordExchange,
  recordFrame,
  recordSocket,
  safeSlice,
  trafficName,
  utf8Length,
  type TrafficLogOptions,
  type TrafficTimers,
} from './recorder.ts';
import { KEY_COPY_MARKER, KEY_MARKER } from './redact.ts';

/** A made-up key, built at run time so no key-shaped literal sits in the source. */
const KEY = ['sk', 'ant', 'api03', 'ReCoRdErTeSt0123456789', 'AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789AA'].join('-');
/** A key that does not look like one: only the header it came in, and the KV path it went to, give it away. */
const PLAIN_KEY = 'plain-test-key-0123456789';
const CODE = 'K7QM2XWP';

/** A clock and timers the test moves by hand. */
function harness(options: TrafficLogOptions = {}) {
  let time = 1_000_000;
  const pending: Array<{ at: number; callback: () => void; handle: number }> = [];
  let next = 1;
  const timers: TrafficTimers = {
    setTimeout(callback, ms) {
      const handle = next++;
      pending.push({ at: time + ms, callback, handle });
      return handle;
    },
    clearTimeout(handle) {
      const index = pending.findIndex((timer) => timer.handle === handle);
      if (index >= 0) pending.splice(index, 1);
    },
  };
  const log = createTrafficLog({ now: () => time, timers, ...options });
  return {
    log,
    pending,
    advance(ms: number) {
      time += ms;
      for (const timer of pending.filter((t) => t.at <= time)) {
        pending.splice(pending.indexOf(timer), 1);
        timer.callback();
      }
    },
  };
}

const rest = (what: string, body = '') => ({ direction: 'sent' as const, channel: 'rest' as const, what, body });

describe('createTrafficLog', () => {
  it('keeps entries oldest first, with ascending ids, and the same list until something changes', () => {
    const { log } = harness();
    log.add(rest('GET /api/v1/info'));
    log.add({ direction: 'received', channel: 'rest', what: 'GET /api/v1/info', status: '200', body: '{"version":"0.8.8"}', durationMs: 12 });
    const list = log.list();
    expect(list.map((entry) => [entry.id, entry.direction, entry.what, entry.status])).toEqual([
      [1, 'sent', 'GET /api/v1/info', ''],
      [2, 'received', 'GET /api/v1/info', '200'],
    ]);
    expect(list[1]).toMatchObject({ durationMs: 12, size: 19, body: '{"version":"0.8.8"}', failed: false, frame: false, more: 0 });
    expect(log.list()).toBe(list);
    log.add(rest('GET /api/v1/workflow'));
    expect(log.list()).not.toBe(list);
    expect(log.list()).toHaveLength(3);
  });

  it('drops the oldest entries past the entry cap and the text cap', () => {
    const byCount = harness({ maxEntries: 3 }).log;
    for (let i = 1; i <= 5; i += 1) byCount.add(rest(`GET /${i}`));
    expect(byCount.list().map((entry) => entry.what)).toEqual(['GET /3', 'GET /4', 'GET /5']);

    const byText = harness({ maxTextChars: 250 }).log;
    for (let i = 1; i <= 5; i += 1) byText.add(rest(`GET /${i}`, 'x'.repeat(100)));
    expect(byText.list().map((entry) => entry.what)).toEqual(['GET /4', 'GET /5']);
  });

  it('keeps the last 1000 entries by default, at most 500 of them frames', () => {
    const { log, advance } = harness();
    for (let i = 0; i < 1100; i += 1) log.add(rest(`GET /${i}`));
    expect(log.list()).toHaveLength(1000);
    expect(log.list()[0]!.what).toBe('GET /100');
    for (let i = 0; i < 700; i += 1) {
      log.frame('ws/v1/scale/snapshot', `{"w":${i}}`, true);
      advance(1000);
    }
    expect(log.list().filter((entry) => entry.frame)).toHaveLength(500);
    expect(log.list()).toHaveLength(1000);
  });

  it('lets frames fill at most their share, so they never push the REST calls out', () => {
    const { log, advance } = harness({ maxEntries: 6, maxFrameEntries: 3 });
    log.add(rest('GET /api/v1/workflow'));
    for (let i = 0; i < 10; i += 1) {
      log.frame('ws/v1/machine/snapshot', `{"n":${i}}`, true);
      advance(1000);
    }
    const list = log.list();
    expect(list.map((entry) => entry.what)).toEqual(['GET /api/v1/workflow', 'ws/v1/machine/snapshot', 'ws/v1/machine/snapshot', 'ws/v1/machine/snapshot']);
    expect(list.slice(1).map((entry) => entry.body)).toEqual(['{"n":7}', '{"n":8}', '{"n":9}']);
  });

  it('cuts one huge body, saying how much, and gives its size as it came', () => {
    const { log } = harness({ maxBodyChars: 100 });
    log.add({ ...rest('POST /api/v1/profiles', 'é'.repeat(5000)) });
    const [entry] = log.list();
    expect(entry!.body.startsWith('é'.repeat(100))).toBe(true);
    expect(entry!.body).toContain('[cut here: 5 KB more]');
    expect(entry!.size).toBe(10_000);
  });

  describe('live frames', () => {
    it('keeps one frame a second of a streaming channel, the rest counted on it', () => {
      const { log, advance } = harness();
      log.frame('ws/v1/machine/snapshot', '{"t":0}', true);
      for (let i = 1; i <= 4; i += 1) {
        advance(200);
        log.frame('ws/v1/machine/snapshot', `{"t":${i}}`, true);
      }
      expect(log.list().map((entry) => [entry.body, entry.more])).toEqual([['{"t":0}', 4]]);
      advance(200);
      log.frame('ws/v1/machine/snapshot', '{"t":5}', true);
      expect(log.list().map((entry) => [entry.body, entry.more])).toEqual([
        ['{"t":0}', 4],
        ['{"t":5}', 0],
      ]);
      expect(log.list()[1]).toMatchObject({ channel: 'socket', direction: 'received', status: 'frame', frame: true });
    });

    it('counts per channel', () => {
      const { log, advance } = harness();
      log.frame('ws/v1/machine/snapshot', '{"m":1}', true);
      log.frame('ws/v1/scale/snapshot', '{"w":1}', true);
      advance(100);
      log.frame('ws/v1/scale/snapshot', '{"w":2}', true);
      expect(log.list().map((entry) => [entry.what, entry.more])).toEqual([
        ['ws/v1/machine/snapshot', 0],
        ['ws/v1/scale/snapshot', 1],
      ]);
    });

    it('keeps every new frame of another channel, and counts only its repeats', () => {
      const { log, advance } = harness();
      log.frame('ws/v1/machine/shotState', '{"state":"preheating"}', false);
      advance(100);
      log.frame('ws/v1/machine/shotState', '{"state":"pouring"}', false);
      advance(100);
      log.frame('ws/v1/machine/shotState', '{"state":"pouring"}', false);
      expect(log.list().map((entry) => [entry.body, entry.more])).toEqual([
        ['{"state":"preheating"}', 0],
        ['{"state":"pouring"}', 1],
      ]);
    });

    it('keeps the first frame after a socket opens again', () => {
      const { log, advance } = harness();
      log.frame('ws/v1/scale/snapshot', '{"w":1}', true);
      advance(100);
      log.resetFrames('ws/v1/scale/snapshot');
      log.frame('ws/v1/scale/snapshot', '{"w":2}', true);
      expect(log.list().map((entry) => entry.body)).toEqual(['{"w":1}', '{"w":2}']);
    });
  });

  describe('listeners', () => {
    it('sets no timer while nobody listens', () => {
      const { log, pending } = harness();
      for (let i = 0; i < 50; i += 1) log.frame('ws/v1/machine/snapshot', `{"n":${i}}`, true);
      log.add(rest('GET /api/v1/info'));
      expect(pending).toHaveLength(0);
    });

    it('hears of many changes at most once per interval, and nothing after unsubscribing', () => {
      const { log, pending, advance } = harness();
      const listener = vi.fn();
      const stop = log.subscribe(listener);
      for (let i = 0; i < 20; i += 1) log.add(rest(`GET /${i}`));
      expect(listener).not.toHaveBeenCalled();
      advance(499);
      expect(listener).not.toHaveBeenCalled();
      advance(1);
      expect(listener).toHaveBeenCalledTimes(1);
      log.add(rest('GET /again'));
      stop();
      expect(pending).toHaveLength(0);
      advance(1000);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('clears at once, and says so', () => {
      const { log, advance } = harness();
      log.add(rest('GET /api/v1/info'));
      const listener = vi.fn();
      log.subscribe(listener);
      advance(60_000);
      log.clear();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(log.list()).toEqual([]);
      expect(log.since()).toBe(1_060_000);
    });
  });
});

describe('recordExchange', () => {
  it('keeps the request at once and the reply with its status and time, once', () => {
    const { log, advance } = harness();
    const exchange = recordExchange('rest', 'PUT /api/v1/workflow', { headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' }, log);
    expect(log.list()).toHaveLength(1);
    advance(57);
    exchange.reply(200, { headers: new Headers({ 'content-type': 'application/json' }), body: '{"a":1,"b":2}' });
    exchange.fail('timeout');
    const [sent, received] = log.list();
    expect(sent).toMatchObject({ direction: 'sent', channel: 'rest', what: 'PUT /api/v1/workflow', headers: 'content-type: application/json', body: '{"a":1}' });
    expect(received).toMatchObject({ direction: 'received', status: '200', durationMs: 57, body: '{"a":1,"b":2}', failed: false });
    expect(log.list()).toHaveLength(2);
  });

  it('marks an HTTP error and a request that got no answer as failed', () => {
    const { log } = harness();
    recordExchange('rest', 'GET /api/v1/machine/state', {}, log).reply(500, { body: '{"error":"DeviceNotConnectedException"}' });
    recordExchange('rest', 'GET /api/v1/workflow', {}, log).fail('network error');
    const received = log.list().filter((entry) => entry.direction === 'received');
    expect(received.map((entry) => [entry.status, entry.failed])).toEqual([
      ['500', true],
      ['network error', true],
    ]);
  });

  it('says a stream\'s outcome after its status', () => {
    const { log } = harness();
    recordExchange('coach', 'POST api.anthropic.com/v1/messages', {}, log).reply(200, { body: '{}', outcome: 'end_turn', size: 4096 });
    expect(log.list()[1]).toMatchObject({ status: '200 end_turn', size: 4096 });
  });
});

describe('the key never enters the log', () => {
  it('not from a header, a request body, a URL, an echo in the reply, or the KV copy', () => {
    const { log } = harness();
    // The coach's request: the key in its header, and pasted into the conversation.
    const coach = recordExchange(
      'coach',
      `POST api.anthropic.com/v1/messages?debug=${KEY}`,
      { headers: { 'x-api-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: `here: ${KEY}` }] }) },
      log,
    );
    coach.reply(401, { body: `{"type":"error","error":{"message":"invalid x-api-key ${KEY}"}}` });
    // The key's copy in Decaid (D99), in a shape no pattern knows.
    recordExchange('rest', 'POST /api/v1/store/cafai-key/anthropic', { body: JSON.stringify(PLAIN_KEY) }, log).reply(200, { body: '{}' });
    recordExchange('rest', 'GET /api/v1/store/cafai-key/anthropic', {}, log).reply(200, { body: JSON.stringify(PLAIN_KEY) });
    // A plain key in a header comes out of the reply too.
    recordExchange('coach', 'POST 127.0.0.1:8877/v1/messages', { headers: { 'x-api-key': PLAIN_KEY } }, log).fail('failed', { body: `rejected ${PLAIN_KEY}` });
    // CafAI Bridge's code, echoed back with its dash.
    recordExchange('coach', 'GET 192.168.1.20:8877/v1/status', { headers: { 'x-api-key': CODE } }, log).reply(401, {
      body: '{"error":{"message":"Wrong code K7QM-2XWP"}}',
    });

    const everything = JSON.stringify(log.list());
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain(KEY.slice(7, 30));
    expect(everything).not.toContain(PLAIN_KEY);
    expect(everything).not.toContain(CODE);
    expect(everything).not.toContain('K7QM-2XWP');
    expect(everything).toContain(`x-api-key: ${KEY_MARKER}`);
    // Nothing said to or by the key's copy is kept, but a body with no room for a key (Decaid's "{}").
    const copies = log.list().filter((entry) => entry.what.includes('cafai-key'));
    expect(copies.map((entry) => entry.body)).toEqual([KEY_COPY_MARKER, '{}', '', KEY_COPY_MARKER]);
  });
});

describe('redaction beyond the headers', () => {
  it('takes secrets and key shapes out of header values too (an echo in a reply header)', () => {
    const { log } = harness();
    recordExchange('coach', 'GET 192.168.1.20:8877/v1/status', { headers: { 'x-api-key': CODE } }, log).reply(200, {
      headers: new Headers({ 'x-echo': `${KEY} and K7QM-2XWP`, 'content-type': 'application/json' }),
      body: '{}',
    });
    const received = log.list()[1]!;
    expect(received.headers).toBe(`content-type: application/json\nx-echo: ${KEY_MARKER} and ${KEY_MARKER}`);
  });

  it('looks for a remembered secret wherever it shows: a chat in a backup, a frame', () => {
    const { log } = harness();
    log.rememberSecret(PLAIN_KEY);
    log.rememberSecret(CODE);
    log.rememberSecret('short');
    recordExchange('rest', 'POST /api/v1/store/cafai/conv.bag_1', { body: `{"text":"my code is k7qm-2xwp and ${PLAIN_KEY}"}` }, log).reply(200, { body: '{}' });
    log.frame('ws/v1/devices', `{"name":"${CODE}"}`, false);
    const everything = JSON.stringify(log.list());
    expect(everything).not.toMatch(/k7qm-?2xwp/i);
    expect(everything).not.toContain(PLAIN_KEY);
    expect(log.list()[0]!.body).toBe(`{"text":"my code is ${KEY_MARKER} and ${KEY_MARKER}"}`);
  });

  it("keeps none of a stream's events when the reply, put together, holds a secret split across them", () => {
    const { log } = harness();
    const capture = createStreamCapture();
    for (const piece of ['Your code is K7QM', '-2XWP, keep it.']) {
      const data = JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } });
      capture.event('content_block_delta', data);
      capture.join(JSON.parse(data));
    }
    expect(capture.joined()).toBe('Your code is K7QM-2XWP, keep it.');
    recordExchange('coach', 'POST 192.168.1.20:8877/v1/messages', { headers: { 'x-api-key': CODE } }, log).reply(200, {
      body: '{"content":[{"type":"text","text":"Your code is K7QM-2XWP, keep it."}]}',
      raw: capture.text(),
      rawJoined: capture.joined(),
    });
    const received = log.list()[1]!;
    expect(received.raw).toBe(RAW_NOT_KEPT);
    expect(received.body).toContain(`Your code is ${KEY_MARKER}, keep it.`);
    expect(JSON.stringify(log.list())).not.toContain('K7QM');
  });

  it('keeps the events of a reply that holds no secret', () => {
    const { log } = harness();
    recordExchange('coach', 'POST api.anthropic.com/v1/messages', { headers: { 'x-api-key': KEY } }, log).reply(200, {
      body: '{}',
      raw: 'event: ping\ndata: {}\n\n',
      rawJoined: 'Lovely.',
    });
    expect(log.list()[1]!.raw).toBe('event: ping\ndata: {}\n\n');
  });
});

describe('cutting', () => {
  it('never cuts a character in two', () => {
    expect(safeSlice('ab😀', 3)).toBe('ab');
    expect(safeSlice('ab😀', 4)).toBe('ab😀');
    expect(cutText(`${'x'.repeat(9)}😀tail`, 10)).toBe(`${'x'.repeat(9)}\n[cut here: 1 KB more]`);
  });

  it('redacts a secret across the cut, and only scans the start of a huge reply', () => {
    const { log } = harness({ maxBodyChars: 100 });
    // A key that starts before the cut and ends after it.
    log.add(rest('GET /straddle', `${'a'.repeat(90)}${KEY}${'b'.repeat(50)}`));
    expect(log.list()[0]!.body).toBe(`${'a'.repeat(90)}${KEY_MARKER.slice(0, 10)}\n[cut here: 1 KB more]`);
    // Far past the cut a key is never looked at, and never kept.
    const huge = `${'c'.repeat(50_000)}${KEY}`;
    log.add(rest('GET /huge', huge));
    const entry = log.list()[1]!;
    expect(entry.body).toBe(`${'c'.repeat(100)}\n[cut here: ${Math.round((huge.length - 100) / 1024)} KB more]`);
    expect(entry.size).toBe(huge.length);
  });
});

describe('the clock', () => {
  it('starts a new second when the clock is set back, and never makes a negative time', () => {
    let time = 10_000;
    const log = createTrafficLog({ now: () => time });
    log.frame('ws/v1/machine/snapshot', '{"n":1}', true);
    time = 5_000;
    log.frame('ws/v1/machine/snapshot', '{"n":2}', true);
    expect(log.list().map((entry) => entry.body)).toEqual(['{"n":1}', '{"n":2}']);
    time = 20_000;
    const exchange = recordExchange('rest', 'GET /api/v1/info', {}, log);
    time = 19_000;
    exchange.reply(200, { body: '{}' });
    expect(log.list()[3]!.durationMs).toBe(0);
  });
});

describe('stats', () => {
  it('counts without copying the list', () => {
    const { log, advance } = harness();
    expect(log.stats()).toEqual({ count: 0, oldestAt: null, chars: 0, since: 1_000_000 });
    advance(5000);
    log.add(rest('GET /api/v1/info', '12345'));
    expect(log.stats()).toEqual({ count: 1, oldestAt: 1_005_000, chars: 'GET /api/v1/info'.length + 5, since: 1_000_000 });
  });
});

describe('a log that fails', () => {
  it('never throws into what it watches', () => {
    const { log } = harness();
    const broken = {
      ...log,
      add: () => {
        throw new Error('broken');
      },
      frame: () => {
        throw new Error('broken');
      },
    };
    expect(() => {
      const exchange = recordExchange('rest', 'GET /api/v1/info', {}, broken);
      exchange.reply(200, { body: '{}' });
      exchange.fail('timeout');
      recordSocket('ws/v1/devices', 'received', 'open', false, broken);
      recordFrame('ws/v1/devices', '{}', false, broken);
    }).not.toThrow();
  });
});

describe('sockets', () => {
  it('records socket events and frames into the log it is given', () => {
    const { log } = harness();
    recordSocket('ws/v1/devices', 'sent', 'connect', false, log);
    recordSocket('ws/v1/devices', 'received', 'open', false, log);
    recordFrame('ws/v1/devices', '{"devices":[]}', false, log);
    recordSocket('ws/v1/devices', 'received', 'closed 1006', true, log);
    expect(log.list().map((entry) => [entry.direction, entry.status, entry.failed])).toEqual([
      ['sent', 'connect', false],
      ['received', 'open', false],
      ['received', 'frame', false],
      ['received', 'closed 1006', true],
    ]);
  });
});

describe('helpers', () => {
  it('measures UTF-8 without encoding', () => {
    for (const text of ['', 'abc', 'é', '€', '😀', 'a😀é€\n']) expect(utf8Length(text)).toBe(new TextEncoder().encode(text).length);
  });

  it('cuts text and says how much is left', () => {
    expect(cutText('abc', 3)).toBe('abc');
    expect(cutText('x'.repeat(3000), 1000)).toBe(`${'x'.repeat(1000)}\n[cut here: 2 KB more]`);
  });

  it('names a request to a whole URL by its host and path', () => {
    expect(trafficName('POST', 'https://api.anthropic.com/v1/messages')).toBe('POST api.anthropic.com/v1/messages');
    expect(trafficName('GET', 'http://192.168.1.20:8877/v1/status?probe=1')).toBe('GET 192.168.1.20:8877/v1/status?probe=1');
    expect(trafficName('GET', 'not a url')).toBe('GET not a url');
  });

  it("caps a stream's events and counts the rest", () => {
    const capture = createStreamCapture(60);
    capture.bytes(10);
    capture.event('message_start', '{"a":1}');
    capture.event('ping', '{}');
    capture.event('content_block_delta', '{"delta":"long enough to go over"}');
    capture.event('message_stop', '{}');
    capture.bytes(20);
    expect(capture.size).toBe(30);
    expect(capture.text()).toBe('event: message_start\ndata: {"a":1}\n\nevent: ping\ndata: {}\n\n[2 more events not kept]\n');
  });
});
