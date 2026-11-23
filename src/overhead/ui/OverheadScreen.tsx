/**
 * Overhead's screen, from one answer of the plugin and the time (the brief,
 * section 3): the map about 60% on the left and the board on the right in
 * landscape, the map above the board on a tall screen, always dark. Its
 * states:
 *
 * | State | When | Shows |
 * |---|---|---|
 * | Setup needed | no home | how to set it |
 * | Loading | no answer yet | a quiet line |
 * | Live | | map and board |
 * | Stale | the positions are over 30 s old, or Decaid stopped answering | "Live data paused" and how old |
 * | Empty | nothing on the board | "Quiet skies" |
 *
 * The map is passed in (`renderMap`): MapLibre needs WebGL 2, which tests
 * and some tablets lack.
 */
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import type { BucketRules } from '../domain/buckets.ts';
import { directionFor, type DirectionKind } from '../domain/direction.ts';
import type { LatLon } from '../domain/geo.ts';
import { STALE_AFTER_MS, type OverheadPayload, type RouteEnd } from '../shared/payload.ts';
import type { Palette } from '../../ui/palette.ts';
import { TID } from '../../ui/testIds.ts';
import { boardAt, highlighted, positionAt } from './motion.ts';
import { OverheadBoard } from './OverheadBoard.tsx';

export type PlaneKind = 'now' | 'soon' | 'passed' | 'other';

export interface MapPlane {
  hex: string;
  lat: number;
  lon: number;
  trackDeg: number | null;
  kind: PlaneKind;
  notable: boolean;
  trail: Array<[number, number]>;
  label: string;
}

export interface MapHighlight {
  hex: string;
  lat: number;
  lon: number;
  direction: DirectionKind;
  /** The airport the great circle runs to or from; null without a route. */
  far: RouteEnd | null;
}

export interface MapStyleChoice {
  url: string;
  /** Extra attribution the style itself does not carry (MapTiler's terms, DISCOVERY section 8). */
  attribution: string | null;
}

export interface MapViewProps {
  home: LatLon;
  planes: MapPlane[];
  highlight: MapHighlight | null;
  style: MapStyleChoice;
  palette: Palette;
  reducedMotion: boolean;
}

export const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/dark';

export function mapStyleFor(settings: OverheadPayload['settings']): MapStyleChoice {
  if (settings.mapTilerKey) {
    return {
      url: `https://api.maptiler.com/maps/${encodeURIComponent(settings.mapTilerMapId)}/style.json?key=${encodeURIComponent(settings.mapTilerKey)}`,
      attribution: '<a href="https://www.maptiler.com/copyright/" target="_blank">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>',
    };
  }
  return { url: OPENFREEMAP_STYLE, attribution: null };
}

/** "12 s", "3 min", "2 h". */
export function ageLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 90) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

export type ScreenState = 'loading' | 'setup' | 'live' | 'stale' | 'empty' | 'unavailable';

export interface OverheadScreenProps {
  payload: OverheadPayload | null;
  /** The last read failed: why. */
  error: string | null;
  now: number;
  palette: Palette;
  reducedMotion: boolean;
  /** Landscape: map left, board right. */
  wide: boolean;
  renderMap?: (props: MapViewProps) => ReactNode;
}

function Centered({ state, title, detail, palette }: { state: ScreenState; title: string; detail: string; palette: Palette }) {
  return (
    <Box data-testid={TID.overheadState} data-state={state} sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', px: '10%' }}>
      <Box sx={{ fontSize: 44, fontWeight: 700, color: palette.ink, lineHeight: 1.15 }}>{title}</Box>
      <Box sx={{ fontSize: 22, color: palette.inkMuted, mt: '16px', maxWidth: '34em', lineHeight: 1.4 }}>{detail}</Box>
    </Box>
  );
}

export function OverheadScreen({ payload, error, now, palette, reducedMotion, wide, renderMap }: OverheadScreenProps) {
  if (payload === null) {
    return error ? (
      <Centered state="unavailable" title="Overhead can't see the sky" detail={`${error} Overhead needs its plugin running in Decaid.`} palette={palette} />
    ) : (
      <Centered state="loading" title="Looking up…" detail="Finding the aircraft near home." palette={palette} />
    );
  }
  if (payload.home === null) {
    return (
      <Centered
        state="setup"
        title="Where is home?"
        detail="Overhead shows the aircraft passing over your home. Set your home's latitude and longitude in CafAI: Settings › Display › Overhead."
        palette={palette}
      />
    );
  }
  const { settings } = payload;
  const rules: BucketRules & { listCeilingFt: number } = settings;
  const entries = boardAt(payload.aircraft, rules, now);
  const kinds = new Map(entries.map((entry) => [entry.aircraft.hex, entry.bucket.kind as PlaneKind]));
  const notableHexes = new Set(payload.notable.map((sighting) => sighting.hex));
  const lead = highlighted(entries, now);
  const dataAge = payload.dataAt === null ? null : now - payload.dataAt;
  const stale = payload.stale || error !== null || dataAge === null || dataAge > STALE_AFTER_MS || now - payload.generatedAt > STALE_AFTER_MS;
  const planes: MapPlane[] = payload.aircraft.map((plane) => {
    // Under reduced motion the planes step with each answer rather than glide between them.
    const at = stale || reducedMotion ? { lat: plane.lat, lon: plane.lon } : positionAt(plane, now);
    return {
      hex: plane.hex,
      lat: at.lat,
      lon: at.lon,
      trackDeg: plane.trackDeg,
      kind: kinds.get(plane.hex) ?? 'other',
      notable: notableHexes.has(plane.hex),
      trail: [...plane.trail, [at.lon, at.lat] as [number, number]],
      label: plane.callsign ?? plane.registration ?? '',
    };
  });
  const leadPlane = lead ? planes.find((plane) => plane.hex === lead.hex) : undefined;
  const leadDirection = lead ? directionFor(lead.route, settings.homeAirport) : null;
  const highlight: MapHighlight | null =
    lead && leadPlane && leadDirection
      ? {
          hex: lead.hex,
          lat: leadPlane.lat,
          lon: leadPlane.lon,
          direction: leadDirection.kind,
          // The great circle is for an arrival's origin or a departure's destination (the brief), not a flight passing through.
          far: leadDirection.kind === 'arrival' || leadDirection.kind === 'departure' ? leadDirection.far : null,
        }
      : null;
  const state: ScreenState = stale ? 'stale' : entries.length === 0 ? 'empty' : 'live';
  const providerLine = payload.provider === 'mock' ? 'Recorded data' : payload.provider ? `Positions: ${payload.provider}` : 'Waiting for positions';
  return (
    <Box data-testid={TID.overheadState} data-state={state} sx={{ height: '100%', display: 'flex', flexDirection: wide ? 'row' : 'column', minHeight: 0 }}>
      <Box data-testid={TID.overheadMap} sx={{ position: 'relative', flex: wide ? '0 0 60%' : '0 0 45%', minWidth: 0, minHeight: 0, bgcolor: palette.background, opacity: stale ? 0.55 : 1 }}>
        {renderMap ? renderMap({ home: payload.home, planes, highlight, style: mapStyleFor(settings), palette, reducedMotion }) : null}
      </Box>
      <Box sx={{ flex: '1 1 auto', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', p: '22px 22px 14px', overflow: 'hidden', borderLeft: wide ? `1px solid ${palette.line}` : 'none' }}>
        <Box data-testid={TID.overheadStatus} data-stale={stale ? '1' : undefined} sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: '12px', gap: '12px' }}>
          <Box sx={{ fontSize: 18, letterSpacing: '0.12em', textTransform: 'uppercase', color: palette.inkMuted, fontWeight: 700 }}>Overhead</Box>
          {stale ? (
            <Box sx={{ fontSize: 20, fontWeight: 700, color: palette.warning }}>
              Live data paused{dataAge === null ? '' : ` · ${ageLabel(dataAge)} old`}
            </Box>
          ) : (
            <Box sx={{ fontSize: 17, color: palette.inkMuted }}>Live</Box>
          )}
        </Box>
        <Box sx={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
          <OverheadBoard
            entries={entries}
            notable={payload.notable}
            aircraft={payload.aircraft}
            highlightHex={lead?.hex ?? null}
            homeAirport={settings.homeAirport}
            palette={palette}
            now={now}
            around={payload.aircraft.filter((plane) => !plane.onGround).length}
          />
        </Box>
        <Box sx={{ fontSize: 13, color: palette.inkMuted, mt: '10px', lineHeight: 1.4 }}>
          {providerLine} · routes and types: hexdb.io (may be out of date) · notable aircraft: plane-alert-db
        </Box>
      </Box>
    </Box>
  );
}
