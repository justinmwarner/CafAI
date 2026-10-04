import { describe, expect, it } from 'vitest';
import { loadProfileOnMachine, MACHINE_PROFILE_TIMEOUT_MS } from './machineProfile.ts';
import { GatewayError, type WireProfile } from './types.ts';

const profile: WireProfile = {
  version: '2',
  title: 'Kiambu AA v2',
  notes: '',
  author: 'Decent',
  beverage_type: 'espresso',
  steps: [],
  target_volume: 0,
  target_weight: 50,
  target_volume_count_start: 2,
  tank_temperature: 0,
};

interface Seen {
  url: string;
  init: RequestInit;
}

/** A fetch that answers once with `status` and `body`, and records the request. */
function answering(status: number, body: string, seen: Seen[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
}

const client = { httpOrigin: 'http://localhost:8080' };

async function failure(promise: Promise<unknown>): Promise<GatewayError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(GatewayError);
    return error as GatewayError;
  }
  throw new Error('expected a GatewayError');
}

describe('loadProfileOnMachine', () => {
  it('posts the profile exactly as given and resolves "loaded" on 200 null', async () => {
    const seen: Seen[] = [];
    const reordered = { ...profile, steps: [{ name: 'Pour', flow: 2.1, exit: null }] } as unknown as WireProfile;
    await expect(loadProfileOnMachine(client, reordered, { fetch: answering(200, 'null', seen) })).resolves.toBe('loaded');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('http://localhost:8080/api/v1/machine/profile');
    expect(seen[0]!.init.method).toBe('POST');
    // Byte for byte what Decaid returned from the workflow PUT, so it compares equal to what Decaid uploads.
    expect(seen[0]!.init.body).toBe(JSON.stringify(reordered));
    expect(seen[0]!.init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('says "offline" for Decaid\'s no-machine answer', async () => {
    const body = '{"error":"DeviceNotConnectedException: machine not connected"}';
    await expect(loadProfileOnMachine(client, profile, { fetch: answering(500, body) })).resolves.toBe('offline');
  });

  it('says "offline" when the machine dropped during the upload', async () => {
    const body = '{"error":"DeviceNotConnectedException: unknown not connected"}';
    await expect(loadProfileOnMachine(client, profile, { fetch: answering(500, body) })).resolves.toBe('offline');
  });

  it('says "unsupported" for an older Decaid without the route', async () => {
    await expect(loadProfileOnMachine(client, profile, { fetch: answering(404, 'Route not found') })).resolves.toBe('unsupported');
    await expect(loadProfileOnMachine(client, profile, { fetch: answering(405, '') })).resolves.toBe('unsupported');
  });

  it('turns a full write queue into a sentence a barista can act on', async () => {
    const body = '{"error":"Machine write queue is full","message":"De1WriteQueueFullException: 32 pending writes"}';
    const error = await failure(loadProfileOnMachine(client, profile, { fetch: answering(503, body) }));
    expect(error.status).toBe(503);
    expect(error.message).toBe('The machine is busy with other changes. Wait a moment, then try again.');
  });

  it('turns a Bluetooth timeout into a sentence', async () => {
    const body = '{"error":"BleTimeoutException: write timed out"}';
    const error = await failure(loadProfileOnMachine(client, profile, { fetch: answering(504, body) }));
    expect(error.status).toBe(504);
    expect(error.message).toBe('The machine did not answer over Bluetooth in time. Check that it is awake, then try again.');
  });

  it('turns a failed write into a sentence without exception names', async () => {
    const body = '{"error":"Exception: characteristic write failed","st":"#0 ..."}';
    const error = await failure(loadProfileOnMachine(client, profile, { fetch: answering(500, body) }));
    expect(error.status).toBe(500);
    expect(error.message).toBe('The machine did not take the profile. Try again.');
    expect(error.message).not.toMatch(/Exception/);
  });

  it('says so when another write superseded it', async () => {
    const body = '{"error":"Machine write was superseded","message":"De1WriteSupersededException: profile was superseded"}';
    const error = await failure(loadProfileOnMachine(client, profile, { fetch: answering(409, body) }));
    expect(error.message).toBe('Another change reached the machine first. Try again.');
  });

  it('gives up after its deadline', async () => {
    const hanging = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })) as unknown as typeof fetch;
    const error = await failure(loadProfileOnMachine(client, profile, { fetch: hanging, timeoutMs: 20 }));
    expect(error.code).toBe('timeout');
    expect(error.message).toBe('The machine took too long to confirm the profile. Try again.');
  });

  it('waits 20 s by default: an upload over Bluetooth takes seconds', () => {
    expect(MACHINE_PROFILE_TIMEOUT_MS).toBe(20_000);
  });

  it('keeps the network sentence when Decaid cannot be reached', async () => {
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const error = await failure(loadProfileOnMachine(client, profile, { fetch: offline }));
    expect(error.code).toBe('network');
    expect(error.message).toMatch(/Could not reach Decaid/);
  });

  it('trims a trailing slash from the origin', async () => {
    const seen: Seen[] = [];
    await loadProfileOnMachine({ httpOrigin: 'http://decaid.local:8080/' }, profile, { fetch: answering(200, 'null', seen) });
    expect(seen[0]!.url).toBe('http://decaid.local:8080/api/v1/machine/profile');
  });
});
