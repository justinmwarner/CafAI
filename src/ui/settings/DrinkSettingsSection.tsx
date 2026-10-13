/**
 * Settings > Steam, hot water and flush (6.6): the three drink presets
 * Decaid keeps on the workflow, the ones the machine row's Steam, Hot water
 * and Flush run with, clamped by drinkSettings.ts. Their steppers are
 * DrinkFields.tsx and their reads and writes useDrinkPresets.ts, both shared
 * with each drink's view (D147).
 *
 * Laid out as the machine row draws the drinks (D124): a group for each under
 * its name and the row's icon, side by side on a tablet and stacked on a
 * phone, where each setting is one row with its stepper at the end. The line
 * under the title says what the section is for, or why it cannot be changed
 * now (no machine, the machine running, Decaid not read yet), in one place
 * that keeps its height, so nothing moves when the machine starts. A read
 * that failed says why, with Retry.
 */
import { useId } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { TID } from '../testIds.ts';
import { DrinkFieldsGrid, drinksFor, type DrinkFieldsGridProps } from './DrinkFields.tsx';
import { Section } from './Section.tsx';
import { useDrinkPresets, type DrinkSettingsReason } from './useDrinkPresets.ts';

const HELP = 'The Steam, Hot water and Flush buttons use these. Changes go to Decaid at once.';
const NOT_WHILE_RUNNING = 'Not while the machine is running.';
const NOT_CONNECTED = 'Connect the DE1 to change these.';
const READING = "Reading Decaid's drink settings…";

const mutedSx = { color: 'text.secondary' } as const;

/** One drink: the machine row's icon and its name, then its settings. A group, named by its heading. */
function DrinkGroup(props: DrinkFieldsGridProps) {
  const headingId = useId();
  return (
    <Box role="group" aria-labelledby={headingId}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, color: 'text.secondary' }}>
        {props.drink.icon}
        <Typography id={headingId} variant="subtitle2" component="h3" sx={{ color: 'text.primary' }}>
          {props.drink.name}
        </Typography>
      </Box>
      <DrinkFieldsGrid {...props} />
    </Box>
  );
}

/** Three drinks side by side from 600 px (a tablet, a phone on its side), stacked under that. */
const groupsSx = {
  display: 'grid',
  gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' },
  gap: 3,
} as const;

/** One line on a tablet, two on a phone: held, so a reason replacing the help moves nothing under it. */
const lineSx = { minHeight: { xs: 45, sm: 23 } } as const;

/** What the line under the title says for each reason the fields are held. */
const REASON_WORDS: Record<NonNullable<DrinkSettingsReason>, string> = {
  notConnected: NOT_CONNECTED,
  running: NOT_WHILE_RUNNING,
  reading: READING,
};

export function DrinkSettingsSection() {
  const drinks = useDrinkPresets();
  const reason = drinks.reason === null ? null : REASON_WORDS[drinks.reason];
  return (
    <Section title="Steam, hot water and flush">
      <Stack spacing={2} data-testid={TID.drinkSettings}>
        <Box sx={lineSx}>
          <Typography variant="body2" role="status" sx={mutedSx}>
            {reason}
          </Typography>
          {reason === null ? (
            <Typography variant="body2" sx={mutedSx}>
              {HELP}
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
        <Box sx={groupsSx}>
          {drinksFor(drinks.model).map((drink) => (
            <DrinkGroup
              key={drink.key}
              drink={drink}
              data={drinks.presets?.[drink.key] ?? null}
              loaded={drinks.loaded}
              disabled={drinks.disabled}
              pending={drinks.pending}
              failed={drinks.failed}
              onCommit={drinks.commit}
            />
          ))}
        </Box>
      </Stack>
    </Section>
  );
}
