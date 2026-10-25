/**
 * Settings' search (D236): a field between the list's title and its rows,
 * 44 px on the raised colour, "Search settings" with a search icon, and a
 * clear button once it has words. While it has words, what it finds takes
 * the rows' place (SettingsList's searching): each setting by its name over
 * its group's name, drawn as the rows are, best first, at most eight
 * (settingsIndex.ts); or "No setting matches “<words>”." Clearing the field,
 * with its button or Escape, puts the rows back.
 *
 * A combobox: the focus stays in the field and the arrow keys move between
 * the results from there, round the ends; Enter opens the one chosen, or the
 * best. Opening one, by Enter or a tap, opens its group (on a phone, its
 * page) and brings the setting into view in the group's own column, focuses
 * it and washes its card (revealSetting.ts; no wash under reduced motion).
 * The words are SettingsScreen's to keep, so a phone's list still shows what
 * was found after the group's back arrow.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import Typography from '@mui/material/Typography';
import { useTheme, type SxProps, type Theme } from '@mui/material/styles';
import CloseRounded from '@mui/icons-material/CloseRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import { usePrefersReducedMotion } from '../platform/usePrefersReducedMotion.ts';
import { navigate } from '../router.ts';
import { TID } from '../testIds.ts';
import { settingsGroup } from './groups.tsx';
import { revealInColumn } from './reveal.ts';
import { revealSetting } from './revealSetting.ts';
import { searchSettings, type SettingsIndexEntry } from './settingsIndex.ts';

// The test id goes on the field's input, the element a test (or a keyboard) types into.
declare module '@mui/material/InputBase' {
  interface InputBaseComponentsPropsOverrides {
    'data-testid'?: string;
  }
}

export interface SettingsSearchProps {
  /** The words in the field. */
  query: string;
  onQueryChange(query: string): void;
}

/**
 * The field: the raised colour, no outline at rest; typing draws a 2 px
 * border in the accent round it (a border, which follows the corners in
 * Chromium 91, where an outline would not).
 */
const fieldSx: SxProps<Theme> = (theme) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  height: 44,
  pl: 1.25,
  pr: 0.5,
  mb: 1.5,
  bgcolor: 'cafai.raised',
  borderRadius: '12px',
  border: '2px solid transparent',
  transition: theme.transitions.create('border-color', { duration: theme.transitions.duration.shorter }),
  '&:focus-within': { borderColor: 'primary.main' },
  '& > svg': { fontSize: 22, color: 'text.secondary', flex: 'none' },
});

const inputSx: SxProps<Theme> = {
  flex: '1 1 auto',
  minWidth: 0,
  fontSize: '1rem',
  color: 'text.primary',
  '& .MuiInputBase-input': { p: 0, height: 40 },
  // The field draws its own clear button.
  '& input::-webkit-search-cancel-button, & input::-webkit-search-decoration': { WebkitAppearance: 'none', display: 'none' },
};

/** A result as the list's rows are drawn: the group's icon tile, the setting's name over the group's. */
const resultSx: SxProps<Theme> = (theme) => ({
  display: 'grid',
  gridTemplateColumns: '40px minmax(0, 1fr)',
  alignItems: 'center',
  columnGap: '12px',
  width: '100%',
  minHeight: 64,
  p: '10px',
  borderRadius: '14px',
  textAlign: 'left',
  color: 'text.primary',
  transition: theme.transitions.create('background-color', { duration: theme.transitions.duration.shorter }),
  '& .result-tile': {
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
  // The one the arrow keys chose, the focus still in the field: the focus ring's accent, inside the row.
  '&[aria-selected="true"]': { bgcolor: 'action.hover', boxShadow: `inset 0 0 0 2px ${theme.palette.primary.main}` },
});

/** Said to a screen reader, out of sight: how many were found. */
const unseenSx = {
  position: 'absolute',
  width: 1,
  height: 1,
  m: '-1px',
  p: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

const noneSx = { color: 'text.secondary', px: 1, py: 1 } as const;

function foundWords(found: number): string {
  return `${found} ${found === 1 ? 'setting' : 'settings'} found`;
}

export function SettingsSearch({ query, onQueryChange }: SettingsSearchProps) {
  const theme = useTheme();
  const reducedMotion = usePrefersReducedMotion();
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const listId = `${baseId}-found`;
  const words = query.trim();
  const searching = words !== '';
  const found = useMemo(() => searchSettings(query), [query]);
  // The result the arrow keys chose, for the words it was chosen among: new words choose none.
  const [chosen, setChosen] = useState<{ query: string; index: number } | null>(null);
  const active = chosen !== null && chosen.query === query && chosen.index < found.length ? chosen.index : null;
  const optionId = (entry: SettingsIndexEntry) => `${baseId}-${entry.id}`;

  // The result chosen stays in sight in the list's own column, never the page's.
  useEffect(() => {
    const list = listRef.current;
    const option = active === null ? null : list?.children[active];
    const column = list?.closest<HTMLElement>(`[data-testid="${TID.settingsList}"]`);
    if (option && column) revealInColumn(column, option, null, 8);
  }, [active]);

  const open = (entry: SettingsIndexEntry) => {
    navigate({ name: 'settings', group: entry.group });
    revealSetting(entry, { wash: reducedMotion ? null : theme.palette.cafai.accentSoft });
  };

  const clear = () => {
    onQueryChange('');
    input.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (found.length === 0) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const from = active ?? (step === 1 ? -1 : found.length);
      setChosen({ query, index: (from + step + found.length) % found.length });
    } else if (event.key === 'Enter') {
      const entry = found[active ?? 0];
      if (!entry) return;
      event.preventDefault();
      open(entry);
    } else if (event.key === 'Escape' && query !== '') {
      event.preventDefault();
      onQueryChange('');
    }
  };

  return (
    <Box role="search">
      <Box data-search-field sx={fieldSx}>
        <SearchRounded aria-hidden />
        <InputBase
          inputRef={input}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search settings"
          sx={inputSx}
          slotProps={{
            input: {
              type: 'search',
              role: 'combobox',
              'aria-label': 'Search settings',
              'aria-autocomplete': 'list',
              'aria-expanded': searching && found.length > 0,
              'aria-controls': listId,
              'aria-activedescendant': active !== null ? optionId(found[active]!) : undefined,
              'data-testid': TID.settingsSearch,
              enterKeyHint: 'search',
              autoComplete: 'off',
              autoCorrect: 'off',
              autoCapitalize: 'none',
              spellCheck: false,
            },
          }}
        />
        {query !== '' ? (
          // 48 px for a wet thumb, reaching past the field's 44 without moving it.
          <IconButton aria-label="Clear the search" data-testid={TID.settingsSearchClear} onClick={clear} sx={{ color: 'text.secondary', my: '-4px' }}>
            <CloseRounded />
          </IconButton>
        ) : null}
      </Box>
      <Box
        component="ul"
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Settings found"
        sx={{ listStyle: 'none', m: 0, p: 0, display: searching && found.length > 0 ? 'grid' : 'none', gap: 0.5 }}
      >
        {searching
          ? found.map((entry, index) => {
              const group = settingsGroup(entry.group);
              return (
                <ButtonBase
                  key={entry.id}
                  component="li"
                  id={optionId(entry)}
                  role="option"
                  aria-selected={index === active}
                  aria-labelledby={`${optionId(entry)}-name`}
                  aria-describedby={`${optionId(entry)}-group`}
                  tabIndex={-1}
                  data-testid={TID.settingsSearchResult(entry.id)}
                  // The focus stays in the field until the setting takes it.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => open(entry)}
                  sx={resultSx}
                >
                  <Box component="span" className="result-tile" aria-hidden>
                    {group.icon}
                  </Box>
                  <Box component="span" sx={{ minWidth: 0 }}>
                    <Typography id={`${optionId(entry)}-name`} variant="subtitle2" component="span" sx={{ display: 'block' }}>
                      {entry.name}
                    </Typography>
                    <Typography id={`${optionId(entry)}-group`} variant="caption" component="span" sx={{ display: 'block', color: 'text.secondary' }}>
                      {group.name}
                    </Typography>
                  </Box>
                </ButtonBase>
              );
            })
          : null}
      </Box>
      <Typography
        variant="body2"
        role="status"
        data-testid={searching && found.length === 0 ? TID.settingsSearchNone : undefined}
        sx={searching && found.length === 0 ? noneSx : unseenSx}
      >
        {!searching ? '' : found.length === 0 ? `No setting matches “${words}”.` : foundWords(found.length)}
      </Typography>
    </Box>
  );
}
