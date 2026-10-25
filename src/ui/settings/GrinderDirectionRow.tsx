/**
 * Settings > Grinder > Finer is (D241): which way the barista's grinder goes
 * finer, Lower numbers (the default, CafAI's assumption before, D62) or
 * Higher numbers. Decaid's grinder library never says. Kept per grinder in
 * `grinderFinerHigher`, under Decaid's grinder id while it is linked, else
 * the typed name (grinderDirectionKey, src/storage/settings.ts). The coach's
 * grind steps, the change card and a preset list's order follow it
 * (src/coach/grinder.ts), and the coach is told it with the grinder
 * (GrinderPayload.finer).
 *
 * The card it sits in (GrinderCard.tsx) says which grinder the answer is for
 * and holds the answers (useGrinderDirections), so a grinder its own save
 * links or unlinks shows the answer that save keeps for it
 * (keptFinerHigher), at once.
 *
 * Drawn as the Mode control (AppearanceSection.tsx). A tap applies at once:
 * saved on what storage holds then, so another grinder's answer saved since
 * the answers were read is kept, then the coach reads its settings again. A
 * save that lands says "Saved." in the card's line (D234); one that fails
 * says so under the row, and the control goes back to the answer the coach
 * still uses. Held until the grinder has a name, with a line saying so.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useServices } from '../../app/services.tsx';
import { grinderDirectionKey, withGrinderDirection } from '../../storage/settings.ts';
import type { Settings } from '../../storage/types.ts';
import { TID } from '../testIds.ts';

/** The row's test ids, as kept with the rest in TID (src/ui/testIds.ts). */
export const GRINDER_DIRECTION_TID = { grinderFinerLower: TID.grinderFinerLower, grinderFinerHigher: TID.grinderFinerHigher } as const;

/** The line under the control while a grinder is named. */
export const FINER_IS_LINE = 'So the coach turns the dial the right way.';
/** The line while no grinder is named or picked: there is nothing to keep an answer for. */
export const NAME_GRINDER_FIRST = 'Name your grinder first.';

type Way = 'lower' | 'higher';

const WAYS: ReadonlyArray<{ way: Way; label: string; testId: string }> = [
  { way: 'lower', label: 'Lower numbers', testId: GRINDER_DIRECTION_TID.grinderFinerLower },
  { way: 'higher', label: 'Higher numbers', testId: GRINDER_DIRECTION_TID.grinderFinerHigher },
];

/** The Mode control's track (AppearanceSection.tsx): the chosen way a paper-coloured pill on raised. */
const trackSx: SxProps<Theme> = (theme) => ({
  bgcolor: 'cafai.raised',
  borderRadius: '14px',
  p: '4px',
  gap: '4px',
  '& .MuiToggleButtonGroup-grouped': {
    flex: '1 1 0',
    minWidth: 0,
    minHeight: 48,
    m: 0,
    border: 0,
    borderRadius: '10px',
    color: 'text.secondary',
    fontSize: '0.9375rem',
    transition: theme.transitions.create(['background-color', 'color', 'box-shadow'], {
      duration: theme.transitions.duration.shorter,
    }),
    '&.Mui-selected, &.Mui-selected:hover': {
      bgcolor: 'background.paper',
      color: 'text.primary',
      boxShadow: `0 1px 2px rgba(0, 0, 0, ${theme.palette.mode === 'dark' ? 0.35 : 0.14})`,
    },
    // Held, MUI would draw each segment's outline back in: the track stays as it is, its words greyed, as EffortRow's.
    '&.Mui-disabled': { border: 0, color: theme.palette.action.disabled },
    '&.Mui-selected.Mui-disabled': { color: theme.palette.text.secondary },
  },
});

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

type GrinderNamed = Pick<Settings, 'grinderId' | 'grinderName'>;

const linked = (grinder: GrinderNamed) => Boolean(grinder.grinderId?.trim());

/**
 * The answers with Higher numbers kept for the same grinder linked or
 * unlinked (D241): named by hand and then picked from Decaid's list under
 * the same name (spaces joined, any case, as grinderDirectionKey reads a
 * name), as the engine keeps it when the chat's grinder card links one, or
 * the other way round. The key it had stays too, so going back finds the
 * answer. Two of Decaid's grinders are two grinders, and a grinder renamed is
 * another, so either starts at Lower numbers. Null when nothing is kept: the
 * grinder before was not on Higher numbers, or this one already is.
 */
export function keptFinerHigher(before: GrinderNamed, after: GrinderNamed, list: readonly string[] | undefined): string[] | null {
  const from = grinderDirectionKey(before);
  const to = grinderDirectionKey(after);
  const answers = list ?? [];
  if (from === null || to === null || linked(before) === linked(after) || !answers.includes(from) || answers.includes(to)) return null;
  const name = grinderDirectionKey({ grinderName: before.grinderName });
  return name !== null && name === grinderDirectionKey({ grinderName: after.grinderName }) ? withGrinderDirection(answers, to, true) : null;
}

/** Settings.grinderFinerHigher as Settings shows it: read once, then changed as saves go out and come back. */
export interface GrinderDirections {
  /** The grinders whose higher numbers are finer; null until read. */
  list: readonly string[] | null;
  /** Why it could not be read; the row is held meanwhile, saying so. */
  readError: string | null;
  /** Change the list as shown, from what it is then; nothing while it is unread. */
  update(change: (list: readonly string[]) => readonly string[]): void;
}

/**
 * The answers, for the card that shows Finer is (GrinderCard.tsx) to hold, so
 * the row's taps and the card's own saves change one list.
 */
export function useGrinderDirections(): GrinderDirections {
  const { storage } = useServices();
  const [list, setList] = useState<readonly string[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    storage.settings.get().then(
      (settings) => {
        if (live) setList(settings.grinderFinerHigher ?? []);
      },
      (reason: unknown) => {
        // Held: an answer shown without the saved list could hide one saved here.
        if (live) setReadError(`Could not read which way is finer: ${errorText(reason)}`);
      },
    );
    return () => {
      live = false;
    };
  }, [storage]);

  const update = useCallback((change: (current: readonly string[]) => readonly string[]) => {
    setList((current) => (current === null ? current : change(current)));
  }, []);
  return useMemo(() => ({ list, readError, update }), [list, readError, update]);
}

export interface GrinderDirectionRowProps {
  /** The grinder the answer is for, by grinderDirectionKey (src/storage/settings.ts); null while none is named or picked. */
  grinderKey: string | null;
  /** The answers, as the card holds them (useGrinderDirections). */
  directions: GrinderDirections;
  /** Held while the card has not read its grinder fields. */
  disabled: boolean;
  /** The newest change saved: the card says "Saved." in its line, as for its own (D234). */
  onSaved?: () => void;
}

export function GrinderDirectionRow({ grinderKey, directions, disabled, onSaved }: GrinderDirectionRowProps) {
  const { storage, coach } = useServices();
  const helpId = useId();
  const { list, update } = directions;
  const [error, setError] = useState<string | null>(null);
  const latestSave = useRef(0);

  const way: Way | null = list === null || grinderKey === null ? null : list.includes(grinderKey) ? 'higher' : 'lower';
  const held = disabled || way === null;

  const save = async (key: string, higher: boolean) => {
    const ticket = ++latestSave.current;
    setError(null);
    // Shown at once; what storage holds after the save replaces it.
    update((current) => withGrinderDirection(current, key, higher));
    try {
      const current = await storage.settings.get();
      const saved = await storage.settings.update({ grinderFinerHigher: withGrinderDirection(current.grinderFinerHigher, key, higher) });
      if (ticket === latestSave.current) {
        update(() => saved.grinderFinerHigher ?? []);
        onSaved?.();
      }
    } catch (reason) {
      // Only the newest change speaks: one made after this that saved carried this one's list with it.
      if (ticket === latestSave.current) {
        // A tap on the chosen way saves nothing, so this grinder's answer was the other way.
        update((current) => withGrinderDirection(current, key, !higher));
        setError(`Could not save which way is finer: ${errorText(reason)}`);
      }
      return;
    }
    // The coach reads its settings again, so its next grind move goes the new way. A refresh
    // that fails leaves the answer saved, and the coach takes it at its next one.
    await coach.refresh().catch(() => undefined);
  };

  const choose = (next: Way | null) => {
    // A tap on the chosen way reports null: it stays chosen.
    if (next === null || next === way || grinderKey === null || list === null) return;
    void save(grinderKey, next === 'higher');
  };

  const shownError = error ?? directions.readError;
  return (
    <Stack spacing={1}>
      <Typography variant="label" component="div" sx={{ color: 'text.secondary' }}>
        Finer is
      </Typography>
      <ToggleButtonGroup
        exclusive
        fullWidth
        aria-label="Finer is"
        aria-describedby={helpId}
        value={way}
        disabled={held}
        onChange={(_event, next: Way | null) => choose(next)}
        sx={trackSx}
      >
        {WAYS.map(({ way: value, label, testId }) => (
          <ToggleButton key={value} value={value} data-testid={testId}>
            {label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography id={helpId} variant="body2" sx={{ color: 'text.secondary' }}>
        {grinderKey === null ? NAME_GRINDER_FIRST : FINER_IS_LINE}
      </Typography>
      {shownError ? (
        <Typography variant="body2" role="alert" sx={{ color: 'error.main' }}>
          {shownError}
        </Typography>
      ) : null}
    </Stack>
  );
}
