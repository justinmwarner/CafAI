import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShotUpdateRequest, WireProfile } from '../api/types.ts';
import { createFakeDecaid } from '../ui/testing/fakeServices.ts';
import { createApiPort } from './adapters.ts';

const profile = {
  version: '2',
  title: 'Kiambu AA v1',
  notes: '',
  author: 'Decent',
  beverage_type: 'espresso',
  steps: [],
  target_volume: 0,
  target_weight: 50,
  target_volume_count_start: 2,
  tank_temperature: 0,
} as WireProfile;

describe('createApiPort', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the machine barrier to the client's own origin", async () => {
    const fetch = vi.fn(async () => new Response('null', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const port = createApiPort(createFakeDecaid());
    await expect(port.loadProfileOnMachine(profile)).resolves.toBe('loaded');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/machine/profile',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(profile) }),
    );
  });

  it("writes shot annotations through the client's shot update", async () => {
    const decaid = createFakeDecaid();
    const seen: Array<[string, ShotUpdateRequest]> = [];
    decaid.updateShot = async (id, patch) => {
      seen.push([id, patch]);
      return { id } as Awaited<ReturnType<typeof decaid.updateShot>>;
    };
    const patch: ShotUpdateRequest = { annotations: { enjoyment: 8, extras: { cafai: { stars: 4 } } } };
    await createApiPort(decaid).updateShot('shot-1', patch);
    expect(seen).toEqual([['shot-1', patch]]);
  });
});
