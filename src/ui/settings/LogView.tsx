/**
 * The log view (D139): the traffic log, newest first, full screen over
 * whatever is under it. Opened from Settings > Log, it is the app's (see
 * App.tsx), so a shot that takes the screen under it to the Shot view leaves
 * it open. One line per entry: the time, ↑ sent or ↓ received, the channel,
 * what, the status and the size; a tap opens the raw headers and body in
 * monospace, JSON pretty-printed, a huge body cut at 4,000 characters until
 * Show all (Share and Copy always have all of it). Filters (All, Decaid,
 * Live frames, Coach), Pause (the view holds still while the log keeps
 * recording), and the same Share, Email and Copy as Settings.
 *
 * It renders only while open: closed, nothing listens to the log, so
 * recording costs no render at all. Open, it hears of new entries at most
 * twice a second, shows 200 rows at a time, and a row renders only when its
 * entry changes.
 */
import { memo, useCallback, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { CHANNEL_LABEL, DIRECTION_ARROW, entryLine, formatBytes, formatClock, prettyBody } from '../../traffic/format.ts';
import { safeSlice, trafficLog, type TrafficEntry } from '../../traffic/recorder.ts';
import { MASK } from '../../usage/mask.ts';
import { TID } from '../testIds.ts';
import { LogActions } from './LogActions.tsx';
import { closeLogView, useLogViewOpen } from './logShare.ts';

type Filter = 'all' | 'decaid' | 'frames' | 'coach';

const FILTERS: ReadonlyArray<{ id: Filter; label: string; matches: (entry: TrafficEntry) => boolean }> = [
  { id: 'all', label: 'All', matches: () => true },
  { id: 'decaid', label: 'Decaid', matches: (entry) => entry.channel === 'rest' },
  { id: 'frames', label: 'Live frames', matches: (entry) => entry.channel === 'socket' },
  { id: 'coach', label: 'Coach', matches: (entry) => entry.channel === 'coach' },
];

/** Rows shown at a time. */
const PAGE = 200;
/** A body shows this much until Show all. */
export const DETAIL_CHARS = 4000;
const TITLE_ID = 'log-view-title';
const MONO = 'ui-monospace, "Roboto Mono", "Droid Sans Mono", Menlo, Consolas, monospace';

const DIRECTION_WORD = { sent: 'sent', received: 'received' } as const;

/** "the 4 frames after it on this channel were counted, not kept". */
export function moreNote(more: number): string {
  return more === 1 ? 'the frame after it on this channel was counted, not kept' : `the ${more} frames after it on this channel were counted, not kept`;
}

/** Entries in `live` newer than the newest one `held` has. */
function newerThan(live: readonly TrafficEntry[], held: readonly TrafficEntry[]): number {
  const newest = held[held.length - 1]?.id ?? 0;
  let count = 0;
  for (let i = live.length - 1; i >= 0 && live[i]!.id > newest; i -= 1) count += 1;
  return count;
}

function LogDetail({ entry }: { entry: TrafficEntry }) {
  const [whole, setWhole] = useState(false);
  const shown = useRef<HTMLPreElement>(null);
  const body = useMemo(() => prettyBody(entry.body), [entry.body]);
  const long = body.length > DETAIL_CHARS || entry.raw.length > DETAIL_CHARS;
  const show = (text: string) => (whole || text.length <= DETAIL_CHARS ? text : `${safeSlice(text, DETAIL_CHARS)}…`);
  const showAll = () => {
    // Show all goes away: focus moves to what it showed, not to the top of the dialog.
    flushSync(() => setWhole(true));
    shown.current?.focus();
  };
  return (
    <div className="detail" data-testid={TID.logDetail}>
      <div className="facts">
        {entryLine(entry)}
        {entry.more > 0 ? ` (${moreNote(entry.more)})` : ''}
      </div>
      {entry.headers ? <pre className="headers">{entry.headers}</pre> : null}
      {entry.body ? (
        <pre ref={shown} tabIndex={-1}>
          {show(body)}
        </pre>
      ) : (
        <div className="quiet">No body.</div>
      )}
      {entry.raw ? (
        <>
          <div className="quiet">Stream events</div>
          <pre ref={entry.body ? undefined : shown} tabIndex={-1}>
            {show(entry.raw)}
          </pre>
        </>
      ) : null}
      {long && !whole ? (
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1 }}>
          <Button size="small" onClick={showAll} data-testid={TID.logShowAll}>
            {`Show all ${formatBytes(body.length + entry.raw.length)}`}
          </Button>
          <span className="quiet">Share and Copy always have all of it.</span>
        </Box>
      ) : null}
    </div>
  );
}

const LogRow = memo(function LogRow({ entry, open, onToggle }: { entry: TrafficEntry; open: boolean; onToggle: (id: number) => void }) {
  const status = entry.more > 0 ? `${entry.status} +${entry.more}` : entry.status;
  return (
    <li>
      <button
        type="button"
        className="row"
        aria-expanded={open}
        onClick={() => onToggle(entry.id)}
        data-id={entry.id}
        data-testid={TID.logEntry(entry.id)}
      >
        <span className="time">{formatClock(entry.at)}</span>
        <span className="dir">
          <span aria-hidden="true">{DIRECTION_ARROW[entry.direction]}</span>
          <span className="sr">{DIRECTION_WORD[entry.direction]}</span>
        </span>
        <span className="chan">{CHANNEL_LABEL[entry.channel]}</span>
        <span className="what">{entry.what}</span>
        <span className={entry.failed ? 'status failed' : 'status'}>{status}</span>
        <span className="size">{entry.size !== null ? formatBytes(entry.size) : ''}</span>
      </button>
      {open ? <LogDetail entry={entry} /> : null}
    </li>
  );
});

const listSx = {
  listStyle: 'none',
  m: 0,
  p: 0,
  fontFamily: MONO,
  '& .row': {
    display: 'flex',
    alignItems: 'center',
    gap: { xs: '6px', sm: '8px' },
    width: '100%',
    minHeight: 44,
    px: { xs: 0.5, sm: 1 },
    py: 0.5,
    border: 0,
    borderBottom: '1px solid',
    borderColor: 'divider',
    background: 'none',
    color: 'text.primary',
    font: { xs: `12px/1.35 ${MONO}`, sm: `13px/1.35 ${MONO}` },
    textAlign: 'left',
    cursor: 'pointer',
    '&[aria-expanded="true"]': { bgcolor: 'action.selected' },
    '@media (hover: hover)': { '&:hover': { bgcolor: 'action.hover' } },
    '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
  },
  '& .time, & .chan, & .size': { flex: 'none', color: 'text.secondary' },
  '& .dir': { flex: 'none', width: '1ch', textAlign: 'center', position: 'relative' },
  // Said to a screen reader, not shown: the arrow is.
  '& .sr': { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' },
  '& .chan': { width: '5ch' },
  // What gives way on a narrow screen; the status and the size keep theirs.
  '& .what': { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  '& .status': { flex: 'none', maxWidth: '45%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  '& .failed': { color: 'error.main' },
  '& .size': { minWidth: { xs: '6ch', sm: '7ch' }, textAlign: 'right' },
  '& .detail': { px: 1, pt: 1, pb: 1.5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'action.hover' },
  '& .facts': { font: `12.5px/1.45 ${MONO}`, color: 'text.secondary', mb: 1, overflowWrap: 'anywhere' },
  '& pre': {
    m: 0,
    mb: 1,
    font: `12.5px/1.45 ${MONO}`,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    userSelect: 'text',
    WebkitUserSelect: 'text',
    // Focus comes here after Show all; the ring only for a keyboard.
    '&:focus': { outline: 'none' },
    '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
  },
  '& .headers': { color: 'text.secondary' },
  '& .quiet': { fontFamily: 'inherit', fontSize: 13, color: 'text.secondary', mb: 0.5 },
} as const;

function LogViewContent() {
  const live = useSyncExternalStore(trafficLog.subscribe, trafficLog.list);
  // Paused: the log as it stood, while recording goes on.
  const [held, setHeld] = useState<readonly TrafficEntry[] | null>(null);
  const shown = held ?? live;
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(PAGE);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const matches = (FILTERS.find((option) => option.id === filter) ?? FILTERS[0]!).matches;
  const rows = useMemo(() => {
    const newestFirst: TrafficEntry[] = [];
    for (let i = shown.length - 1; i >= 0; i -= 1) {
      const entry = shown[i]!;
      if (matches(entry)) newestFirst.push(entry);
    }
    return newestFirst;
  }, [shown, matches]);
  const fresh = held ? newerThan(live, held) : 0;
  const list = useRef<HTMLDivElement>(null);
  const chips = useRef<Array<HTMLDivElement | null>>([]);
  const toggle = useCallback((id: number) => {
    setExpanded((now) => {
      const next = new Set(now);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  const choose = (index: number) => {
    const option = FILTERS[index];
    if (!option) return;
    setFilter(option.id);
    setLimit(PAGE);
    // Another kind starts at its newest entry.
    if (list.current) list.current.scrollTop = 0;
  };
  // A radio group: the arrows, Home and End move the choice and the focus; Tab leaves the group.
  const chipKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = FILTERS.findIndex((option) => option.id === filter);
    const last = FILTERS.length - 1;
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? (at + 1) % FILTERS.length
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? (at + last) % FILTERS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : -1;
    if (next < 0) return;
    event.preventDefault();
    choose(next);
    chips.current[next]?.focus();
  };
  const showMore = () => {
    // Show more may go away: focus moves to the first row it showed.
    const first = rows[limit];
    flushSync(() => setLimit(limit + PAGE));
    if (first) list.current?.querySelector<HTMLElement>(`[data-id="${first.id}"]`)?.focus();
  };
  const readShown = () => shown;

  const count = `${shown.length} ${shown.length === 1 ? 'entry' : 'entries'}`;
  return (
    <Box
      data-testid={TID.logView}
      // What CafAI said to Decaid and the coach stays out of Clarity's recordings (D-USAGE-5).
      {...MASK}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        pt: 'var(--safe-top, 0px)',
        pb: 'var(--safe-bottom, 0px)',
        pl: 'var(--safe-left, 0px)',
        pr: 'var(--safe-right, 0px)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 2, pr: 1, py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h6" component="h2" id={TITLE_ID}>
          Log
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', flex: 1, minWidth: 0 }} noWrap>
          {held ? `${count}, paused` : count}
          {filter !== 'all' ? `, ${rows.length} shown` : ''}
        </Typography>
        <IconButton aria-label="Close the log" onClick={closeLogView} data-testid={TID.logClose}>
          <CloseIcon />
        </IconButton>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', columnGap: 2, rowGap: 1, px: 2, py: 1 }}>
        <Box role="radiogroup" aria-label="Show" onKeyDown={chipKeys} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {FILTERS.map((option, index) => {
            const on = option.id === filter;
            return (
              <Chip
                key={option.id}
                ref={(chip: HTMLDivElement | null) => {
                  chips.current[index] = chip;
                }}
                label={option.label}
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                clickable
                color={on ? 'primary' : 'default'}
                variant={on ? 'filled' : 'outlined'}
                onClick={() => choose(index)}
                data-testid={TID.logFilter(option.id)}
              />
            );
          })}
        </Box>
        <LogActions
          entries={readShown}
          leading={
            <Button
              variant="tonal"
              startIcon={held ? <PlayArrowIcon /> : <PauseIcon />}
              onClick={() => setHeld(held ? null : live)}
              data-testid={TID.logPause}
            >
              {held ? (fresh > 0 ? `Resume (${fresh} new)` : 'Resume') : 'Pause'}
            </Button>
          }
        />
      </Box>
      <Box ref={list} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', px: { xs: 1, sm: 2 }, pb: 2 }}>
        {rows.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', p: 1 }}>
            {shown.length === 0 ? 'Nothing recorded yet: entries come as CafAI talks to Decaid and the coach.' : 'Nothing of this kind yet.'}
          </Typography>
        ) : (
          <Box component="ul" data-testid={TID.logEntries} aria-labelledby={TITLE_ID} sx={listSx}>
            {rows.slice(0, limit).map((entry) => (
              <LogRow key={entry.id} entry={entry} open={expanded.has(entry.id)} onToggle={toggle} />
            ))}
          </Box>
        )}
        {rows.length > limit ? (
          <Button onClick={showMore} data-testid={TID.logMore} sx={{ mt: 1 }}>
            {`Show ${Math.min(PAGE, rows.length - limit)} more`}
          </Button>
        ) : null}
      </Box>
    </Box>
  );
}

/** Mounted once, beside the app's screens (App.tsx). */
export function LogView() {
  const open = useLogViewOpen();
  return (
    <Dialog fullScreen open={open} onClose={closeLogView} transitionDuration={0} aria-labelledby={TITLE_ID}>
      {open ? <LogViewContent /> : null}
    </Dialog>
  );
}
