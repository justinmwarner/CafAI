/**
 * Settings > Drinks (D233, D235): Steam, Hot water and Flush, one card each
 * (DrinkCard.tsx), holding what the machine runs the drink with and then
 * what its screen shows. Decaid's three presets are read once here for the
 * three cards (useDrinkPresets.ts), and one line over them says what the
 * cards are for, or why the machine's settings are held now (no machine,
 * the machine running, Decaid not read yet), in one place that keeps its
 * height, so nothing moves when the machine starts; the screens' settings
 * are never held, so they read as apart. A read that failed says why, with
 * Retry.
 *
 * The cards sit three across from 840 px of the pane's width, and stack
 * under it (groupLayout.tsx).
 */
import { useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { DrinkScreen } from '../../../storage/types.ts';
import type { DrinkKind } from '../../drinks/kinds.ts';
import { useDrinkScreenChoices, useDrinkScreensStore } from '../../drinks/useDrinkScreens.ts';
import { TID } from '../../testIds.ts';
import { DrinkCard } from '../DrinkCard.tsx';
import { drinksFor, PRESET_KEY } from '../DrinkFields.tsx';
import { COLUMN_MAX, useGroupWide } from '../groupLayout.tsx';
import { useDrinkPresets, type DrinkSettingsReason } from '../useDrinkPresets.ts';

export const DRINKS_HELP = 'Changes go to Decaid at once. On screen is kept on this device.';
/** The same without the screens' store (a preview), where the cards have no On screen. */
const DRINKS_HELP_MACHINE_ONLY = 'Changes go to Decaid at once.';
const NOT_WHILE_RUNNING = 'Not while the machine is running.';
const NOT_CONNECTED = 'Connect the DE1 to change these.';
const READING = "Reading Decaid's drink settings…";

/** In the machine row's order of the drinks' names: Steam, Hot water, Flush. */
const ORDER: readonly DrinkKind[] = ['steam', 'hotWater', 'flush'];

const mutedSx = { color: 'text.secondary' } as const;

/** One line on a tablet, two on a phone: held, so a reason replacing the help moves nothing under it. */
const lineSx = { minHeight: { xs: 45, sm: 23 } } as const;

/** What the line says for each reason the machine's settings are held. */
const REASON_WORDS: Record<NonNullable<DrinkSettingsReason>, string> = {
  notConnected: NOT_CONNECTED,
  running: NOT_WHILE_RUNNING,
  reading: READING,
};

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

export function DrinksGroup() {
  const drinks = useDrinkPresets();
  const store = useDrinkScreensStore();
  const choices = useDrinkScreenChoices();
  const wide = useGroupWide();
  // Each drink's last screen change that did not save, in its own card, until a later change of that drink saves.
  const [screenErrors, setScreenErrors] = useState<Partial<Record<DrinkKind, string>>>({});
  const latestSave = useRef<Partial<Record<DrinkKind, number>>>({});
  const reason = drinks.reason === null ? null : REASON_WORDS[drinks.reason];
  const machine = drinksFor(drinks.model);

  /**
   * The store shows the change at once and saves it, with any of the drink's
   * that did not save before; a failure says so in its card until a later
   * change of the same drink saves. Another drink's save clears nothing.
   */
  const saveScreen = (kind: DrinkKind, change: Partial<DrinkScreen>) => {
    if (!store) return;
    const ticket = (latestSave.current[kind] ?? 0) + 1;
    latestSave.current[kind] = ticket;
    store.set(kind, change).then(
      () => {
        // An older change that saved clears nothing: a newer one may have failed.
        if (ticket !== latestSave.current[kind]) return;
        setScreenErrors((errors) => {
          const next = { ...errors };
          delete next[kind];
          return next;
        });
      },
      (error: unknown) => setScreenErrors((errors) => ({ ...errors, [kind]: `Could not save the drink screens: ${errorText(error)}` })),
    );
  };

  return (
    <Stack spacing={2} data-testid={TID.drinkSettings}>
      <Box sx={lineSx}>
        <Typography variant="body2" role="status" sx={mutedSx}>
          {reason}
        </Typography>
        {reason === null ? (
          <Typography variant="body2" sx={mutedSx}>
            {store ? DRINKS_HELP : DRINKS_HELP_MACHINE_ONLY}
          </Typography>
        ) : null}
      </Box>
      {drinks.loadError ? (
        <Alert
          severity="error"
          sx={{ alignItems: 'center', '& .MuiAlert-action': { pt: 0, alignItems: 'center' } }}
          action={
            <Button color="inherit" onClick={drinks.retry} sx={{ minHeight: 48 }}>
              Retry
            </Button>
          }
        >
          {drinks.loadError}
        </Alert>
      ) : null}
      <Box
        data-testid={TID.drinkScreens}
        sx={
          wide
            ? { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 2, alignItems: 'start' }
            : { display: 'grid', gap: 2, maxWidth: COLUMN_MAX }
        }
      >
        {ORDER.map((kind) => (
          <DrinkCard
            key={kind}
            kind={kind}
            drink={machine.find((drink) => drink.key === PRESET_KEY[kind])!}
            presets={drinks}
            screen={store ? choices[kind] : null}
            screenError={screenErrors[kind] ?? null}
            onScreenChange={(change) => saveScreen(kind, change)}
            stacked={wide}
          />
        ))}
      </Box>
    </Stack>
  );
}
