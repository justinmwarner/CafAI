// @vitest-environment jsdom
import '../../ui/chat/testing/setup.ts';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { buildPalette, namedTint } from '../../ui/palette.ts';
import { TID } from '../../ui/testIds.ts';
import { destinationPoint } from '../domain/geo.ts';
import { PAYLOAD_VERSION, type OverheadAircraft, type OverheadPayload } from '../shared/payload.ts';
import { DEFAULT_SETTINGS } from '../shared/settings.ts';
import { highlighted, HIGHLIGHT_EVERY_MS, positionAt } from './motion.ts';
import { altitudeLabel, flightName, whereLabel } from './OverheadBoard.tsx';
import { ageLabel, mapStyleFor, OPENFREEMAP_STYLE, OverheadScreen, type MapViewProps } from './OverheadScreen.tsx';
import { machineBusy, overheadMsUntilWanted } from './policy.ts';

const palette = buildPalette('dark', namedTint('crema'));
const HOME = { lat: 41.988, lon: -87.73 };
const NOW = Date.parse('2026-11-23T15:00:00Z');

const ORD = { icao: 'KORD', iata: 'ORD', name: "Chicago O'Hare International Airport", lat: 41.9786, lon: -87.9047 };
const AUH = { icao: 'OMAA', iata: 'AUH', name: 'Abu Dhabi International Airport', lat: 24.433, lon: 54.6511 };

function plane(hex: string, overrides: Partial<OverheadAircraft> = {}): OverheadAircraft {
  return {
    hex,
    callsign: 'ETD93C',
    registration: 'A6-BNF',
    typeCode: 'B789',
    typeName: 'Boeing 787-9 Dreamliner',
    operator: null,
    airline: 'Etihad',
    lat: HOME.lat,
    lon: HOME.lon + 0.05,
    positionAt: NOW,
    altitudeFt: 4700,
    onGround: false,
    groundSpeedKt: 215,
    trackDeg: 270,
    verticalRateFpm: null,
    distanceNm: 2.2,
    bearingDeg: 90,
    cpa: { timeToCpaSeconds: 200, distanceMiles: 0.6, side: 'north' },
    route: { raw: 'OMAA-KORD', origin: AUH, destination: ORD, updatedAt: Date.parse('2026-05-18T00:00:00Z') },
    notable: null,
    trail: [],
    ...overrides,
  };
}

function payload(overrides: Partial<OverheadPayload> = {}): OverheadPayload {
  return {
    version: PAYLOAD_VERSION,
    generatedAt: NOW,
    provider: 'adsb.fi',
    dataAt: NOW,
    stale: false,
    home: HOME,
    settings: { ...DEFAULT_SETTINGS, homeLat: HOME.lat, homeLon: HOME.lon },
    aircraft: [plane('8965f4')],
    notable: [],
    providers: [],
    ...overrides,
  };
}

function show(value: OverheadPayload | null, options: { error?: string | null; now?: number; map?: (props: MapViewProps) => null } = {}) {
  return render(<OverheadScreen payload={value} error={options.error ?? null} now={options.now ?? NOW} palette={palette} reducedMotion={false} wide renderMap={options.map ?? (() => null)} />);
}

const state = () => screen.getByTestId(TID.overheadState).getAttribute('data-state');

describe('Overhead’s screen', () => {
  it('asks for home before anything else', () => {
    show(payload({ home: null }));
    expect(state()).toBe('setup');
    expect(screen.getByText('Where is home?')).toBeInTheDocument();
  });

  it('says it is looking while nothing has come yet, and why it cannot when the plugin is missing', () => {
    const { unmount } = show(null);
    expect(state()).toBe('loading');
    unmount();
    show(null, { error: 'The Overhead plugin is not running in Decaid.' });
    expect(state()).toBe('unavailable');
  });

  it('lists an arrival as the brief writes it', () => {
    show(payload());
    expect(state()).toBe('live');
    const row = screen.getByTestId(TID.overheadRow);
    expect(row).toHaveTextContent('3 min');
    expect(row).toHaveTextContent('Etihad 93C');
    expect(row).toHaveTextContent('Boeing 787-9 Dreamliner');
    expect(row).toHaveTextContent('From Abu Dhabi (AUH)');
    expect(row).toHaveTextContent('4,700 ft');
    expect(row).toHaveTextContent('0.6 mi north');
  });

  it('marks a route hexdb last saw over a year ago', () => {
    show(payload({ aircraft: [plane('a', { route: { raw: 'KDEN-KORD', origin: { ...ORD, icao: 'KDEN', iata: 'DEN', name: 'Denver International Airport' }, destination: ORD, updatedAt: Date.parse('2019-05-08T00:00:00Z') } })] }));
    expect(screen.getByTestId(TID.overheadRow)).toHaveTextContent('From Denver (DEN) · listed 2019');
  });

  it('says so when there is no route', () => {
    show(payload({ aircraft: [plane('a', { route: null })] }));
    expect(screen.getByTestId(TID.overheadRow)).toHaveTextContent('Route not published');
  });

  it('pins the notable aircraft’s card above the board', () => {
    const notable = { operator: 'US Helicopters (ABC7 Chicago)', registration: 'N117HD', type: 'AS-350 Ecureuil', icaoType: 'AS50', category: 'As Seen on TV', group: 'Civ', tags: ['As Seen on TV'], link: 'https://abc7chicago.com' };
    const helicopter = plane('a046e7', { callsign: 'N117HD', airline: null, typeName: 'Aerospatiale AS-350 Ecureuil', distanceNm: 10.4, bearingDeg: 225, trackDeg: 297, altitudeFt: 1100, cpa: null, notable, route: null });
    show(payload({ aircraft: [plane('8965f4'), helicopter], notable: [{ hex: 'a046e7', info: notable, since: NOW }] }));
    const card = screen.getByTestId(TID.overheadNotable);
    expect(card).toHaveTextContent('US Helicopters (ABC7 Chicago)');
    expect(card).toHaveTextContent('As Seen on TV');
    expect(card).toHaveTextContent('AS-350 Ecureuil');
    expect(card).toHaveTextContent('12 mi southwest, heading northwest');
    expect(card).toHaveTextContent('plane-alert-db: abc7chicago.com');
    // Not near the house, so not on the board.
    expect(screen.getAllByTestId(TID.overheadRow)).toHaveLength(1);
  });

  it('shows quiet skies with nothing on the board', () => {
    show(payload({ aircraft: [plane('far', { cpa: { timeToCpaSeconds: 100, distanceMiles: 8, side: 'south' } })] }));
    expect(state()).toBe('empty');
    expect(screen.getByTestId(TID.overheadBoard)).toHaveTextContent('Quiet skies');
    expect(screen.getByTestId(TID.overheadBoard)).toHaveTextContent('1 aircraft about, none passing close.');
  });

  it('says the live data paused, and how old it is', () => {
    show(payload({ stale: true, dataAt: NOW - 95_000 }));
    expect(state()).toBe('stale');
    expect(screen.getByTestId(TID.overheadStatus)).toHaveTextContent('Live data paused · 2 min old');
  });

  it('hands the map home, every aircraft, and the highlighted arrival’s origin', () => {
    let seen: MapViewProps | null = null;
    show(payload(), {
      map: (props) => {
        seen = props;
        return null;
      },
    });
    const props = seen as unknown as MapViewProps;
    expect(props.home).toEqual(HOME);
    expect(props.planes.map((item) => item.kind)).toEqual(['soon']);
    expect(props.highlight).toMatchObject({ hex: '8965f4', direction: 'arrival', far: { icao: 'OMAA' } });
    expect(props.style).toEqual({ url: OPENFREEMAP_STYLE, attribution: null });
  });
});

describe('the screen’s helpers', () => {
  it('names flights', () => {
    expect(flightName({ callsign: 'UAL2428', airline: 'United', registration: 'N17427', hex: 'a12ac7' })).toBe('United 2428');
    expect(flightName({ callsign: 'N442PP', airline: 'Wilco Helicopters', registration: 'N442PP', hex: 'a5535e' })).toBe('N442PP');
    expect(flightName({ callsign: null, airline: null, registration: null, hex: 'a5535e' })).toBe('A5535E');
    expect(altitudeLabel(12925)).toBe('12,925 ft');
    expect(whereLabel(plane('x', { distanceNm: 0.5, bearingDeg: 0, trackDeg: null }))).toBe('0.6 mi north');
  });

  it('uses MapTiler only with a key, with its attribution', () => {
    expect(mapStyleFor({ ...DEFAULT_SETTINGS }).url).toBe(OPENFREEMAP_STYLE);
    const tiler = mapStyleFor({ ...DEFAULT_SETTINGS, mapTilerKey: 'abcdefgh12' });
    expect(tiler.url).toBe('https://api.maptiler.com/maps/dataviz-dark/style.json?key=abcdefgh12');
    expect(tiler.attribution).toContain('© MapTiler');
    expect(tiler.attribution).toContain('© OpenStreetMap contributors');
  });

  it('tells ages', () => {
    expect(ageLabel(12_000)).toBe('12 s');
    expect(ageLabel(95_000)).toBe('2 min');
    expect(ageLabel(3 * 3600_000)).toBe('3 h');
  });

  it('moves aircraft on between answers, for a minute at most, and never on the ground', () => {
    const flying = plane('a', { lat: HOME.lat, lon: HOME.lon, groundSpeedKt: 240, trackDeg: 90 });
    const later = positionAt(flying, NOW + 30_000);
    const expected = destinationPoint(HOME, 2, 90);
    expect(later.lat).toBeCloseTo(expected.lat, 6);
    expect(later.lon).toBeCloseTo(expected.lon, 6);
    expect(positionAt(flying, NOW + 10 * 60_000)).toEqual(positionAt(flying, NOW + 60_000));
    expect(positionAt({ ...flying, onGround: true }, NOW + 30_000)).toEqual({ lat: HOME.lat, lon: HOME.lon });
  });

  it('highlights a Now until it passes, else each in turn every 10 s', () => {
    const a = plane('a');
    const b = plane('b');
    const soon = { kind: 'soon' as const, minutes: 2, seconds: 100 };
    expect(highlighted([{ aircraft: a, bucket: soon }, { aircraft: b, bucket: { kind: 'now' } }], 0)?.hex).toBe('b');
    expect(highlighted([{ aircraft: a, bucket: soon }, { aircraft: b, bucket: soon }], 0)?.hex).toBe('a');
    expect(highlighted([{ aircraft: a, bucket: soon }, { aircraft: b, bucket: soon }], HIGHLIGHT_EVERY_MS)?.hex).toBe('b');
    expect(highlighted([], 0)).toBeNull();
  });
});

describe('when Overhead may come', () => {
  const idle = { machineConnected: true, unreachable: false, machine: { state: { state: 'idle' } } } as Parameters<typeof machineBusy>[0];
  it('counts only idle and asleep as not busy', () => {
    for (const state of ['espresso', 'steam', 'hotWater', 'flush', 'cleaning', 'descaling', 'heating', 'preheating', 'error']) {
      expect(machineBusy({ ...idle, machine: { state: { state } } } as Parameters<typeof machineBusy>[0])).toBe(true);
    }
    expect(machineBusy(idle)).toBe(false);
    expect(machineBusy({ ...idle, machine: { state: { state: 'sleeping' } } } as Parameters<typeof machineBusy>[0])).toBe(false);
    expect(machineBusy({ ...idle, machineConnected: false })).toBe(false);
    expect(machineBusy({ ...idle, unreachable: true })).toBe(true);
  });

  it('waits the minutes untouched', () => {
    const inputs = { available: true, insideDecaid: true, busy: false, untouchedMs: 60_000, idleMinutes: 3 };
    expect(overheadMsUntilWanted(inputs)).toBe(120_000);
    expect(overheadMsUntilWanted({ ...inputs, untouchedMs: 200_000 })).toBe(0);
    expect(overheadMsUntilWanted({ ...inputs, busy: true })).toBeNull();
    expect(overheadMsUntilWanted({ ...inputs, available: false })).toBeNull();
    expect(overheadMsUntilWanted({ ...inputs, insideDecaid: false })).toBeNull();
  });
});
