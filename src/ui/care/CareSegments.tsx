/**
 * The routines, one at a time (D153): a tab list drawn as the Mode control's
 * segments (DESIGN.md, Appearance controls): a raised track, the chosen one a
 * surface pill with an ink label. A tap or an arrow key asks the screen for
 * that routine; the arrow keys, Home and End move the focus with the choice,
 * round the ends, and the chosen tab is the only Tab stop.
 */
import { useRef, type KeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import type { SxProps, Theme } from '@mui/material/styles';
import { TID } from '../testIds.ts';
import { ROUTINES } from './careGuide.ts';
import type { RoutineId } from './routines.ts';

export interface CareSegmentsProps {
  routine: RoutineId;
  onChange(routine: RoutineId): void;
  /** The routine's card, which every tab controls. */
  panelId: string;
  tabIdOf(routine: RoutineId): string;
}

const trackSx = {
  display: 'grid',
  gridTemplateColumns: `repeat(${ROUTINES.length}, minmax(0, 1fr))`,
  gap: '4px',
  p: '4px',
  bgcolor: 'cafai.raised',
  borderRadius: '14px',
} as const;

const segmentSx: SxProps<Theme> = (theme) => ({
  minWidth: 0,
  minHeight: 48,
  px: 0.5,
  borderRadius: '10px',
  color: 'text.secondary',
  fontFamily: 'inherit',
  fontSize: '0.9375rem',
  fontWeight: 600,
  lineHeight: 1.2,
  textAlign: 'center',
  transition: theme.transitions.create(['background-color', 'color', 'box-shadow'], {
    duration: theme.transitions.duration.shorter,
  }),
  '&[aria-selected="true"]': {
    bgcolor: 'background.paper',
    color: 'text.primary',
    boxShadow: `0 1px 2px rgba(0, 0, 0, ${theme.palette.mode === 'dark' ? 0.35 : 0.14})`,
  },
});

export function CareSegments({ routine, onChange, panelId, tabIdOf }: CareSegmentsProps) {
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (index: number) => {
    const at = (index + ROUTINES.length) % ROUTINES.length;
    onChange(ROUTINES[at]!.id);
    tabs.current[at]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const to =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? index + 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? ROUTINES.length - 1
              : null;
    if (to === null) return;
    event.preventDefault();
    move(to);
  };
  return (
    <Box role="tablist" aria-label="How often" sx={trackSx}>
      {ROUTINES.map((each, index) => {
        const selected = each.id === routine;
        return (
          <ButtonBase
            key={each.id}
            ref={(node: HTMLButtonElement | null) => {
              tabs.current[index] = node;
            }}
            role="tab"
            id={tabIdOf(each.id)}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            data-testid={TID.careSegment(each.id)}
            onClick={() => onChange(each.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            sx={segmentSx}
          >
            {each.label}
          </ButtonBase>
        );
      })}
    </Box>
  );
}
