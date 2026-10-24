/**
 * Settings > Grinder > Finer is (D241): which way the barista's grinder goes
 * finer, Lower numbers (the default, CafAI's assumption before, D62) or
 * Higher numbers. Decaid's grinder library never says. Kept per grinder in
 * `grinderFinerHigher`, under Decaid's grinder id while it is linked, else
 * the typed name (grinderDirectionKey, src/storage/settings.ts); the card it
 * sits in passes the key of the grinder its form shows, so a pick or a name
 * typed there shows that grinder's answer. The coach's grind steps, the
 * change card and a preset list's order follow it (src/coach/grinder.ts),
 * and the coach is told it with the grinder (GrinderPayload.finer).
 *
 * Drawn as the Mode control (AppearanceSection.tsx). A tap applies at once:
 * saved on what storage holds then, so another grinder's answer saved since
 * this row read stays, then the coach reads its settings again. A save that
 * fails says so under it, and the control goes back to the answer the coach
 * still uses. Held until the grinder has a name, with a line saying so.
 */
import { useEffect, useId, useRef, useState } from 'react';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useServices } from '../../app/services.tsx';
import { withGrinderDirection } from '../../storage/settings.ts';

/** The row's test ids, for TID in src/ui/testIds.ts when the row is placed in the Grinder group (the coordinator moves them). */
export const GRINDER_DIRECTION_TID = {
  grinderFinerLower: 'grinder-finer-lower',
  grinderFinerHigher: 'grinder-finer-higher',
} as const;

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
  },
});

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

export interface GrinderDirectionRowProps {
  /** The grinder the card's form shows, by grinderDirectionKey (src/storage/settings.ts); null while none is named or picked. */
  grinderKey: string | null;
  /** Held while the card holds its grinder fields (reading or saving them). */
  disabled: boolean;
}

export function GrinderDirectionRow({ grinderKey, disabled }: GrinderDirectionRowProps) {
  const { storage, coach } = useServices();
  const helpId = useId();
  // The grinders whose higher numbers are finer, as last read or saved here; null until the settings are read.
  const [finerHigher, setFinerHigher] = useState<readonly string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestSave = useRef(0);

  useEffect(() => {
    let live = true;
    storage.settings.get().then(
      (settings) => {
        if (live) setFinerHigher(settings.grinderFinerHigher ?? []);
      },
      (reason: unknown) => {
        // Held: an answer shown without the saved list could hide one saved here.
        if (live) setError(`Could not read which way is finer: ${errorText(reason)}`);
      },
    );
    return () => {
      live = false;
    };
  }, [storage]);

  const way: Way | null = finerHigher === null || grinderKey === null ? null : finerHigher.includes(grinderKey) ? 'higher' : 'lower';
  const held = disabled || way === null;

  const save = async (key: string, next: Way, before: readonly string[]) => {
    const ticket = ++latestSave.current;
    setError(null);
    // Shown at once; what storage holds after the save replaces it.
    setFinerHigher(withGrinderDirection(before, key, next === 'higher'));
    try {
      const current = await storage.settings.get();
      const saved = await storage.settings.update({
        grinderFinerHigher: withGrinderDirection(current.grinderFinerHigher, key, next === 'higher'),
      });
      if (ticket === latestSave.current) setFinerHigher(saved.grinderFinerHigher ?? []);
    } catch (reason) {
      // Only the newest change speaks: one made after this that saved carried this one's list with it.
      if (ticket === latestSave.current) {
        setFinerHigher(before);
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
    if (next === null || next === way || grinderKey === null || finerHigher === null) return;
    void save(grinderKey, next, finerHigher);
  };

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
      {error ? (
        <Typography variant="body2" role="alert" sx={{ color: 'error.main' }}>
          {error}
        </Typography>
      ) : null}
    </Stack>
  );
}
