// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { TelemetryState } from '../../api/types.ts';
import type { SaverScreen } from '../../app/saverScreen.ts';
import { ServicesProvider } from '../../app/services.tsx';
import { machineCommandsFor } from '../machine/useMachineCommands.ts';
import { TID } from '../testIds.ts';
import { createFakeServices, IDLE_TELEMETRY, type FakeServices } from '../testing/fakeServices.ts';
import { dailyPick, runnableHere } from './daily.ts';
import { SAVER_IDLE_MS, SAVER_SHOW_MS } from './policy.ts';
import { createSaverPreview, type SaverPreviewStore } from './preview.ts';
import { localDayNumber } from './random.ts';
import { GUARD_AFTER_UP_MS, SaverOverlay } from './SaverOverlay.tsx';
import type { CanvasSaver } from './types.ts';

function machineIn(state: string): Partial<TelemetryState> {
  return { machine: { ...IDLE_TELEMETRY.machine!, state: { state, substate: 'idle' } } as TelemetryState['machine'] };
}

const ASLEEP = machineIn('sleeping');

function fakeScreen(): SaverScreen & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    hold: () => void calls.push('hold'),
    release: () => void calls.push('release'),
    restore: () => void calls.push('restore'),
    dispose: () => void calls.push('dispose'),
  };
}

/** A canvas screensaver that cannot get its context: the overlay must fall back to Nightstand. */
const NO_CONTEXT: CanvasSaver = { id: 'beanfield', label: 'Beanfield', context: '2d', create: () => null };

interface Setup {
  insideDecaid?: boolean;
  telemetry?: Partial<TelemetryState>;
  pick?: string;
  on?: boolean;
  saverFor?: (id: string) => CanvasSaver | undefined;
}

function setup({ insideDecaid = true, telemetry = ASLEEP, pick = 'nightstand', on = true, saverFor }: Setup = {}) {
  const services: FakeServices = createFakeServices({ insideDecaid, telemetry });
  const saverScreen = fakeScreen();
  services.saverScreen = saverScreen;
  void services.screensaver.set({ on, pick });
  const preview: SaverPreviewStore = createSaverPreview();
  const underneath = vi.fn();
  const view = render(
    <ServicesProvider services={services}>
      <button type="button" onClick={underneath}>
        Steam
      </button>
      <SaverOverlay preview={preview} saverFor={saverFor ?? (() => undefined)} />
    </ServicesProvider>,
  );
  return { ...view, services, saverScreen, preview, underneath };
}

function advance(ms: number) {
  act(() => void vi.advanceTimersByTime(ms));
}

/** Lets the wake's request settle. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

function dispatch(target: EventTarget, type: string): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function wakes(services: FakeServices): number {
  return services.decaid.calls.filter((call) => call.method === 'setMachineState' && call.args[0] === 'idle').length;
}

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  vi.setSystemTime(new Date(2026, 9, 22, 23, 0, 0));
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SaverOverlay: when it shows (spec 3)', () => {
  it('comes up once the machine has been asleep and the screen untouched a minute, from the page load, and dims and holds the screen', () => {
    const { saverScreen } = setup();
    advance(SAVER_IDLE_MS - 1);
    expect(screen.queryByTestId(TID.saver)).toBeNull();
    advance(1);
    const saver = screen.getByTestId(TID.saver);
    expect(saver).toHaveAttribute('data-phase', 'showing');
    expect(saver).toHaveAttribute('data-saver', 'nightstand');
    expect(screen.getByTestId(TID.nightstand)).toBeInTheDocument();
    expect(saverScreen.calls).toEqual(['hold']);
  });

  it('a touch anywhere starts the minute again', () => {
    setup();
    advance(40_000);
    dispatch(document.body, 'pointerdown');
    advance(40_000);
    expect(screen.queryByTestId(TID.saver)).toBeNull();
    dispatch(document.body, 'keydown');
    advance(SAVER_IDLE_MS - 1);
    expect(screen.queryByTestId(TID.saver)).toBeNull();
    advance(1);
    expect(screen.getByTestId(TID.saver)).toBeInTheDocument();
  });

  it('never shows outside Decaid, turned off, or with the machine anything but confirmed asleep', () => {
    const cases: Setup[] = [
      { insideDecaid: false },
      { on: false },
      { telemetry: machineIn('idle') },
      { telemetry: { ...ASLEEP, machineConnected: false } },
      { telemetry: { ...ASLEEP, unreachable: true } },
    ];
    for (const options of cases) {
      const { unmount, saverScreen } = setup(options);
      advance(3_600_000);
      expect(screen.queryByTestId(TID.saver), JSON.stringify(options)).toBeNull();
      expect(saverScreen.calls).toEqual([]);
      unmount();
    }
  });

  it('comes up at once when the machine falls asleep with the screen long untouched', () => {
    const { services } = setup({ telemetry: machineIn('idle') });
    advance(10 * 60_000);
    act(() => services.telemetry.setState(ASLEEP));
    expect(screen.getByTestId(TID.saver)).toBeInTheDocument();
  });

  it('goes by itself when the machine wakes, putting the screen back', () => {
    const { services, saverScreen } = setup();
    advance(SAVER_IDLE_MS);
    act(() => services.telemetry.setState(machineIn('idle')));
    expect(screen.queryByTestId(TID.saver)).toBeNull();
    expect(saverScreen.calls).toEqual(['hold', 'restore']);
    // Awake: never again until it sleeps once more and the minute passes.
    advance(3_600_000);
    expect(screen.queryByTestId(TID.saver)).toBeNull();
  });

  it('goes by itself when it is turned off, putting the screen back', () => {
    const { services, saverScreen } = setup();
    advance(SAVER_IDLE_MS);
    act(() => void services.screensaver.set({ on: false, pick: 'nightstand' }));
    expect(screen.queryByTestId(TID.saver)).toBeNull();
    expect(saverScreen.calls).toEqual(['hold', 'restore']);
  });
});

describe('SaverOverlay: the tap', () => {
  it('is swallowed, wakes the machine once with the Wake button’s command, and the screensaver goes', async () => {
    const { services, saverScreen, underneath } = setup();
    advance(SAVER_IDLE_MS);
    const heard = vi.fn();
    document.addEventListener('pointerdown', heard);
    const saver = screen.getByTestId(TID.saver);
    const press = dispatch(saver, 'pointerdown');
    expect(press.defaultPrevented).toBe(true);
    expect(heard).not.toHaveBeenCalled();
    await settle();
    expect(wakes(services)).toBe(1);
    expect(screen.queryByTestId(TID.saver)).toBeNull();
    expect(saverScreen.calls).toEqual(['hold', 'restore']);
    // The rest of the tap lands on the clear sheet, never on what is underneath.
    const guard = screen.getByTestId(TID.saverGuard);
    expect(dispatch(guard, 'touchstart').defaultPrevented).toBe(true);
    expect(dispatch(guard, 'click').defaultPrevented).toBe(true);
    // A second press as quick: nothing more is sent.
    dispatch(guard, 'pointerdown');
    await settle();
    expect(wakes(services)).toBe(1);
    expect(underneath).not.toHaveBeenCalled();
    document.removeEventListener('pointerdown', heard);
    // The finger lifts: a moment later the sheet goes too.
    dispatch(window, 'pointerup');
    advance(GUARD_AFTER_UP_MS - 1);
    expect(screen.getByTestId(TID.saverGuard)).toBeInTheDocument();
    advance(1);
    expect(screen.queryByTestId(TID.saverGuard)).toBeNull();
  });

  it('only clears the screensaver when no wake can be sent just then', async () => {
    const { services } = setup();
    // A command in flight holds the Wake button, and the tap with it.
    services.decaid.setMachineState = (state) => {
      services.decaid.calls.push({ method: 'setMachineState', args: [state] });
      return new Promise<void>(() => undefined);
    };
    void machineCommandsFor(services.decaid).send('sleeping', "Couldn't put the machine to sleep.");
    advance(SAVER_IDLE_MS);
    dispatch(screen.getByTestId(TID.saver), 'pointerdown');
    await settle();
    expect(screen.queryByTestId(TID.saver)).toBeNull();
    expect(wakes(services)).toBe(0);
  });

  it('a key does the same, and leaves no sheet behind', async () => {
    const { services } = setup();
    advance(SAVER_IDLE_MS);
    const key = dispatch(document.body, 'keydown');
    expect(key.defaultPrevented).toBe(true);
    await settle();
    expect(wakes(services)).toBe(1);
    expect(screen.queryByTestId(TID.saver)).toBeNull();
    expect(screen.queryByTestId(TID.saverGuard)).toBeNull();
  });

  it('comes back only after another minute untouched with the machine still asleep (a wake that failed)', async () => {
    const { services } = setup();
    services.decaid.failNext('setMachineState', new Error('Decaid is busy.'));
    advance(SAVER_IDLE_MS);
    dispatch(screen.getByTestId(TID.saver), 'pointerdown');
    dispatch(window, 'pointerup');
    await settle();
    advance(SAVER_IDLE_MS - 1);
    expect(screen.queryByTestId(TID.saver)).toBeNull();
    advance(1);
    expect(screen.getByTestId(TID.saver)).toBeInTheDocument();
  });
});

describe('SaverOverlay: the 30 minutes (spec 4)', () => {
  it('turns black after 30 minutes and lets the screen go; a tap on the black still wakes the machine', async () => {
    const { services, saverScreen } = setup();
    advance(SAVER_IDLE_MS);
    advance(SAVER_SHOW_MS - 1);
    expect(screen.getByTestId(TID.saver)).toHaveAttribute('data-phase', 'showing');
    advance(1);
    const saver = screen.getByTestId(TID.saver);
    expect(saver).toHaveAttribute('data-phase', 'black');
    expect(screen.queryByTestId(TID.nightstand)).toBeNull();
    expect(saverScreen.calls).toEqual(['hold', 'release']);
    dispatch(saver, 'pointerdown');
    await settle();
    expect(wakes(services)).toBe(1);
    expect(saverScreen.calls).toEqual(['hold', 'release', 'restore']);
  });

  it('the page showing again starts it over: animating, dimmed and held on, another 30 minutes', () => {
    const { saverScreen } = setup();
    advance(SAVER_IDLE_MS);
    advance(SAVER_SHOW_MS);
    expect(screen.getByTestId(TID.saver)).toHaveAttribute('data-phase', 'black');
    visibility = 'hidden';
    dispatch(document, 'visibilitychange');
    visibility = 'visible';
    dispatch(document, 'visibilitychange');
    expect(screen.getByTestId(TID.saver)).toHaveAttribute('data-phase', 'showing');
    expect(screen.getByTestId(TID.nightstand)).toBeInTheDocument();
    expect(saverScreen.calls).toEqual(['hold', 'release', 'hold']);
    advance(SAVER_SHOW_MS - 1);
    expect(screen.getByTestId(TID.saver)).toHaveAttribute('data-phase', 'showing');
    advance(1);
    expect(screen.getByTestId(TID.saver)).toHaveAttribute('data-phase', 'black');
  });
});

describe('SaverOverlay: which, and the fallback', () => {
  it("shows the day's pick for 'A different one each day'", () => {
    setup({ pick: 'daily' });
    advance(SAVER_IDLE_MS);
    expect(screen.getByTestId(TID.saver)).toHaveAttribute('data-saver', dailyPick(runnableHere(), localDayNumber(new Date())));
  });

  it('a screensaver that cannot start gives way to Nightstand for the rest of the showing', () => {
    setup({ pick: 'beanfield', saverFor: (id) => (id === 'beanfield' ? NO_CONTEXT : undefined) });
    advance(SAVER_IDLE_MS);
    expect(screen.getByTestId(TID.saver)).toHaveAttribute('data-saver', 'beanfield');
    expect(screen.getByTestId(TID.nightstand)).toBeInTheDocument();
    expect(screen.queryByTestId(TID.saverCanvas)).toBeNull();
  });

  it('marks itself ready once its first picture is painted', () => {
    setup();
    advance(SAVER_IDLE_MS);
    expect(screen.getByTestId(TID.saverReady)).toBeInTheDocument();
  });
});

describe('SaverOverlay: Preview', () => {
  it('shows anywhere, never dims, holds or wakes, and a tap closes it', async () => {
    const { services, saverScreen, preview } = setup({ insideDecaid: false, telemetry: machineIn('idle') });
    act(() => preview.show('nightstand'));
    const saver = screen.getByTestId(TID.saver);
    expect(saver).toHaveAttribute('data-phase', 'preview');
    expect(saver).toHaveAttribute('aria-label', 'Close the preview');
    dispatch(saver, 'pointerdown');
    await settle();
    expect(screen.queryByTestId(TID.saver)).toBeNull();
    expect(preview.current()).toBeNull();
    expect(wakes(services)).toBe(0);
    expect(saverScreen.calls).toEqual([]);
  });

  it('gives way to the real one once the machine is asleep and the screen untouched a minute', () => {
    const { saverScreen, preview } = setup();
    act(() => preview.show('nightstand'));
    expect(screen.getByTestId(TID.saver)).toHaveAttribute('data-phase', 'preview');
    advance(SAVER_IDLE_MS);
    expect(screen.getByTestId(TID.saver)).toHaveAttribute('data-phase', 'showing');
    expect(preview.current()).toBeNull();
    expect(saverScreen.calls).toEqual(['hold']);
  });
});
