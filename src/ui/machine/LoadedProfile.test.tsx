// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import type { Workflow } from '../../api/types.ts';
import type { CoachState, CoachUiMessage } from '../../app/types.ts';
import { makeBag, makeVersion } from '../../storage/testing/fixtures.ts';
import { createFakeServices, SAMPLE_WORKFLOW, type FakeServices } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { theme } from '../theme.ts';
import { LoadedProfile } from './LoadedProfile.tsx';
import { LOADED_PROFILE_POLL_MS } from './useLoadedProfile.ts';

const BAG = makeBag({ id: 'bag_1', name: 'Kiambu AA', activeVersionId: 'ver_2' });
const V2 = makeVersion({ id: 'ver_2', bagId: 'bag_1', version: 2, title: 'Kiambu AA v2' });
const V3 = makeVersion({ id: 'ver_3', bagId: 'bag_1', version: 3, title: 'Kiambu AA v3' });
const ON_V2: Partial<CoachState> = { activeBag: BAG, activeVersion: V2, versions: [V2], phase: 'awaiting_shot' };

function workflow(title: string, tag?: { versionId: string; bagId: string }): Workflow {
  return {
    ...SAMPLE_WORKFLOW,
    profile: { ...SAMPLE_WORKFLOW.profile, title },
    context: { ...SAMPLE_WORKFLOW.context, ...(tag ? { extras: { cafai: tag } } : {}) },
  };
}

function message(id: string, text: string): CoachUiMessage {
  return { id, role: 'assistant', parts: [{ kind: 'text', text }], createdAt: '2026-10-04T08:00:00.000Z' };
}

/** Decaid's workflow as the test sets it; an Error makes the read fail. */
function serveWorkflow(services: FakeServices, initial: Workflow | Error) {
  let current = initial;
  services.decaid.getWorkflow = async () => {
    services.decaid.calls.push({ method: 'getWorkflow', args: [] });
    if (current instanceof Error) throw current;
    return current;
  };
  return {
    set(next: Workflow | Error) {
      current = next;
    },
  };
}

const reads = (services: FakeServices) => services.decaid.calls.filter((call) => call.method === 'getWorkflow').length;
const line = () => screen.getByRole('group', { name: 'Profile' });
const titleOf = () => line().querySelector('[title]') ?? null;

async function renderLine(services: FakeServices) {
  const view = renderWithServices(<LoadedProfile />, services);
  // Let the first read land inside act().
  await act(async () => {});
  return view;
}

/** Advance fake time, letting reads that start meanwhile settle inside act(). */
async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('LoadedProfile: what it shows', () => {
  it("shows the title of the profile in Decaid's workflow", async () => {
    const services = createFakeServices();
    await renderLine(services);
    expect(line()).toHaveTextContent('Blooming Espresso');
    expect(titleOf()).toHaveAttribute('title', 'Blooming Espresso');
    expect(reads(services)).toBe(1);
  });

  it("marks the bag's own version when CafAI's tag and the title match", async () => {
    const services = createFakeServices({ coach: ON_V2 });
    serveWorkflow(services, workflow('Kiambu AA v2', { versionId: 'ver_2', bagId: 'bag_1' }));
    await renderLine(services);
    expect(line()).toHaveTextContent('Kiambu AA v2');
    expect(line()).toHaveTextContent('This bag');
  });

  it('never claims a match it cannot see', async () => {
    const cases: Array<[string, Workflow, Partial<CoachState>]> = [
      ['same title, no tag (two bags can share a name)', workflow('Kiambu AA v2'), ON_V2],
      ['tag names another version', workflow('Kiambu AA v2', { versionId: 'ver_1', bagId: 'bag_1' }), ON_V2],
      ['another skin loaded its profile, tag left behind', workflow('Blooming Espresso', { versionId: 'ver_2', bagId: 'bag_1' }), ON_V2],
      ['no active version', workflow('Kiambu AA v2', { versionId: 'ver_2', bagId: 'bag_1' }), {}],
    ];
    for (const [what, served, coach] of cases) {
      const services = createFakeServices({ coach });
      serveWorkflow(services, served);
      const { unmount } = await renderLine(services);
      expect(line(), what).toHaveTextContent(served.profile.title);
      expect(line(), what).not.toHaveTextContent('This bag');
      unmount();
    }
  });

  it('says Decaid loads it when the machine connects while offline, never "on the machine"', async () => {
    const services = createFakeServices({ telemetry: { machineConnected: false, scaleConnected: false, scale: null } });
    await renderLine(services);
    expect(line()).toHaveTextContent('Blooming Espresso');
    expect(line()).toHaveTextContent('Decaid loads it when the machine connects');
    expect(line()).not.toHaveTextContent(/on the machine/i);

    act(() => services.telemetry.setState({ machineConnected: true }));
    expect(line()).not.toHaveTextContent('Decaid loads it');
  });

  it('shows a dash until a read succeeds, and never an error of its own', async () => {
    const services = createFakeServices({ telemetry: { machineConnected: false } });
    serveWorkflow(services, new Error('Decaid is not answering'));
    await renderLine(services);
    expect(line()).toHaveTextContent('—');
    // Nothing known, so nothing to say about loading it either.
    expect(line()).not.toHaveTextContent('Decaid loads it');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(titleOf()).toBeNull();
  });

  it('names a profile without a title', async () => {
    const services = createFakeServices();
    serveWorkflow(services, workflow('  '));
    await renderLine(services);
    expect(line()).toHaveTextContent('Untitled profile');
  });

  it('a long title stays on one line, cut with an ellipsis, the full title in its title attribute', async () => {
    const long = 'Ethiopia Guji Hambela Alaka Natural Anaerobic Lot 7 from the spring harvest v12';
    const services = createFakeServices({
      coach: { ...ON_V2, activeVersion: { ...V2, title: long } },
    });
    serveWorkflow(services, workflow(long, { versionId: 'ver_2', bagId: 'bag_1' }));
    await renderLine(services);
    const title = titleOf();
    expect(title).toHaveAttribute('title', long);
    expect(title).toHaveClass('MuiTypography-noWrap');
    expect(getComputedStyle(title!).textOverflow).toBe('ellipsis');
    expect(getComputedStyle(title!).whiteSpace).toBe('nowrap');
    // The mark sits beside the title and never shrinks away.
    expect(line()).toHaveTextContent('This bag');
  });
});

describe('LoadedProfile: the bag version on its way to the machine (D55)', () => {
  const ON_MACHINE = () => workflow('Kiambu AA v2', { versionId: 'ver_2', bagId: 'bag_1' });

  it('says loading… while the machine takes the version, and This bag only once it holds it', async () => {
    const services = createFakeServices({ coach: { ...ON_V2, activeLoad: 'loading' } });
    serveWorkflow(services, ON_MACHINE());
    await renderLine(services);
    expect(line()).toHaveTextContent('Kiambu AA v2');
    expect(line()).toHaveTextContent('loading…');
    expect(line()).not.toHaveTextContent('This bag');

    act(() => services.coach.setState({ activeLoad: 'loaded' }));
    expect(line()).toHaveTextContent('This bag');
    expect(line()).not.toHaveTextContent('loading…');
  });

  it('says not confirmed, in the warning colour, after a load that failed', async () => {
    const services = createFakeServices({ coach: { ...ON_V2, activeLoad: 'failed' } });
    serveWorkflow(services, ON_MACHINE());
    await renderLine(services);
    expect(line()).toHaveTextContent('Kiambu AA v2');
    expect(line()).not.toHaveTextContent('This bag');
    expect(screen.getByText('not confirmed')).toHaveStyle({ color: theme.palette.warning.main });
  });

  it('claims nothing for a version saved while the machine is away; Decaid loads it on connect', async () => {
    const services = createFakeServices({
      coach: { ...ON_V2, activeLoad: 'waiting' },
      telemetry: { machineConnected: false },
    });
    serveWorkflow(services, ON_MACHINE());
    await renderLine(services);
    expect(line()).toHaveTextContent('Decaid loads it when the machine connects');
    expect(line()).not.toHaveTextContent('This bag');
    expect(line()).not.toHaveTextContent('loading…');
  });

  it('trusts the workflow when CafAI has not loaded the version since it started, but only while connected', async () => {
    const services = createFakeServices({ coach: { ...ON_V2, activeLoad: null } });
    serveWorkflow(services, ON_MACHINE());
    await renderLine(services);
    expect(line()).toHaveTextContent('This bag');
    act(() => services.telemetry.setState({ machineConnected: false }));
    expect(line()).not.toHaveTextContent('This bag');
  });

  it('says nothing of a load when the workflow carries another profile', async () => {
    const services = createFakeServices({ coach: { ...ON_V2, activeLoad: 'failed' } });
    serveWorkflow(services, workflow('Default', { versionId: 'ver_2', bagId: 'bag_1' }));
    await renderLine(services);
    expect(line()).toHaveTextContent('Default');
    expect(line()).not.toHaveTextContent('not confirmed');
  });
});

describe("LoadedProfile: on the engine's beat", () => {
  it('reads Decaid’s workflow when the engine looks at the machine, with no clock of its own', async () => {
    vi.useFakeTimers();
    const services = createFakeServices({ coach: { ...ON_V2, machineTick: 0 } });
    const decaid = serveWorkflow(services, workflow('Kiambu AA v2', { versionId: 'ver_2', bagId: 'bag_1' }));
    await renderLine(services);
    expect(reads(services)).toBe(1);
    await wait(LOADED_PROFILE_POLL_MS * 2);
    expect(reads(services)).toBe(1);

    // Another skin loaded a profile; the engine's next look and this line see it together.
    decaid.set(workflow('Default', { versionId: 'ver_2', bagId: 'bag_1' }));
    await act(async () => services.coach.setState({ machineTick: 1 }));
    expect(reads(services)).toBe(2);
    expect(line()).toHaveTextContent('Default');
    expect(line()).not.toHaveTextContent('This bag');

    // The engine looks when the page comes back into view, and so the line reads then.
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
    expect(reads(services)).toBe(2);
  });
});

describe('LoadedProfile: when it reads again', () => {
  it('at once when the coach changes the active version', async () => {
    const services = createFakeServices({ coach: ON_V2 });
    const decaid = serveWorkflow(services, workflow('Kiambu AA v2', { versionId: 'ver_2', bagId: 'bag_1' }));
    await renderLine(services);
    expect(reads(services)).toBe(1);

    decaid.set(workflow('Kiambu AA v3', { versionId: 'ver_3', bagId: 'bag_1' }));
    act(() => services.coach.setState({ activeVersion: V3, versions: [V2, V3] }));
    // The old reading no longer matches the new version: no mark until it is read.
    expect(line()).not.toHaveTextContent('This bag');
    expect(reads(services)).toBe(2);
    await act(async () => {});
    expect(line()).toHaveTextContent('Kiambu AA v3');
    expect(line()).toHaveTextContent('This bag');
  });

  it('at once when the active bag changes', async () => {
    const services = createFakeServices({ coach: ON_V2 });
    const decaid = serveWorkflow(services, workflow('Kiambu AA v2', { versionId: 'ver_2', bagId: 'bag_1' }));
    await renderLine(services);

    const sumatra = makeBag({ id: 'bag_2', name: 'Sumatra', activeVersionId: 'ver_9' });
    const sumatraV1 = makeVersion({ id: 'ver_9', bagId: 'bag_2', version: 1, title: 'Sumatra v1' });
    decaid.set(workflow('Sumatra v1', { versionId: 'ver_9', bagId: 'bag_2' }));
    await act(async () => services.coach.setState({ activeBag: sumatra, activeVersion: sumatraV1, versions: [sumatraV1] }));
    expect(reads(services)).toBe(2);
    expect(line()).toHaveTextContent('Sumatra v1');
    expect(line()).toHaveTextContent('This bag');
  });

  it('when the load state changes, as when Retry loads the same version again', async () => {
    // The engine's beat found another profile; the line shows it too.
    const services = createFakeServices({ coach: { ...ON_V2, activeLoad: 'loaded', machineTick: 3 } });
    const decaid = serveWorkflow(services, workflow('Gentle and sweet', { versionId: 'ver_2', bagId: 'bag_1' }));
    await renderLine(services);
    expect(line()).toHaveTextContent('Gentle and sweet');

    // Retry: CafAI puts v2 in the workflow again and waits for the machine.
    decaid.set(workflow('Kiambu AA v2', { versionId: 'ver_2', bagId: 'bag_1' }));
    await act(async () => services.coach.setState({ activeLoad: 'loading' }));
    expect(reads(services)).toBe(2);
    expect(line()).toHaveTextContent('Kiambu AA v2');
    expect(line()).toHaveTextContent('loading…');

    await act(async () => services.coach.setState({ activeLoad: 'loaded' }));
    expect(line()).toHaveTextContent('This bag');
  });

  it('not again when the machine confirms the version the line shows: a profile loaded behind CafAI meanwhile waits for the beat', async () => {
    const services = createFakeServices({ coach: { ...ON_V2, activeLoad: 'loading', machineTick: 0 } });
    const decaid = serveWorkflow(services, workflow('Kiambu AA v2', { versionId: 'ver_2', bagId: 'bag_1' }));
    await renderLine(services);
    expect(line()).toHaveTextContent('loading…');

    // Another skin loads a profile just as the machine confirms v2.
    decaid.set(workflow('Default', { versionId: 'ver_2', bagId: 'bag_1' }));
    await act(async () => services.coach.setState({ activeLoad: 'loaded' }));
    expect(reads(services)).toBe(1);
    expect(line()).toHaveTextContent('Kiambu AA v2');
    expect(line()).toHaveTextContent('This bag');

    // The engine's beat: it looks for another profile, and the line reads, together (D70).
    await act(async () => services.coach.setState({ machineTick: 1 }));
    expect(reads(services)).toBe(2);
    expect(line()).toHaveTextContent('Default');
    expect(line()).not.toHaveTextContent('This bag');
  });

  it('not on a chat message: a profile loaded behind CafAI while the coach replies shows on the beat (D70)', async () => {
    vi.useFakeTimers();
    const services = createFakeServices({ coach: { ...ON_V2, activeLoad: 'loaded', machineTick: 0, messages: [message('m1', 'Hello')] } });
    const decaid = serveWorkflow(services, workflow('Kiambu AA v2', { versionId: 'ver_2', bagId: 'bag_1' }));
    await renderLine(services);
    expect(reads(services)).toBe(1);

    decaid.set(workflow('Default', { versionId: 'ver_2', bagId: 'bag_1' }));
    act(() => services.coach.setState({ messages: [message('m1', 'Hello'), message('m2', 'Loaded')] }));
    act(() => services.coach.setState({ messages: [message('m1', 'Hello'), message('m2', 'Loaded'), message('m3', 'Pull a shot')] }));
    act(() => services.coach.setState({ messages: [message('m1', 'Hello'), message('m2', 'Loaded'), message('m3', 'Pull a shot now')] }));
    await wait(5_000);
    expect(reads(services)).toBe(1);
    expect(line()).toHaveTextContent('Kiambu AA v2');
    expect(line()).toHaveTextContent('This bag');

    await act(async () => services.coach.setState({ machineTick: 1 }));
    expect(reads(services)).toBe(2);
    expect(line()).toHaveTextContent('Default');
  });

  it('when a shot finishes', async () => {
    const services = createFakeServices();
    const decaid = serveWorkflow(services, workflow('Blooming Espresso'));
    await renderLine(services);
    decaid.set(workflow('Londonium'));

    await act(async () => services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' }));
    expect(reads(services)).toBe(1);
    await act(async () => services.telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: 'targetWeight' }));
    expect(reads(services)).toBe(2);
    expect(line()).toHaveTextContent('Londonium');
  });

  it('when the machine connects', async () => {
    const services = createFakeServices({ telemetry: { machineConnected: false } });
    await renderLine(services);
    expect(reads(services)).toBe(1);
    await act(async () => services.telemetry.setState({ machineConnected: true }));
    expect(reads(services)).toBe(2);
    await act(async () => services.telemetry.setState({ machineConnected: false }));
    expect(reads(services)).toBe(2);
  });

  it('every 30 s while the page is visible, not while it is hidden', async () => {
    vi.useFakeTimers();
    const services = createFakeServices();
    const decaid = serveWorkflow(services, workflow('Blooming Espresso'));
    await renderLine(services);

    decaid.set(workflow('Picked on the machine'));
    await wait(LOADED_PROFILE_POLL_MS);
    expect(reads(services)).toBe(2);
    expect(line()).toHaveTextContent('Picked on the machine');

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await wait(LOADED_PROFILE_POLL_MS * 2);
    expect(reads(services)).toBe(2);

    // Back in view: catch up at once rather than up to 30 s later.
    Reflect.deleteProperty(document, 'visibilityState');
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
    expect(reads(services)).toBe(3);
  });

  it('keeps the last value when a read fails', async () => {
    const services = createFakeServices();
    const decaid = serveWorkflow(services, workflow('Blooming Espresso'));
    await renderLine(services);
    decaid.set(new Error('Decaid is not answering'));
    await act(async () => services.telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: null }));
    expect(reads(services)).toBe(2);
    expect(line()).toHaveTextContent('Blooming Espresso');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps one request in flight, and reads once more after it when asked meanwhile', async () => {
    const services = createFakeServices();
    const answers: Array<(workflow: Workflow) => void> = [];
    services.decaid.getWorkflow = () => {
      services.decaid.calls.push({ method: 'getWorkflow', args: [] });
      return new Promise<Workflow>((resolve) => answers.push(resolve));
    };
    renderWithServices(<LoadedProfile />, services);
    expect(reads(services)).toBe(1);
    act(() => {
      services.telemetry.emitShot({ type: 'finished', shotId: 'a', stopReason: null });
      services.telemetry.emitShot({ type: 'finished', shotId: 'b', stopReason: null });
      services.telemetry.setState({ machineConnected: false });
      services.telemetry.setState({ machineConnected: true });
    });
    expect(reads(services)).toBe(1);

    await act(async () => answers[0]!(workflow('First')));
    expect(reads(services)).toBe(2);
    await act(async () => answers[1]!(workflow('Second')));
    expect(reads(services)).toBe(2);
    expect(line()).toHaveTextContent('Second');
  });

  it('stops reading when unmounted', async () => {
    vi.useFakeTimers();
    const services = createFakeServices({ coach: ON_V2 });
    const { unmount } = await renderLine(services);
    act(() => services.coach.setState({ activeVersion: V3 }));
    expect(reads(services)).toBe(2);
    unmount();
    services.coach.setState({ activeVersion: V2 });
    services.telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: null });
    await vi.advanceTimersByTimeAsync(LOADED_PROFILE_POLL_MS * 2);
    expect(reads(services)).toBe(2);
  });
});
