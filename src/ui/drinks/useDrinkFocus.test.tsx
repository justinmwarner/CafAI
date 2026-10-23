// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { formatLocalTimestamp } from '../../../mock/decaid/clock.ts';
import type { MachineFrame } from '../../api/types.ts';
import { setCareVideoOpen } from '../care/videoHold.ts';
import { navigate, useRoute } from '../router.ts';
import { GUARD_MS } from '../shell/useShotFocus.ts';
import { createFakeServices, IDLE_TELEMETRY, type FakeServices } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { useDrinkFocus } from './useDrinkFocus.ts';

let seconds = 0;
const frame = (state: string, substate = 'pouring'): MachineFrame => ({
  ...IDLE_TELEMETRY.machine!,
  timestamp: formatLocalTimestamp(new Date(2026, 9, 13, 8).getTime() + (seconds += 0.25) * 1000),
  state: { state, substate },
});

function Harness() {
  const route = useRoute();
  const { guardUntil, back, goBack } = useDrinkFocus();
  return (
    <div>
      <output data-testid="route">{route.name === 'drink' ? `drink:${route.drink}` : route.name}</output>
      <output data-testid="guard">{guardUntil === null ? 'none' : String(guardUntil)}</output>
      <output data-testid="back">{back.name}</output>
      <button type="button" onClick={() => goBack()}>
        Go back
      </button>
      <button type="button" onClick={() => goBack({ auto: true })}>
        Go back by itself
      </button>
      <textarea aria-label="Draft" />
    </div>
  );
}

/** jsdom fires hashchange from a queued task: let it land and React catch up. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
const text = (id: string) => screen.getByTestId(id).textContent;
const send = (services: FakeServices, f: MachineFrame) => act(() => services.telemetry.setState({ machine: f }));

function renderHarness(): FakeServices {
  const services = createFakeServices();
  renderWithServices(<Harness />, services);
  return services;
}

beforeEach(async () => {
  window.location.hash = '#/settings';
  await new Promise((resolve) => setImmediate(resolve));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDrinkFocus', () => {
  it('a drink starting switches to its view by itself, replacing the entry, and Go back returns', async () => {
    const services = renderHarness();
    const entries = window.history.length;
    send(services, frame('steam'));
    expect(window.location.hash).toBe('#/steam');
    expect(window.history.length).toBe(entries);
    await settle();
    expect(text('route')).toBe('drink:steam');
    expect(text('back')).toBe('settings');

    send(services, frame('idle', 'idle'));
    act(() => screen.getByRole('button', { name: 'Go back' }).click());
    expect(window.location.hash).toBe('#/settings');
    expect(window.history.length).toBe(entries);
  });

  it('stays put while the barista types', () => {
    const services = renderHarness();
    act(() => screen.getByLabelText('Draft').focus());
    send(services, frame('hotWater'));
    expect(window.location.hash).toBe('#/settings');
  });

  it("stays on Care while Decent's video is open there, and switches from it once the video is closed (D156)", async () => {
    window.location.hash = '#/care/weekly';
    await settle();
    const services = renderHarness();
    setCareVideoOpen(true);
    try {
      send(services, frame('flush'));
      expect(window.location.hash).toBe('#/care/weekly');
    } finally {
      setCareVideoOpen(false);
    }
    send(services, frame('idle', 'idle'));
    send(services, frame('flush'));
    expect(window.location.hash).toBe('#/flush');
    await settle();
    expect(text('back')).toBe('care');
  });

  it('a video left open on Care holds nothing anywhere else', () => {
    const services = renderHarness();
    setCareVideoOpen(true);
    try {
      send(services, frame('steam'));
      expect(window.location.hash).toBe('#/steam');
    } finally {
      setCareVideoOpen(false);
    }
  });

  it("does not switch back as the run ends: going back by itself is the view's own countdown (D221)", async () => {
    const services = renderHarness();
    send(services, frame('flush'));
    await settle();
    send(services, frame('idle', 'idle'));
    await settle();
    expect(window.location.hash).toBe('#/flush');
  });

  it("a move of the barista's is theirs: the next run switches again, and goes back to where they were", async () => {
    const services = renderHarness();
    send(services, frame('flush'));
    send(services, frame('idle', 'idle'));
    await settle();
    act(() => navigate({ name: 'history' }));
    await settle();
    send(services, frame('hotWater'));
    expect(window.location.hash).toBe('#/hot-water');
    await settle();
    expect(text('back')).toBe('history');
  });

  it(`guards the screen for ${GUARD_MS} ms after it switches`, () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const services = renderHarness();
    const at = Date.now();
    send(services, frame('steam'));
    expect(text('guard')).toBe(String(at + GUARD_MS));
    act(() => vi.advanceTimersByTime(GUARD_MS));
    expect(text('guard')).toBe('none');
  });

  it(`going back by itself guards the pane it returns to for ${GUARD_MS} ms, as a switch does; Go back tapped does not`, () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const services = renderHarness();
    const entries = window.history.length;
    send(services, frame('steam'));
    send(services, frame('idle', 'idle'));
    act(() => vi.advanceTimersByTime(GUARD_MS));
    expect(text('guard')).toBe('none');

    const at = Date.now();
    act(() => screen.getByRole('button', { name: 'Go back by itself' }).click());
    expect(window.location.hash).toBe('#/settings');
    expect(window.history.length).toBe(entries);
    expect(text('guard')).toBe(String(at + GUARD_MS));
    act(() => vi.advanceTimersByTime(GUARD_MS));
    expect(text('guard')).toBe('none');

    send(services, frame('flush'));
    send(services, frame('idle', 'idle'));
    act(() => vi.advanceTimersByTime(GUARD_MS));
    act(() => screen.getByRole('button', { name: 'Go back' }).click());
    expect(window.location.hash).toBe('#/settings');
    expect(text('guard')).toBe('none');
  });

  it('takes the screen for a run already under way when it starts', () => {
    const services = createFakeServices({ telemetry: { machine: frame('steam') } });
    renderWithServices(<Harness />, services);
    expect(window.location.hash).toBe('#/steam');
  });
});
