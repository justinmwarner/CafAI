/**
 * Settings > Machine care's guide (#/care, D152-D155): Decent's cleaning
 * routine by how often, one routine at a time, each step with a line on how
 * and its moment in Decent's video. Nothing loads from YouTube until a tap;
 * the player plays in place where it can (videoPlace.ts) and the moments are
 * links to YouTube elsewhere.
 *
 * Laid out for its own box (useOwnLayout.ts): from 840 px the routines and
 * the steps on the left (at most 680 px, the chat's lane, so a line stays
 * readable on a big tablet), the video beside them; under it one column (at
 * most 760 px, as Settings), the video between the routines and the steps.
 * Both keep the same elements in the same order, so crossing the line (a
 * tablet turned upright) keeps the player playing.
 */
import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { useServices } from '../../app/services.tsx';
import { useOwnLayout } from '../machine/useOwnLayout.ts';
import { TID } from '../testIds.ts';
import { routineOf } from './careGuide.ts';
import { CareSegments } from './CareSegments.tsx';
import { CareVideo, type Playing } from './CareVideo.tsx';
import { RoutineCard } from './RoutineCard.tsx';
import type { RoutineId } from './routines.ts';
import { outsideLinkProps, videoPlaysInPlace } from './videoPlace.ts';

export interface CareScreenProps {
  routine: RoutineId;
  /** A segment chosen: the app replaces the address, so Back leaves Care. */
  onRoutine(routine: RoutineId): void;
  /** The back arrow: to Settings. */
  onBack(): void;
}

/** Two columns from this own width: every Decent tablet, an iPad on its side. */
export const WIDE_FROM = 840;
const chooseWide = (width: number) => width >= WIDE_FROM;

const PANEL_ID = 'care-routine-panel';
const tabIdOf = (routine: RoutineId) => `care-tab-${routine}`;

/** Wide: the room under the header, passed down to the grid, which scrolls its steps inside itself. */
const roomSx = { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' } as const;
/** Narrow: the room under the header scrolls as one, its bar at the screen's edge. */
const scrollSx = { flex: '1 1 auto', minHeight: 0, overflowY: 'auto' } as const;

/** The steps' column no wider than the chat's lane (680 px), the video's beside it, both from the left as Settings is. */
const wideSx = {
  flex: '1 1 auto',
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 680px) 360px',
  gridTemplateRows: 'auto minmax(0, 1fr)',
  gridTemplateAreas: '"seg video" "routine video"',
  justifyContent: 'start',
  columnGap: '20px',
  rowGap: '12px',
  px: 2,
  pt: 1.5,
} as const;

/** One column, no wider than Settings' (760 px). */
const narrowSx = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1.5,
  maxWidth: 760,
  px: 2,
  pt: 1.5,
} as const;

export function CareScreen({ routine, onRoutine, onBack }: CareScreenProps) {
  const { host } = useServices();
  const inPlace = videoPlaysInPlace(host);
  const linkProps = outsideLinkProps(host);
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLDivElement>(null);
  const wide = useOwnLayout(box, chooseWide);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const play = (start: number, key: string, label: string | null) =>
    setPlaying((current) => ({ start, key, label, take: (current?.take ?? 0) + 1 }));

  // In one column the player may be above the step that started it: bring it into view.
  const take = playing?.take ?? 0;
  useEffect(() => {
    if (take === 0 || wide) return;
    const node = video.current;
    if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' });
  }, [take, wide]);

  return (
    <Box ref={box} data-testid={TID.careScreen} sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Box
        sx={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 0.25,
          minHeight: 57,
          pl: 0.5,
          pr: 2,
          py: 0.5,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <IconButton data-testid={TID.careBack} aria-label="Back to Settings" onClick={onBack} sx={{ color: 'text.primary', borderRadius: '12px' }}>
          <ArrowBackRoundedIcon />
        </IconButton>
        <Typography variant="h6" component="h1">
          Machine care
        </Typography>
      </Box>
      <Box sx={wide ? roomSx : scrollSx}>
        <Box sx={wide ? wideSx : narrowSx}>
          <Box sx={{ gridArea: 'seg', minWidth: 0 }}>
            <CareSegments routine={routine} onChange={onRoutine} panelId={PANEL_ID} tabIdOf={tabIdOf} />
          </Box>
          {/* At the top of its column on a wide screen; across the column's width on a narrow one. */}
          <Box sx={wide ? { gridArea: 'video', alignSelf: 'start', minWidth: 0 } : { minWidth: 0 }}>
            <CareVideo
              ref={video}
              inPlace={inPlace}
              compact={!wide}
              playing={playing}
              onPlayFromStart={() => play(0, 'poster', null)}
              linkProps={linkProps}
            />
          </Box>
          {/* Keyed by the routine, so a new routine starts at its top. */}
          <Box key={routine} sx={wide ? { gridArea: 'routine', minHeight: 0, overflowY: 'auto', pb: 2 } : { pb: 2 }}>
            <RoutineCard
              routine={routineOf(routine)}
              numbered={wide}
              links={!inPlace}
              linkProps={linkProps}
              playingKey={playing?.key ?? null}
              onPlay={play}
              panelId={PANEL_ID}
              tabId={tabIdOf(routine)}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
