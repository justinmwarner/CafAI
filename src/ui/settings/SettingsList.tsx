/**
 * Settings' own list (D232): the title, the search field's place, and the
 * seven groups (groups.tsx) as rows, each with its icon, its name and how it
 * stands (groupStatus.ts). On a tablet it is the first column, beside the
 * group it marks current; on a phone it is the page Settings opens on, and a
 * row opens its group's page, so each row ends in a chevron. Its own scroll,
 * never the page's.
 *
 * Each row is a link to its group's address (#/settings/coach), drawn as
 * History's rows are: 64 px, a 40 px icon tile, the name (15 px at 600) and
 * the status line (13 px, ink-muted, one line). The current one is accent on
 * accent-wash, as the current place in the top bar is, its tile accent;
 * never a stripe down its side. A dot at the end, in the warning colour,
 * when the status line says something needs the barista (the words say it
 * too). One tab stop: the arrow keys, Home and End move between the rows,
 * round the ends, as Machine care's routines do.
 */
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import { routeHref } from '../router.ts';
import { TID } from '../testIds.ts';
import type { SettingsGroupId } from './groupIds.ts';
import { SETTINGS_GROUPS, type SettingsGroup } from './groups.tsx';
import { useGroupStatus } from './groupStatus.ts';

export interface SettingsListProps {
  /** The group beside the list, marked current (a tablet); null on a phone's list, where a row opens a page. */
  chosen: SettingsGroupId | null;
  /** Rows end in a chevron: a phone's list, where each opens a page of its own. */
  chevrons: boolean;
  /** The search field, between the title and the rows (D236). */
  search?: ReactNode;
}

const rowSx: SxProps<Theme> = (theme) => ({
  display: 'grid',
  gridTemplateColumns: '40px minmax(0, 1fr) auto',
  alignItems: 'center',
  columnGap: '12px',
  width: '100%',
  minHeight: 64,
  p: '10px',
  borderRadius: '14px',
  textAlign: 'left',
  color: 'text.primary',
  transition: theme.transitions.create('background-color', { duration: theme.transitions.duration.shorter }),
  '& .row-tile': {
    width: 40,
    height: 40,
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    bgcolor: 'cafai.raised',
    color: 'text.secondary',
    '& svg': { fontSize: 22 },
  },
  '@media (hover: hover)': { '&:hover': { bgcolor: 'action.hover' } },
  '&[aria-current="page"], &[aria-current="page"]:hover': {
    bgcolor: 'cafai.accentSoft',
    '& .row-name': { color: 'primary.main' },
    '& .row-tile': { bgcolor: 'primary.main', color: 'primary.contrastText' },
  },
});

/** The dot beside words that say something needs the barista: decoration for them, never the only signal. */
const dotSx = { width: 8, height: 8, borderRadius: '50%', bgcolor: 'warning.main', flex: 'none' } as const;

interface RowProps {
  group: SettingsGroup;
  current: boolean;
  chevron: boolean;
  /** The one row in the tab order. */
  tabStop: boolean;
  setRef(node: HTMLAnchorElement | null): void;
  onFocus(): void;
  onKeyDown(event: KeyboardEvent<HTMLAnchorElement>): void;
}

function GroupRow({ group, current, chevron, tabStop, setRef, onFocus, onKeyDown }: RowProps) {
  const status = useGroupStatus(group.id);
  const nameId = useId();
  const statusId = useId();
  return (
    <ButtonBase
      ref={setRef}
      component="a"
      href={routeHref({ name: 'settings', group: group.id })}
      aria-current={current ? 'page' : undefined}
      aria-labelledby={nameId}
      aria-describedby={statusId}
      tabIndex={tabStop ? 0 : -1}
      data-testid={TID.settingsGroupRow(group.id)}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      sx={rowSx}
    >
      <Box component="span" className="row-tile" aria-hidden>
        {group.icon}
      </Box>
      <Box component="span" sx={{ minWidth: 0 }}>
        <Typography id={nameId} variant="subtitle2" component="span" className="row-name" sx={{ display: 'block' }}>
          {group.name}
        </Typography>
        <Typography id={statusId} variant="caption" component="span" noWrap sx={{ display: 'block', color: 'text.secondary' }}>
          {status.line}
        </Typography>
      </Box>
      <Box component="span" aria-hidden sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
        {status.attention ? <Box component="span" sx={dotSx} /> : null}
        {chevron ? <ChevronRightRounded /> : null}
      </Box>
    </ButtonBase>
  );
}

export function SettingsList({ chosen, chevrons, search }: SettingsListProps) {
  const rows = useRef<Array<HTMLAnchorElement | null>>([]);
  // The row the tab order comes back to: the last one focused, else the current group's, else the first.
  const [focused, setFocused] = useState<number | null>(null);
  const chosenIndex = SETTINGS_GROUPS.findIndex((group) => group.id === chosen);
  const tabStop = focused ?? (chosenIndex >= 0 ? chosenIndex : 0);

  const onKeyDown = (event: KeyboardEvent<HTMLAnchorElement>, index: number) => {
    const count = SETTINGS_GROUPS.length;
    const to =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? index + 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? count - 1
              : null;
    if (to === null) return;
    event.preventDefault();
    rows.current[(to + count) % count]?.focus();
  };

  return (
    <Box component="nav" aria-label="Settings" data-testid={TID.settingsList} sx={{ height: '100%', minHeight: 0, overflowY: 'auto' }}>
      <Box sx={{ px: 1.5, pt: 2, pb: 2, maxWidth: 760 }}>
        <Typography variant="h6" component="h1" sx={{ mx: 1, mt: 0.5, mb: 1.5 }}>
          Settings
        </Typography>
        {search}
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 0.5 }}>
          {SETTINGS_GROUPS.map((group, index) => (
            <li key={group.id}>
              <GroupRow
                group={group}
                current={group.id === chosen}
                chevron={chevrons}
                tabStop={index === tabStop}
                setRef={(node) => {
                  rows.current[index] = node;
                }}
                onFocus={() => setFocused(index)}
                onKeyDown={(event) => onKeyDown(event, index)}
              />
            </li>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
