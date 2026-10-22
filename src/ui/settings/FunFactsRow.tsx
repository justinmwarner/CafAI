/**
 * Settings > Coach > Fun facts (D198): where the fact on a dialed-in shot
 * comes from (D197). Drawn as the model above it: a native select with what
 * the chosen one does under it. It is saved with the rest of the Coach
 * section (SettingsScreen.tsx), which writes no choice while none was made on
 * this device, so a restore can still fill it, as it does the temperature
 * unit (D171).
 */
import TextField from '@mui/material/TextField';
import { isFunFactsSource, type FunFactsSource } from '../../coach/facts/types.ts';
import { TID } from '../testIds.ts';
import { FUN_FACTS_CHOICES, funFactsLine } from './funFactsWords.ts';

const fieldSx = { '& .MuiInputBase-root': { minHeight: 48 } } as const;
/** A native select opens only from the select element itself, so it is the 48 px target. */
const selectSx = { ...fieldSx, '& .MuiNativeSelect-select': { py: '12.5px' } } as const;

export interface FunFactsRowProps {
  /** The choice to show (DEFAULT_FUN_FACTS while none was made); null while the settings are read. */
  value: FunFactsSource | null;
  /** The coach runs through the CafAI Bridge: the web search's line says what it does there. */
  onComputer: boolean;
  /** Held while the section saves. */
  disabled?: boolean;
  onChange(next: FunFactsSource): void;
}

export function FunFactsRow({ value, onComputer, disabled = false, onChange }: FunFactsRowProps) {
  return (
    <TextField
      select
      size="small"
      label="Fun facts"
      value={value ?? ''}
      disabled={disabled || value === null}
      onChange={(event) => {
        if (isFunFactsSource(event.target.value)) onChange(event.target.value);
      }}
      helperText={value === null ? ' ' : funFactsLine(value, onComputer)}
      sx={selectSx}
      slotProps={{
        select: { native: true },
        htmlInput: { 'data-testid': TID.funFacts },
        inputLabel: { shrink: true },
      }}
    >
      {value === null ? (
        <option value="">Loading…</option>
      ) : (
        FUN_FACTS_CHOICES.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))
      )}
    </TextField>
  );
}
