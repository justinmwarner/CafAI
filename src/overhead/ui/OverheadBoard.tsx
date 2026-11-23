/**
 * The departure board (the brief): what passes near home, Now first, in type
 * big enough to read across a kitchen. Each row: the bucket, the airline and
 * flight number, the aircraft type in words, where it comes from or goes to,
 * its altitude, and how close it passes. A notable aircraft's card is pinned
 * above, wherever that aircraft is going.
 */
import Box from '@mui/material/Box';
import { bucketLabel, type Bucket, type BoardEntry } from '../domain/buckets.ts';
import { cpaLabel } from '../domain/cpa.ts';
import { directionFor, routeIsOld } from '../domain/direction.ts';
import { compassPoint, MILES_PER_NM } from '../domain/geo.ts';
import { splitCallsign } from '../domain/words.ts';
import type { NotableSighting, OverheadAircraft } from '../shared/payload.ts';
import type { Palette } from '../../ui/palette.ts';
import { TID } from '../../ui/testIds.ts';

/** "United 2428"; a callsign or registration as it is when it is not an airline's. */
export function flightName(aircraft: Pick<OverheadAircraft, 'callsign' | 'airline' | 'registration' | 'hex'>): string {
  const parts = splitCallsign(aircraft.callsign);
  if (parts && aircraft.airline) return `${aircraft.airline} ${parts.number}`;
  return aircraft.callsign ?? aircraft.registration ?? aircraft.hex.toUpperCase();
}

export function altitudeLabel(feet: number | null): string {
  return feet === null ? '' : `${Math.round(feet).toLocaleString('en-US')} ft`;
}

export function bucketColor(bucket: Bucket, palette: Palette): string {
  if (bucket.kind === 'now') return palette.accent;
  if (bucket.kind === 'soon') return palette.info;
  return palette.inkMuted;
}

interface NotableCardProps {
  sighting: NotableSighting;
  aircraft: OverheadAircraft | undefined;
  palette: Palette;
}

/** "9.5 mi southwest, heading east". */
export function whereLabel(aircraft: OverheadAircraft): string {
  const miles = aircraft.distanceNm * MILES_PER_NM;
  const heading = aircraft.trackDeg === null ? '' : `, heading ${compassPoint(aircraft.trackDeg)}`;
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi ${compassPoint(aircraft.bearingDeg)}${heading}`;
}

function NotableCard({ sighting, aircraft, palette }: NotableCardProps) {
  const { info } = sighting;
  const kind = [info.category, info.group === 'Gov' ? 'Government' : info.group === 'Mil' ? 'Military' : null].filter(Boolean).join(' · ');
  const type = info.type ?? aircraft?.typeName ?? aircraft?.typeCode ?? null;
  return (
    <Box
      data-testid={TID.overheadNotable}
      data-hex={sighting.hex}
      sx={{ border: `2px solid ${palette.error}`, borderRadius: '14px', p: '14px 18px', mb: '14px', bgcolor: palette.surface }}
    >
      <Box sx={{ fontSize: 15, letterSpacing: '0.08em', textTransform: 'uppercase', color: palette.error, fontWeight: 700 }}>Notable aircraft</Box>
      <Box sx={{ fontSize: 27, fontWeight: 700, lineHeight: 1.2, mt: '4px', color: palette.ink }}>{info.operator}</Box>
      {kind ? <Box sx={{ fontSize: 19, color: palette.ink, mt: '2px' }}>{kind}</Box> : null}
      <Box sx={{ fontSize: 19, color: palette.inkMuted, mt: '4px' }}>
        {[type, info.registration ?? aircraft?.registration, aircraft ? whereLabel(aircraft) : null].filter(Boolean).join(' · ')}
      </Box>
      {info.link ? <Box sx={{ fontSize: 15, color: palette.inkMuted, mt: '4px', overflowWrap: 'anywhere' }}>plane-alert-db: {info.link.replace(/^https?:\/\//, '')}</Box> : null}
    </Box>
  );
}

interface RowProps {
  entry: BoardEntry<OverheadAircraft>;
  homeAirport: string;
  highlighted: boolean;
  palette: Palette;
  now: number;
}

function Row({ entry, homeAirport, highlighted, palette, now }: RowProps) {
  const { aircraft, bucket } = entry;
  const direction = directionFor(aircraft.route, homeAirport);
  const old = aircraft.route !== null && routeIsOld(aircraft.route, now);
  const color = bucketColor(bucket, palette);
  return (
    <Box
      data-testid={TID.overheadRow}
      data-hex={aircraft.hex}
      data-bucket={bucket.kind}
      data-highlighted={highlighted ? '1' : undefined}
      sx={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        columnGap: '14px',
        alignItems: 'baseline',
        p: '12px 14px',
        borderRadius: '12px',
        borderLeft: `5px solid ${highlighted ? color : 'transparent'}`,
        bgcolor: highlighted ? palette.raised : 'transparent',
      }}
    >
      <Box sx={{ fontSize: 22, fontWeight: 800, color, minWidth: '4.6em', fontVariantNumeric: 'tabular-nums' }}>{bucketLabel(bucket)}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ fontSize: 28, fontWeight: 700, color: palette.ink, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{flightName(aircraft)}</Box>
        <Box sx={{ fontSize: 19, color: palette.ink, mt: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {aircraft.typeName ?? aircraft.typeCode ?? 'Type not published'}
        </Box>
        {/* Where it is going first; a route hexdb last saw over a year ago says when, after it (DECISIONS O5). Two lines at most. */}
        <Box sx={{ fontSize: 19, color: palette.inkMuted, mt: '2px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {direction.text}
          {old && aircraft.route?.updatedAt ? ` · listed ${new Date(aircraft.route.updatedAt).getFullYear()}` : ''}
        </Box>
      </Box>
      <Box sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        <Box sx={{ fontSize: 22, fontWeight: 600, color: palette.ink }}>{altitudeLabel(aircraft.altitudeFt)}</Box>
        <Box sx={{ fontSize: 17, color: palette.inkMuted, mt: '4px', whiteSpace: 'nowrap' }}>{aircraft.cpa ? cpaLabel(aircraft.cpa) : ''}</Box>
      </Box>
    </Box>
  );
}

export interface OverheadBoardProps {
  entries: ReadonlyArray<BoardEntry<OverheadAircraft>>;
  notable: readonly NotableSighting[];
  aircraft: readonly OverheadAircraft[];
  highlightHex: string | null;
  homeAirport: string;
  palette: Palette;
  now: number;
  /** Shown when the board is empty: how many aircraft are about, none of them close. */
  around: number;
}

export function OverheadBoard({ entries, notable, aircraft, highlightHex, homeAirport, palette, now, around }: OverheadBoardProps) {
  const byHex = new Map(aircraft.map((plane) => [plane.hex, plane]));
  return (
    <Box data-testid={TID.overheadBoard} sx={{ display: 'flex', flexDirection: 'column', gap: '6px', minHeight: 0 }}>
      {notable.slice(0, 1).map((sighting) => (
        <NotableCard key={sighting.hex} sighting={sighting} aircraft={byHex.get(sighting.hex)} palette={palette} />
      ))}
      {entries.length === 0 ? (
        <Box sx={{ py: '28px', textAlign: 'center' }}>
          <Box sx={{ fontSize: 40, fontWeight: 700, color: palette.ink }}>Quiet skies</Box>
          <Box sx={{ fontSize: 20, color: palette.inkMuted, mt: '8px' }}>
            {around === 0 ? 'No aircraft nearby right now.' : `${around} aircraft about, none passing close.`}
          </Box>
        </Box>
      ) : (
        entries.slice(0, 6).map((entry) => (
          <Row key={entry.aircraft.hex} entry={entry} homeAirport={homeAirport} highlighted={entry.aircraft.hex === highlightHex} palette={palette} now={now} />
        ))
      )}
    </Box>
  );
}
