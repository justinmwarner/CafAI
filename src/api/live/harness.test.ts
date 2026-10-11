import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecaidSettings, DeviceEntry } from '../types.ts';
import {
  FRAME_PARSERS,
  SIMULATED_MACHINE_IDS,
  channelName,
  checkFrames,
  contextDifference,
  contextNotKept,
  createUndoList,
  openedChannels,
  recordExchanges,
  restoreContext,
  simulatorProblem,
  specProblems,
  telemetryChannels,
  waitUntil,
  type Exchange,
} from './harness.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('telemetryChannels', () => {
  it('lists the channels CafAI’s telemetry store opens, each once', () => {
    const channels = telemetryChannels();
    expect(channels).toContain('/ws/v1/devices');
    expect(channels).toContain('/ws/v1/machine/shotState');
    expect(channels).toContain('/ws/v1/machine/snapshot');
    expect(new Set(channels).size).toBe(channels.length);
  });

  it('has a parser for every one of them, so a new channel cannot go unchecked', () => {
    expect(telemetryChannels().filter((path) => FRAME_PARSERS[path] === undefined)).toEqual([]);
  });

  it("knows apart the channels CafAI opens only while Decaid has their plugin loaded, and has a parser for each", () => {
    const { decaid, plugins } = openedChannels();
    expect(plugins).toEqual(['/ws/v1/plugins/time-to-ready.reaplugin/timeToReady']);
    expect(decaid).toEqual(telemetryChannels());
    expect(plugins.filter((path) => FRAME_PARSERS[path] === undefined)).toEqual([]);
  });

  it('names a channel as the spec does', () => {
    expect(channelName('/ws/v1/machine/snapshot')).toBe('ws/v1/machine/snapshot');
  });
});

describe('recordExchanges', () => {
  it('keeps each exchange and leaves the reply for the caller to read', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{"timeout":42}', { status: 200 })));
    const recorder = recordExchanges();
    const response = await recorder.fetch('http://decaid.test:8080/api/v1/machine/heartbeat?x=1', {
      method: 'post',
      body: '{"a":1}',
    });
    expect(await response.json()).toEqual({ timeout: 42 });
    expect(recorder.exchanges).toEqual<Exchange[]>([
      { method: 'POST', path: '/api/v1/machine/heartbeat?x=1', status: 200, sent: { a: 1 }, body: { timeout: 42 } },
    ]);
  });

  it('reads a GET without a body, a literal null, plain text and an empty reply', async () => {
    const replies = ['null', 'Route not found', ''];
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(replies.shift() ?? '', { status: 404 })));
    const recorder = recordExchanges();
    for (let index = 0; index < 3; index += 1) await recorder.fetch(new URL('http://decaid.test:8080/api/v1/shots/latest'));
    expect(recorder.exchanges.map(({ method, sent, body }) => ({ method, sent, body }))).toEqual([
      { method: 'GET', sent: undefined, body: null },
      { method: 'GET', sent: undefined, body: 'Route not found' },
      { method: 'GET', sent: undefined, body: undefined },
    ]);
  });
});

describe('specProblems', () => {
  function fakeValidator() {
    const calls: unknown[][] = [];
    return {
      calls,
      response(method: string, path: string, status: number, body: unknown) {
        calls.push(['response', method, path, status, body]);
        return path === '/api/v1/workflow' ? ['profile: must be object', 'profile: must be object'] : [];
      },
      request(method: string, path: string, body: unknown) {
        calls.push(['request', method, path, body]);
        return path === '/api/v1/workflow' ? ['context/targetYield: must be number'] : [];
      },
    };
  }
  const exchange = (method: string, path: string, status: number, sent?: unknown, body?: unknown): Exchange => ({
    method,
    path,
    status,
    sent,
    body,
  });

  it('checks the 2xx replies and the bodies sent with them, without the query', () => {
    const validator = fakeValidator();
    const problems = specProblems(validator, [
      exchange('GET', '/api/v1/store/cafai?full=1', 200, undefined, {}),
      exchange('PUT', '/api/v1/workflow', 200, { context: {} }, { id: 'w' }),
    ]);
    expect(validator.calls).toEqual([
      ['response', 'GET', '/api/v1/store/cafai', 200, {}],
      ['request', 'PUT', '/api/v1/workflow', { context: {} }],
      ['response', 'PUT', '/api/v1/workflow', 200, { id: 'w' }],
    ]);
    expect(problems).toEqual([
      'PUT /api/v1/workflow 200, request: context/targetYield: must be number',
      'PUT /api/v1/workflow 200: profile: must be object',
    ]);
  });

  it('leaves refusals and redirects to the tests: a refusal is often the point', () => {
    const validator = fakeValidator();
    const refused = [
      exchange('PUT', '/api/v1/shots/cafai-probe_1', 400, { annotations: { enjoyment: 11 } }, { error: 'x' }),
      exchange('GET', '/api/v1/machine/info', 500, undefined, { error: 'not connected' }),
      exchange('GET', '/api/v1/store/cafai?full=1', 304),
    ];
    expect(specProblems(validator, refused)).toEqual([]);
    expect(validator.calls).toEqual([]);
  });
});

describe('checkFrames', () => {
  const machineFrame = {
    timestamp: '2026-10-09T10:00:00.123456',
    state: { state: 'idle', substate: 'idle' },
    flow: 0,
    pressure: 0,
    targetFlow: 0,
    targetPressure: 0,
    mixTemperature: 90.1,
    groupTemperature: 91.2,
    targetMixTemperature: 92,
    targetGroupTemperature: 93,
    profileFrame: 0,
    steamTemperature: 140,
  };

  it('parses each frame with CafAI’s parser and checks it against the spec', () => {
    const seen: unknown[] = [];
    const validator = {
      frame(channel: string, frame: unknown) {
        seen.push([channel, frame]);
        return ['timestamp: must match format "date-time"'];
      },
    };
    const result = checkFrames('/ws/v1/machine/snapshot', [JSON.stringify(machineFrame), JSON.stringify(machineFrame)], validator);
    expect(result.parsed).toHaveLength(2);
    expect(seen).toEqual([
      ['ws/v1/machine/snapshot', machineFrame],
      ['ws/v1/machine/snapshot', machineFrame],
    ]);
    expect(result.problems).toEqual(['timestamp: must match format "date-time"']);
  });

  it('reports frames that are not JSON or that CafAI’s parser refuses, with an example', () => {
    const validator = { frame: () => [] };
    const result = checkFrames('/ws/v1/devices', ['{"devices":[]}', 'not json', '{"scanning":true}', '{"no":1}'], validator);
    expect(result.parsed).toHaveLength(1);
    expect(result.problems).toEqual(['1 frame is not JSON', 'CafAI’s parser refused 2 of 4 frames, e.g. {"scanning":true}']);
  });

  it('fails a channel the suite has no parser for', () => {
    expect(checkFrames('/ws/v1/new/channel', ['{}'], { frame: () => [] }).problems).toEqual([
      'CafAI opens ws/v1/new/channel, but the live suite has no parser for it (FRAME_PARSERS in harness.ts).',
    ]);
  });
});

describe('createUndoList', () => {
  it('puts writes back newest first, every one even after a failure, and says which failed', async () => {
    const undo = createUndoList();
    const order: string[] = [];
    undo.add('the bean', () => {
      order.push('bean');
      return Promise.resolve();
    });
    undo.add('the batch', () => {
      order.push('batch');
      return Promise.reject(new Error('HTTP 500'));
    });
    undo.add('the workflow', () => {
      order.push('workflow');
      return Promise.resolve();
    });
    expect(await undo.runAll()).toEqual(['the batch: HTTP 500']);
    expect(order).toEqual(['workflow', 'batch', 'bean']);
    expect(await undo.runAll()).toEqual([]);
    expect(order).toHaveLength(3);
  });

  it('runs one now, once, and forgets it; one that fails now stays for the end', async () => {
    const undo = createUndoList();
    const kv = vi.fn(() => Promise.resolve());
    let fail = true;
    const gateway = vi.fn(() => (fail ? Promise.reject(new Error('busy')) : Promise.resolve()));
    const kvNow = undo.add('the KV key', kv);
    const gatewayNow = undo.add('gateway mode', gateway);
    await kvNow();
    await kvNow();
    expect(kv).toHaveBeenCalledTimes(1);
    await expect(gatewayNow()).rejects.toThrow('busy');
    fail = false;
    expect(await undo.runAll()).toEqual([]);
    expect(gateway).toHaveBeenCalledTimes(2);
    expect(kv).toHaveBeenCalledTimes(1);
  });
});

describe('restoreContext, contextNotKept and contextDifference', () => {
  const tag = { cafai: { versionId: 'cafai-contract-test', bagId: 'cafai-contract-test' } };
  const sent = { targetDoseWeight: 18, targetYield: 40, coffeeName: 'Contract test', extras: tag };

  it('puts the original values back and clears what the test added, at every depth (Decaid merges objects key by key)', () => {
    const original = { targetDoseWeight: 16, targetYield: 36, grinderModel: 'Niche Zero', extras: { visualizerId: 'v-1' } };
    expect(restoreContext(original, sent)).toEqual({
      targetDoseWeight: 16,
      targetYield: 36,
      grinderModel: 'Niche Zero',
      coffeeName: null,
      extras: { visualizerId: 'v-1', cafai: null },
    });
    const tagged = { targetYield: 36, extras: { cafai: { versionId: 'ver-1', bagId: 'bag-1' } } };
    expect(restoreContext(tagged, sent)).toEqual({ targetYield: 36, targetDoseWeight: null, coffeeName: null, extras: tagged.extras });
  });

  it('leaves 0 where the original had no target yield: Decaid refuses to clear it', () => {
    expect(restoreContext(undefined, sent)).toEqual({ targetDoseWeight: null, targetYield: 0, coffeeName: null, extras: null });
  });

  it('finds what Decaid did not keep of what was sent, at any depth', () => {
    const kept = { targetDoseWeight: 18, targetYield: 40, coffeeName: 'Contract test', grinderModel: 'Niche Zero', extras: { ...tag, v: 1 } };
    expect(contextNotKept(sent, kept)).toBeNull();
    expect(contextNotKept(sent, { ...kept, targetYield: 36 })).toBe('targetYield: sent 40, got 36');
    expect(contextNotKept(sent, { ...kept, extras: { cafai: { versionId: 'cafai-contract-test' } } })).toBe(
      'extras.cafai.bagId: sent "cafai-contract-test", got none',
    );
    expect(contextNotKept({ grinderId: null }, {})).toBeNull();
  });

  it('finds no difference between equal contexts, whatever the key order; null and 0 yield count as none', () => {
    expect(contextDifference({ targetYield: 36, extras: { a: 1, b: 2 } }, { extras: { b: 2, a: 1 }, targetYield: 36 })).toBeNull();
    expect(contextDifference(undefined, { targetYield: 0 })).toBeNull();
    expect(contextDifference({ coffeeName: 'A' }, { coffeeName: 'A', grinderModel: null })).toBeNull();
    expect(contextDifference({ extras: { visualizerId: 'v-1' } }, { extras: { visualizerId: 'v-1', cafai: null } })).toBeNull();
  });

  it('names the first key that differs, with both values', () => {
    expect(contextDifference({ targetYield: 36 }, { targetYield: 40 })).toBe('targetYield: expected 36, got 40');
    expect(contextDifference({}, { coffeeName: 'Contract test' })).toBe('coffeeName: expected none, got "Contract test"');
    expect(contextDifference({}, { extras: tag })).toBe(
      'extras: expected none, got {"cafai":{"bagId":"cafai-contract-test","versionId":"cafai-contract-test"}}',
    );
  });
});

describe('simulatorProblem', () => {
  const settings = (simulatedDevices: unknown): DecaidSettings => ({ gatewayMode: 'disabled', simulatedDevices });
  const device = (id: string, state: string, type = 'machine'): DeviceEntry => ({ id, name: id, state, type, available: true });

  it('accepts Decaid simulating the machine, with only simulated machines connected', () => {
    expect(simulatorProblem(settings(['machine', 'scale']), [device('MockDe1', 'connected'), device('MockScale', 'connected', 'scale')])).toBeNull();
    expect(simulatorProblem(settings(['bengle']), [])).toBeNull();
    expect([...SIMULATED_MACHINE_IDS]).toContain('MockDe1');
  });

  it('refuses a Decaid that simulates no machine', () => {
    for (const value of [[], ['scale'], undefined, 'machine']) {
      expect(simulatorProblem(settings(value), [])).toBe('Decaid simulates no machine (Settings > Advanced > Simulated Devices)');
    }
  });

  it('refuses a real machine connected beside the simulated one, and ignores one that is not connected', () => {
    const devices = [device('MockDe1', 'connected'), device('D9:12:34', 'connected'), device('E0:00:01', 'disconnected')];
    expect(simulatorProblem(settings(['machine']), devices)).toBe('a real machine is connected: D9:12:34');
  });
});

describe('waitUntil', () => {
  it('resolves with the first value the check gives', async () => {
    let calls = 0;
    const value = await waitUntil(() => (++calls === 3 ? 'finished' : null), 2000, 'the shot', 5);
    expect([value, calls]).toEqual(['finished', 3]);
  });

  it('awaits a check that returns a promise', async () => {
    await expect(waitUntil(() => Promise.resolve(0), 1000, 'a reading', 5)).resolves.toBe(0);
  });

  it('gives up after the timeout, saying what never happened', async () => {
    await expect(waitUntil(() => undefined, 30, 'shotState finished', 5)).rejects.toThrow(
      'Gave up after 0.03 s waiting for shotState finished.',
    );
  });
});
