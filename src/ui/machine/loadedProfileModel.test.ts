import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow } from '../../api/types.ts';
import { SAMPLE_WORKFLOW } from '../testing/fakeServices.ts';
import { normalizeProfile } from '../../../mock/decaid/profiles.ts';
import blooming from '../../coach/templates/source/Blooming_espresso.json';
import {
  createRefresher,
  isActiveBagVersion,
  profileMark,
  profileStepNames,
  readLoadedProfile,
  sameStepNames,
  sentenceCase,
  stepNameAt,
  stepProgress,
  workflowTargetYield,
  type LoadedProfileReading,
} from './loadedProfileModel.ts';

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

describe('profileStepNames', () => {
  it("lists the workflow profile's steps in order, as the machine numbers them (profileFrame)", () => {
    const bloomingWorkflow: Workflow = { ...SAMPLE_WORKFLOW, profile: normalizeProfile(blooming) };
    expect(profileStepNames(bloomingWorkflow)).toEqual(['preinfusion start', 'preinfusion', 'pause', 'ramp', 'flat flow', 'reset temperature']);
  });

  it('has nothing to name without steps, and blanks a step without a usable name', () => {
    expect(profileStepNames(SAMPLE_WORKFLOW)).toBeNull();
    const noSteps = { ...SAMPLE_WORKFLOW, profile: { ...SAMPLE_WORKFLOW.profile, steps: undefined } } as unknown as Workflow;
    expect(profileStepNames(noSteps)).toBeNull();
    const odd = { ...SAMPLE_WORKFLOW, profile: { ...SAMPLE_WORKFLOW.profile, steps: [{ name: ' Fill ' }, { name: 3 }, null] } } as unknown as Workflow;
    expect(profileStepNames(odd)).toEqual(['Fill', '', '']);
  });

  it('sameStepNames compares by content, so a read that changes nothing keeps the list', () => {
    expect(sameStepNames(['Fill', 'Pour'], ['Fill', 'Pour'])).toBe(true);
    expect(sameStepNames(['Fill', 'Pour'], ['Fill'])).toBe(false);
    expect(sameStepNames(['Fill'], ['Soak'])).toBe(false);
    expect(sameStepNames(null, null)).toBe(true);
    expect(sameStepNames(null, ['Fill'])).toBe(false);
  });
});

describe('the running step', () => {
  const names = ['Fill', 'Bloom', 'Pour'];

  it("names step profileFrame (0-based) of the workflow's profile", () => {
    expect(stepNameAt(names, 0)).toBe('Fill');
    expect(stepNameAt(names, 2)).toBe('Pour');
    expect(stepNameAt(['Fill', ''], 1)).toBe('');
    for (const frame of [3, -1, 1.5, Number.NaN, null, undefined, '1']) {
      expect(stepNameAt(names, frame), String(frame)).toBeNull();
    }
    expect(stepNameAt(null, 0)).toBeNull();
  });

  it('counts the steps for the Shot view, and names a one-step profile by its step alone', () => {
    expect(stepProgress(names, 2)).toBe('Pour · step 3 of 3');
    expect(stepProgress(names, 0)).toBe('Fill · step 1 of 3');
    expect(stepProgress(['Flat 9 bar'], 0)).toBe('Flat 9 bar');
  });

  it('names the step in sentence case, whatever case the profile spells it in', () => {
    // Blooming Espresso's own names, all lowercase.
    const blooming = ['preinfusion start', 'preinfusion', 'pause', 'ramp', 'flat flow', 'reset temperature'];
    expect(stepProgress(blooming, 0)).toBe('Preinfusion start · step 1 of 6');
    expect(stepProgress(blooming, 2)).toBe('Pause · step 3 of 6');
    // Londonium's, in title case.
    expect(stepProgress(['Fill start', 'Pressure Up', 'Flow Limit'], 1)).toBe('Pressure up · step 2 of 3');
    expect(stepProgress(['hold at 4.5 ml/s'], 0)).toBe('Hold at 4.5 ml/s');
  });

  it('says nothing when the step or its name is unknown', () => {
    expect(stepProgress(null, 0)).toBeNull();
    expect(stepProgress(names, 3)).toBeNull();
    expect(stepProgress(names, undefined)).toBeNull();
    expect(stepProgress(['Fill', '', 'Pour'], 1)).toBeNull();
  });
});

describe('sentenceCase', () => {
  it('capitalizes the first word and lowers the capital of the others', () => {
    expect(sentenceCase('pause')).toBe('Pause');
    expect(sentenceCase('Pressure Decline')).toBe('Pressure decline');
    expect(sentenceCase('forced rise without limit')).toBe('Forced rise without limit');
    expect(sentenceCase('Allongé Bloom')).toBe('Allongé bloom');
  });

  it("keeps a word the author set in capitals or mixed case, and anything that is not a word's capital", () => {
    expect(sentenceCase('PI hold')).toBe('PI hold');
    expect(sentenceCase('slow LRv3 Ramp')).toBe('Slow LRv3 ramp');
    expect(sentenceCase('2nd Fill')).toBe('2nd fill');
    expect(sentenceCase('hold at 4.5 ml/s')).toBe('Hold at 4.5 ml/s');
    expect(sentenceCase('')).toBe('');
  });
});

describe('workflowTargetYield', () => {
  const withTarget = (targetYield: unknown): Workflow =>
    ({ ...SAMPLE_WORKFLOW, context: { ...SAMPLE_WORKFLOW.context, targetYield } }) as Workflow;

  it("keeps the stop-at-weight target Decaid's workflow carries", () => {
    expect(workflowTargetYield(withTarget(36))).toBe(36);
    expect(workflowTargetYield(withTarget(40.5))).toBe(40.5);
  });

  it('has none when the stop is off, missing, or not a usable number', () => {
    for (const target of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, '36', null, undefined]) {
      expect(workflowTargetYield(withTarget(target)), String(target)).toBeNull();
    }
    const noContext: Workflow = { ...SAMPLE_WORKFLOW };
    delete noContext.context;
    expect(workflowTargetYield(noContext)).toBeNull();
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

describe('profileMark', () => {
  it('marks the bag version as this bag’s only once the machine holds it (D55)', () => {
    expect(profileMark(true, 'loaded', true)).toBe('thisBag');
    // Confirmed before the machine dropped: still the bag's version, which Decaid loads again on connect.
    expect(profileMark(true, 'loaded', false)).toBe('thisBag');
  });

  it('says loading while the machine takes it, and not confirmed after a failed load', () => {
    expect(profileMark(true, 'loading', true)).toBe('loading');
    expect(profileMark(true, 'failed', true)).toBe('notConfirmed');
    expect(profileMark(true, 'failed', false)).toBe('notConfirmed');
  });

  it('trusts the workflow while connected when nothing is known against it: an older Decaid, or no load since start', () => {
    for (const load of ['assumed', null, undefined] as const) {
      expect(profileMark(true, load, true), String(load)).toBe('thisBag');
      // Never "on the machine" while it is not connected (D42).
      expect(profileMark(true, load, false), String(load)).toBeNull();
    }
    // Saved while offline: Decaid loads it on connect; the line says so already.
    expect(profileMark(true, 'waiting', false)).toBeNull();
    expect(profileMark(true, 'waiting', true)).toBeNull();
  });

  it('says nothing about a profile that is not the bag version', () => {
    for (const load of ['loading', 'loaded', 'waiting', 'failed', 'assumed', null, undefined] as const) {
      expect(profileMark(false, load, true), String(load)).toBeNull();
    }
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
