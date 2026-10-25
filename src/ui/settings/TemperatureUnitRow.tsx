/**
 * Settings > Display > Units > Temperatures (D172): °C or °F, wherever the
 * barista reads or sets a temperature, and in the coach's words. Decaid and
 * the profiles keep °C either way (D171). Drawn as Appearance's Mode
 * control, and like the rest of Display it applies at once and is saved
 * with the other settings (TemperatureUnitStore, src/app/temperatureUnit.ts).
 */
import { useId, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useServices, useTemperatureUnit } from '../../app/services.tsx';
import type { TemperatureUnit } from '../../coach/temperature.ts';
import { TID } from '../testIds.ts';

const UNITS: ReadonlyArray<{ unit: TemperatureUnit; symbol: string; name: string }> = [
  { unit: 'celsius', symbol: '°C', name: 'Celsius' },
  { unit: 'fahrenheit', symbol: '°F', name: 'Fahrenheit' },
];

/** The Mode control's track (AppearanceSection.tsx): the chosen unit a paper-coloured pill on raised. */
const trackSx: SxProps<Theme> = (theme) => ({
  bgcolor: 'cafai.raised',
  borderRadius: '14px',
  p: '4px',
  gap: '4px',
  '& .MuiToggleButtonGroup-grouped': {
    flex: '1 1 0',
    minWidth: 0,
    minHeight: 48,
    gap: '6px',
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
  // The symbol where the Mode control has its icon: the same weight as the word, a touch larger.
  '& .unit-symbol': { fontSize: '1.0625rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
});

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

export function TemperatureUnitRow() {
  const { temperatureUnit: store } = useServices();
  const unit = useTemperatureUnit();
  const helpId = useId();
  const [error, setError] = useState<string | null>(null);
  const latestSave = useRef(0);

  const save = (next: TemperatureUnit) => {
    const ticket = ++latestSave.current;
    setError(null);
    store.set(next).catch((reason: unknown) => {
      // Only the newest change speaks: one made after this that saved carried this one with it.
      if (ticket === latestSave.current) setError(`Could not save the temperature unit: ${errorText(reason)}`);
    });
  };

  return (
    <Stack spacing={1}>
      <Typography variant="label" component="div" sx={{ color: 'text.secondary' }}>
        Temperatures
      </Typography>
      <ToggleButtonGroup
        exclusive
        fullWidth
        aria-label="Temperatures"
        aria-describedby={helpId}
        value={unit}
        // A tap on the chosen unit reports null: it stays chosen.
        onChange={(_event, next: TemperatureUnit | null) => {
          if (next !== null && next !== unit) save(next);
        }}
        sx={trackSx}
      >
        {UNITS.map(({ unit: value, symbol, name }) => (
          <ToggleButton key={value} value={value} aria-label={name} data-testid={TID.temperatureUnit(value)}>
            <span className="unit-symbol" aria-hidden>
              {symbol}
            </span>
            {name}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography id={helpId} variant="body2" sx={{ color: 'text.secondary' }}>
        Readouts, settings and the coach use it. Decaid and your profiles keep °C.
      </Typography>
      {error ? (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
    </Stack>
  );
}
