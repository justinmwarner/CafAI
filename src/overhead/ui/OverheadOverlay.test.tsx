// @vitest-environment jsdom
import '../../ui/chat/testing/setup.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { TelemetryState } from '../../api/types.ts';
import type { SaverScreen } from '../../app/saverScreen.ts';
import { ServicesProvider } from '../../app/services.tsx';
import { SAVER_IDLE_MS, SAVER_SETTLE_MS } from '../../ui/saver/policy.ts';
import { createSaverPreview } from '../../ui/saver/preview.ts';
import { SaverOverlay } from '../../ui/saver/SaverOverlay.tsx';
import { TID } from '../../ui/testIds.ts';
import { createFakeServices, IDLE_TELEMETRY, type FakeServices } from '../../ui/testing/fakeServices.ts';
import { PAYLOAD_VERSION, type OverheadAircraft, type OverheadPayload } from '../shared/payload.ts';
import { DEFAULT_SETTINGS, settingsValues, type OverheadSettings } from '../shared/settings.ts';
import { resetPageAvailabilityForTests } from './availability.ts';
import { OverheadUnavailable, type OverheadClient } from './client.ts';
import { GUARD_AFTER_UP_MS, OverheadOverlay } from './OverheadOverlay.tsx';
import { createOverheadPreview } from './preview.ts';

const machineIn = (state: string): Partial<TelemetryState> => ({ machine: { ...IDLE_TELEMETRY.machine!, state: { state, substate: 'idle' } } as TelemetryState['machine'] });

const HOME = { lat: 41.988, lon: -87.73 };
const NOW = Date.parse('2026-11-23T15:00:00Z');

function plane(hex: string, overrides: Partial<OverheadAircraft> = {}): OverheadAircraft {
  return {
    hex,
    callsign: 'SKW5591',
    registration: 'N146SY',
    typeCode: 'E75L',
    typeName: 'Embraer ERJ-170-200 (long wing)',
    operator: 'SKYWEST AIRLINES INC',
    airline: 'SkyWest',
    lat: HOME.lat,
    lon: HOME.lon + 0.01,
    positionAt: NOW,
    altitudeFt: 2950,
    onGround: false,
    groundSpeedKt: 166,
    trackDeg: 270,
    verticalRateFpm: -700,
    distanceNm: 0.44,
    bearingDeg: 90,
    cpa: { timeToCpaSeconds: 9, distanceMiles: 0.01, side: null },
    route: null,
    notable: null,
    trail: [],
    ...overrides,
  };
}

function payload(overrides: Partial<OverheadPayload> = {}, settings: Partial<OverheadSettings> = {}): OverheadPayload {
  return {
    version: PAYLOAD_VERSION,
    generatedAt: Date.now(),
    provider: 'adsb.fi',
    dataAt: Date.now(),
    stale: false,
    home: HOME,
    settings: { ...DEFAULT_SETTINGS, homeLat: HOME.lat, homeLon: HOME.lon, ...settings },
    aircraft: [plane('a0baa1', { positionAt: Date.now() })],
    notable: [],
    providers: [],
    ...overrides,
  };
}

function fakeScreen(): SaverScreen & { calls: string[]; held: Array<number | undefined> } {
  const calls: string[] = [];
  const held: Array<number | undefined> = [];
  return {
    calls,
    held,
    hold: (brightness) => {
      calls.push('hold');
      held.push(brightness);
    },
    release: () => void calls.push('release'),
    restore: () => void calls.push('restore'),
    dispose: () => void calls.push('dispose'),
  };
}

interface Setup {
  insideDecaid?: boolean;
  telemetry?: Partial<TelemetryState>;
  settings?: Partial<OverheadSettings>;
  /** The plugin is not there: config and overhead answer 404. */
  missing?: boolean;
  answer?: () => OverheadPayload;
  withClassic?: boolean;
}

function setup({ insideDecaid = true, telemetry = machineIn('idle'), settings = {}, missing = false, answer, withClassic = false }: Setup = {}) {
  const services: FakeServices = createFakeServices({ insideDecaid, telemetry });
  const saverScreen = fakeScreen();
  services.saverScreen = saverScreen;
  const effective = { ...DEFAULT_SETTINGS, homeLat: HOME.lat, homeLon: HOME.lon, ...settings };
  const asked: Array<{ active: boolean; mock?: boolean }> = [];
  const client: OverheadClient = {
    async overhead(options) {
      asked.push(options);
      if (missing) throw new OverheadUnavailable(404, 'The Overhead plugin is not running in Decaid.');
      return answer ? answer() : payload({}, effective);
    },
    async config() {
      if (missing) throw new OverheadUnavailable(404, 'The Overhead plugin is not running in Decaid.');
      return settingsValues(effective);
    },
    async saveConfig() {
      return settingsValues(effective);
    },
  };
  const preview = createOverheadPreview();
  const view = render(
    <ServicesProvider services={services}>
      <button type="button">underneath</button>
      {withClassic ? <SaverOverlay preview={createSaverPreview()} saverFor={() => undefined} /> : null}
      <OverheadOverlay client={client} preview={preview} renderMap={() => <div data-testid="stub-map" />} />
    </ServicesProvider>,
  );
  return { ...view, services, saverScreen, preview, asked };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('Overhead over CafAI', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    resetPageAvailabilityForTests();
  });

  it('comes up after 3 minutes untouched with the machine idle, held on, not dimmed by day', async () => {
    const { saverScreen, asked } = setup();
    await advance(3 * 60_000 - 1000);
    expect(screen.queryByTestId(TID.overhead)).toBeNull();
    await advance(1000);
    expect(screen.getByTestId(TID.overhead)).toHaveAttribute('data-phase', 'showing');
    await advance(0);
    expect(screen.getByTestId(TID.overheadRow)).toHaveAttribute('data-bucket', 'now');
    expect(screen.getByTestId(TID.overheadRow)).toHaveTextContent('SkyWest 5591');
    expect(asked[0]).toEqual({ active: true, mock: false });
    expect(saverScreen.held).toEqual([100]);
  });

  it('follows its own minutes', async () => {
    setup({ settings: { idleMinutes: 10 } });
    await advance(9 * 60_000);
    expect(screen.queryByTestId(TID.overhead)).toBeNull();
    await advance(60_000);
    expect(screen.getByTestId(TID.overhead)).toBeInTheDocument();
  });

  it('counts from the last touch', async () => {
    setup();
    await advance(2 * 60_000);
    act(() => void window.dispatchEvent(new Event('pointerdown')));
    await advance(2 * 60_000);
    expect(screen.queryByTestId(TID.overhead)).toBeNull();
    await advance(60_000);
    expect(screen.getByTestId(TID.overhead)).toBeInTheDocument();
  });

  it('never shows while the machine is busy, and goes the moment a shot starts', async () => {
    const { services, saverScreen } = setup({ telemetry: machineIn('steam') });
    await advance(10 * 60_000);
    expect(screen.queryByTestId(TID.overhead)).toBeNull();
    act(() => services.telemetry.setState(machineIn('idle')));
    await advance(3 * 60_000);
    expect(screen.getByTestId(TID.overhead)).toBeInTheDocument();
    act(() => services.telemetry.setState(machineIn('espresso')));
    expect(screen.queryByTestId(TID.overhead)).toBeNull();
    expect(saverScreen.calls).toContain('restore');
  });

  it('shows with the machine asleep, or not connected at all', async () => {
    const { services } = setup({ telemetry: machineIn('sleeping') });
    await advance(3 * 60_000);
    expect(screen.getByTestId(TID.overhead)).toBeInTheDocument();
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })));
    act(() => services.telemetry.setState({ machineConnected: false }));
    await advance(3 * 60_000);
    expect(screen.getByTestId(TID.overhead)).toBeInTheDocument();
  });

  it('stays away outside Decaid, without its plugin, or turned off', async () => {
    setup({ insideDecaid: false });
    await advance(10 * 60_000);
    expect(screen.queryByTestId(TID.overhead)).toBeNull();
  });

  it('stays away without its plugin', async () => {
    setup({ missing: true });
    await advance(10 * 60_000);
    expect(screen.queryByTestId(TID.overhead)).toBeNull();
  });

  it('stays away when turned off in its settings', async () => {
    setup({ settings: { screensaverOn: false } });
    await advance(10 * 60_000);
    expect(screen.queryByTestId(TID.overhead)).toBeNull();
  });

  it('goes on a tap and swallows it, so nothing underneath is pressed', async () => {
    const pressed = vi.fn();
    setup();
    screen.getByText('underneath').addEventListener('click', pressed);
    await advance(3 * 60_000);
    const sheet = screen.getByTestId(TID.overhead);
    act(() => void sheet.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true })));
    expect(screen.queryByTestId(TID.overhead)).toBeNull();
    // The rest of the tap lands on the guard, not on the button.
    const guard = screen.getByTestId(TID.overheadGuard);
    act(() => void guard.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(pressed).not.toHaveBeenCalled();
    act(() => void window.dispatchEvent(new Event('pointerup')));
    await advance(GUARD_AFTER_UP_MS);
    expect(screen.queryByTestId(TID.overheadGuard)).toBeNull();
    // And it does not come straight back: the tap counts as a touch.
    await advance(60_000);
    expect(screen.queryByTestId(TID.overhead)).toBeNull();
  });

  it('dims to the night brightness in the night hours, and gives the brightness back as it goes', async () => {
    vi.setSystemTime(new Date(2026, 10, 23, 23, 0, 0));
    const { saverScreen } = setup({ settings: { nightDimStart: '22:00', nightDimEnd: '06:30', nightBrightness: 15 } });
    await advance(3 * 60_000);
    await advance(0);
    expect(screen.getByTestId(TID.overheadRow)).toBeInTheDocument();
    expect(saverScreen.held.at(-1)).toBe(15);
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(saverScreen.calls.at(-1)).toBe('restore');
  });

  it('says the data paused, and how old, when Decaid stops answering', async () => {
    let fail = false;
    let first: OverheadPayload | null = null;
    setup({
      answer: () => {
        if (fail) throw new OverheadUnavailable(0, 'Decaid could not be reached.');
        first ??= payload();
        return first;
      },
    });
    await advance(3 * 60_000);
    await advance(0);
    expect(screen.getByTestId(TID.overheadRow)).toBeInTheDocument();
    expect(screen.getByTestId(TID.overheadState)).toHaveAttribute('data-state', 'live');
    fail = true;
    await advance(45_000);
    expect(screen.getByTestId(TID.overheadState)).toHaveAttribute('data-state', 'stale');
    expect(screen.getByTestId(TID.overheadStatus)).toHaveTextContent('Live data paused');
  });

  it('takes the classic screensaver’s place while it is on', async () => {
    setup({ telemetry: machineIn('sleeping'), withClassic: true });
    await advance(SAVER_IDLE_MS + SAVER_SETTLE_MS);
    expect(screen.queryByTestId(TID.saver)).toBeNull();
    await advance(3 * 60_000);
    expect(screen.getByTestId(TID.overhead)).toBeInTheDocument();
  });

  it('leaves the classic screensaver alone when its plugin is not there', async () => {
    setup({ telemetry: machineIn('sleeping'), withClassic: true, missing: true });
    await advance(SAVER_IDLE_MS + SAVER_SETTLE_MS);
    expect(screen.getByTestId(TID.saver)).toBeInTheDocument();
  });

  it('opens as a Preview anywhere, asks for the recorded replay when told to, and never holds the screen', async () => {
    const { preview, saverScreen, asked } = setup({ insideDecaid: false });
    act(() => preview.show({ mock: true }));
    expect(screen.getByTestId(TID.overhead)).toHaveAttribute('data-phase', 'preview');
    await advance(0);
    expect(screen.getByTestId(TID.overheadRow)).toBeInTheDocument();
    expect(asked[0]).toEqual({ active: true, mock: true });
    expect(saverScreen.calls).toEqual([]);
  });
});
