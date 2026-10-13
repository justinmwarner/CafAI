/**
 * The drink's own settings on its view (D147): the steppers of Settings >
 * Steam, hot water and flush for this one drink (DrinkFields.tsx), read and
 * written as they are there (useDrinkPresets.ts). Held while anything runs,
 * as everywhere (D114: the machine is using them; the owner kept that rule
 * for the views, 2026-10-13), and live the moment the run ends, so a steam
 * that was too short is one tap from a longer one. The line under the title
 * says which, in a box that keeps its height, so the steppers never move
 * when the run ends.
 */
import { useId } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { DrinkFieldsGrid, drinksFor, PRESET_KEY } from '../settings/DrinkFields.tsx';
import type { DrinkPresetsState } from '../settings/useDrinkPresets.ts';
import { TID } from '../testIds.ts';
import type { DrinkKind } from './kinds.ts';

const WORDS = {
  running: 'Change these once it stops: the machine is using them now.',
  notConnected: 'Connect the DE1 to change these.',
  reading: "Reading Decaid's drink settings…",
  ready: 'Changes go to Decaid at once.',
} as const;

export interface DrinkSettingsCardProps {
  kind: DrinkKind;
  drinks: DrinkPresetsState;
  /** One row per setting (a phone), or side by side, each label over its stepper (a tablet). */
  layout: 'rows' | 'columns';
}

export function DrinkSettingsCard({ kind, drinks, layout }: DrinkSettingsCardProps) {
  const headingId = useId();
  const drink = drinksFor(drinks.model).find((d) => d.key === PRESET_KEY[kind])!;
  const rows = layout === 'rows';
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-labelledby={headingId}
      data-testid={TID.drinkSettingsCard}
      sx={{ p: rows ? '10px 14px 12px' : '12px 16px 14px', bgcolor: 'background.paper' }}
    >
      <Box sx={{ display: rows ? 'block' : 'flex', alignItems: 'baseline', columnGap: 1.25, mb: 1.25 }}>
        <Typography id={headingId} variant="subtitle2" component="h3" sx={{ flex: 'none' }}>
          {drink.name} settings
        </Typography>
        {/* Two lines kept on a narrow card, one on a wide one: the steppers never move as the words change. */}
        <Typography variant="body2" role="status" color="text.secondary" sx={{ minHeight: rows ? '3em' : '1.5em' }}>
          {WORDS[drinks.reason ?? 'ready']}
        </Typography>
      </Box>
      {drinks.loadError ? (
        <Alert
          severity="error"
          sx={{ mb: 1.25, alignItems: 'center', '& .MuiAlert-action': { pt: 0, alignItems: 'center' } }}
          action={
            <Button color="inherit" onClick={drinks.retry} sx={{ minHeight: 48 }}>
              Retry
            </Button>
          }
        >
          {drinks.loadError}
        </Alert>
      ) : null}
      <DrinkFieldsGrid
        drink={drink}
        data={drinks.presets?.[drink.key] ?? null}
        loaded={drinks.loaded}
        disabled={drinks.disabled}
        pending={drinks.pending}
        failed={drinks.failed}
        onCommit={drinks.commit}
        layout={layout}
      />
    </Paper>
  );
}
