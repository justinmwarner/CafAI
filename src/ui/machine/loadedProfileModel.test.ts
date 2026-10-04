import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow } from '../../api/types.ts';
import { SAMPLE_WORKFLOW } from '../testing/fakeServices.ts';
import { createRefresher, isActiveBagVersion, readLoadedProfile, type LoadedProfileReading } from './loadedProfileModel.ts';

function workflow(title: string, extras?: Record<string, unknown>): Workflow {
  return {
    ...SAMPLE_WORKFLOW,
    profile: { ...SAMPLE_WORKFLOW.profile, title },
    context: extras ? { ...SAMPLE_WORKFLOW.context, extras } : { ...SAMPLE_WORKFLOW.context },
  };
}

const ACTIVE = { bagId: 'bag_1', versionId: 'ver_2', title: 'Kiambu AA v2' };

describe('readLoadedProfile', () => {
  it("reads the profile's title and CafAI's tag (D41)", () => {
    expect(readLoadedProfile(workflow('Kiambu AA v2', { cafai: { versionId: 'ver_2', bagId: 'bag_1' } }))).toEqual({
      title: 'Kiambu AA v2',
      versionId: 'ver_2',
      bagId: 'bag_1',
    });
  });

  it('a workflow CafAI never tagged has no version', () => {
    expect(readLoadedProfile(workflow('Blooming Espresso'))).toEqual({ title: 'Blooming Espresso', versionId: null, bagId: null });
    const noContext: Workflow = { ...SAMPLE_WORKFLOW };
    delete noContext.context;
    expect(readLoadedProfile(noContext).versionId).toBeNull();
    expect(readLoadedProfile(workflow('X', { dye2: { beanId: 'b' } })).versionId).toBeNull();
  });

  it('ignores a malformed tag', () => {
    expect(readLoadedProfile(workflow('X', { cafai: 'ver_2' })).versionId).toBeNull();
    expect(readLoadedProfile(workflow('X', { cafai: { versionId: 42, bagId: ['bag_1'] } }))).toEqual({
      title: 'X',
      versionId: null,
      bagId: null,
    });
  });

  it('survives a profile without a title', () => {
    const odd = { ...SAMPLE_WORKFLOW, profile: { ...SAMPLE_WORKFLOW.profile, title: undefined } } as unknown as Workflow;
    expect(readLoadedProfile(odd).title).toBe('');
  });
});

describe('isActiveBagVersion', () => {
  const reading = (patch: Partial<LoadedProfileReading> = {}): LoadedProfileReading => ({
    title: 'Kiambu AA v2',
    versionId: 'ver_2',
    bagId: 'bag_1',
    ...patch,
  });

  it("is the bag's version when the tag names it and the titles match", () => {
    expect(isActiveBagVersion(reading(), ACTIVE)).toBe(true);
  });

  it('never claims a match it cannot see', () => {
    // Two bags can share a name: a title alone is not enough.
    expect(isActiveBagVersion(reading({ versionId: null, bagId: null }), ACTIVE)).toBe(false);
    // Another skin loaded its own profile and left CafAI's tag behind (Decaid merges extras).
    expect(isActiveBagVersion(reading({ title: 'Blooming Espresso' }), ACTIVE)).toBe(false);
    // The tag names another version, or another bag.
    expect(isActiveBagVersion(reading({ versionId: 'ver_1' }), ACTIVE)).toBe(false);
    expect(isActiveBagVersion(reading({ bagId: 'bag_9' }), ACTIVE)).toBe(false);
    // No active version to match.
    expect(isActiveBagVersion(reading(), { bagId: null, versionId: null, title: null })).toBe(false);
  });

  it('a tag without a bag id still names a unique version', () => {
    expect(isActiveBagVersion(reading({ bagId: null }), ACTIVE)).toBe(true);
  });
});

describe('createRefresher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A read that stays in flight until the test settles it. */
  function controlledRead() {
    const settles: Array<(ok: boolean) => void> = [];
    const read = vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          settles.push((ok) => (ok ? resolve() : reject(new Error('Decaid is not answering'))));
        }),
    );
    const settle = async (ok = true) => {
      settles.shift()?.(ok);
      await vi.advanceTimersByTimeAsync(0);
    };
    return { read, settle, get pending() {
      return settles.length;
    } };
  }

  it('keeps at most one read in flight, and reads once more after it if asked meanwhile', async () => {
    const { read, settle } = controlledRead();
    const refresher = createRefresher(read, 500);
    refresher.now();
    refresher.now();
    refresher.now();
    expect(read).toHaveBeenCalledTimes(1);
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('debounces soon(): one read after a quiet spell', async () => {
    const { read } = controlledRead();
    const refresher = createRefresher(read, 500);
    refresher.soon();
    await vi.advanceTimersByTimeAsync(300);
    refresher.soon();
    await vi.advanceTimersByTimeAsync(499);
    expect(read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('now() covers a pending soon()', async () => {
    const { read, settle } = controlledRead();
    const refresher = createRefresher(read, 500);
    refresher.soon();
    refresher.now();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('a failed read does not stop later ones', async () => {
    const { read, settle } = controlledRead();
    const refresher = createRefresher(read, 500);
    refresher.now();
    await settle(false);
    refresher.now();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('a read that throws before returning a promise does not wedge it', async () => {
    let calls = 0;
    const refresher = createRefresher(() => {
      calls += 1;
      throw new Error('boom');
    }, 500);
    refresher.now();
    await vi.advanceTimersByTimeAsync(0);
    refresher.now();
    expect(calls).toBe(2);
  });

  it('reads nothing after dispose()', async () => {
    const { read, settle } = controlledRead();
    const refresher = createRefresher(read, 500);
    refresher.now();
    refresher.now();
    refresher.soon();
    refresher.dispose();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    refresher.now();
    refresher.soon();
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
