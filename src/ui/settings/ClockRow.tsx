/**
 * Settings > Display > Units > Clock (D245): 24-hour, as every time read
 * until the choice came (the default), or 12-hour, for the wake times and
 * the next wake, the log, History and the chat's dates. Each choice shows a
 * time as it would read. Drawn as the Mode control, applied at once and saved
 * with the other settings (DisplayPrefsStore, src/app/displayPrefs.ts), its
 * error as TemperatureUnitRow's. Decaid keeps its wake times "HH:MM" either
 * way. Without the store (a preview) it draws nothing, as the drink screens
 * do: there is nowhere to keep a choice.
 */
import { useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import type { DisplayPrefsStore } from '../../app/displayPrefs.ts';
import { useClockFormat, useOptionalServices } from '../../app/services.tsx';
import { formatClock, type ClockFormat } from '../clock.ts';
import { TID } from '../testIds.ts';

/** The row's test ids, as kept with the rest in TID (src/ui/testIds.ts). */
export const CLOCK_TID = {
  /** Each choice: clock-format-24h, clock-format-12h. */
  format: (format: ClockFormat) => TID.clockFormat(format),
} as const;

const FORMATS: ReadonlyArray<{ format: ClockFormat; name: string; sample: string }> = [
  { format: '24h', name: '24-hour', sample: formatClock(14, 30, '24h') },
  { format: '12h', name: '12-hour', sample: formatClock(14, 30, '12h') },
];

/** The Mode control's track (AppearanceSection.tsx), each choice its name over a time as it would read. */
const trackSx: SxProps<Theme> = (theme) => ({
  bgcolor: 'cafai.raised',
  borderRadius: '14px',
  p: '4px',
  gap: '4px',
  '& .MuiToggleButtonGroup-grouped': {
    flex: '1 1 0',
    minWidth: 0,
    minHeight: 48,
    flexDirection: 'column',
    gap: '2px',
    py: '6px',
    m: 0,
    border: 0,
    borderRadius: '10px',
    color: 'text.secondary',
    fontSize: '0.9375rem',
    lineHeight: 1.25,
    transition: theme.transitions.create(['background-color', 'color', 'box-shadow'], {
      duration: theme.transitions.duration.shorter,
    }),
    '&.Mui-selected, &.Mui-selected:hover': {
      bgcolor: 'background.paper',
      color: 'text.primary',
      boxShadow: `0 1px 2px rgba(0, 0, 0, ${theme.palette.mode === 'dark' ? 0.35 : 0.14})`,
    },
  },
  // The time under the name: smaller, muted, in tabular figures.
  '& .clock-sample': { fontSize: '0.8125rem', fontWeight: 500, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' },
});

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function ClockChoice({ store }: { store: DisplayPrefsStore }) {
  const clock = useClockFormat();
  const [error, setError] = useState<string | null>(null);
  const latestSave = useRef(0);

  const save = (next: ClockFormat) => {
    const ticket = ++latestSave.current;
    setError(null);
    store.setClock(next).catch((reason: unknown) => {
      // Only the newest change speaks: one made after this that saved carried this one with it.
      if (ticket === latestSave.current) setError(`Could not save the clock: ${errorText(reason)}`);
    });
  };

  return (
    <Stack spacing={1}>
      <Typography variant="label" component="div" sx={{ color: 'text.secondary' }}>
        Clock
      </Typography>
      <ToggleButtonGroup
        exclusive
        fullWidth
        aria-label="Clock"
        value={clock}
        // A tap on the chosen clock reports null: it stays chosen.
        onChange={(_event, next: ClockFormat | null) => {
          if (next !== null && next !== clock) save(next);
        }}
        sx={trackSx}
      >
        {FORMATS.map(({ format, name, sample }) => (
          <ToggleButton key={format} value={format} aria-label={name} data-testid={CLOCK_TID.format(format)}>
            <span>{name}</span>
            <span className="clock-sample">{sample}</span>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {error ? (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
    </Stack>
  );
}

export function ClockRow() {
  const store = useOptionalServices()?.displayPrefs;
  return store ? <ClockChoice store={store} /> : null;
}
