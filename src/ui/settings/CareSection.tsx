/**
 * Settings > Machine care (D152, D187): the way into the cleaning guide
 * (#/care), and what sets its reminders, each applied at once as the look
 * is: **Your water** (Decent's bands of total dissolved solids, which set the
 * descale), **Intake filter** (V1 or V2, which sets its cleaning) and
 * **Remind me on the stats card** (the line when a step is due, D188).
 * The fields show once the care service has read them; without one (fakes,
 * previews) the section is the guide's way in alone.
 */
import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CleaningServicesRoundedIcon from '@mui/icons-material/CleaningServicesRounded';
import type { CareService } from '../../app/care/careService.ts';
import type { CareSettings } from '../../storage/types.ts';
import { revealInOwnColumn, takeReveal } from '../care/careReveal.ts';
import { FILTER_CHOICES, FILTER_HELP, REMINDERS_HELP, REMINDERS_LABEL, WATER_CHOICES, WATER_HELP } from '../care/careWords.ts';
import { useCareState } from '../care/useCare.ts';
import { routeHref } from '../router.ts';
import { TID } from '../testIds.ts';
import { useServices } from '../../app/services.tsx';
import { Section } from './Section.tsx';

export const CARE_LINE = "What to clean every day, week and month, with Decent's video.";
const COULD_NOT_SAVE = 'Could not save that. Try again.';

const fieldSx = { '& .MuiInputBase-root': { minHeight: 48 } } as const;
/** A native select opens only from the select element itself, so it is the 48 px target. */
const selectSx = { ...fieldSx, '& .MuiNativeSelect-select': { py: '12.5px' } } as const;
/** MUI's switch is 38 px tall: the label around it, which toggles it too, is the 48 px touch target. */
const switchLabelSx = { minHeight: 48, mr: 0 } as const;

function CareFields({ care, settings }: { care: CareService; settings: CareSettings }) {
  const [failed, setFailed] = useState(false);
  const change = (patch: Partial<CareSettings>) => {
    setFailed(false);
    care.setSettings(patch).catch(() => setFailed(true));
  };
  return (
    <Stack spacing={2} sx={{ mt: 2.5 }}>
      <TextField
        select
        size="small"
        label="Your water"
        value={settings.water ?? ''}
        onChange={(event) => change({ water: (event.target.value || null) as CareSettings['water'] })}
        helperText={WATER_HELP}
        sx={selectSx}
        slotProps={{ select: { native: true }, htmlInput: { 'data-testid': TID.careWater }, inputLabel: { shrink: true } }}
      >
        {WATER_CHOICES.map((choice) => (
          <option key={choice.value ?? 'unsure'} value={choice.value ?? ''}>
            {choice.label}
          </option>
        ))}
      </TextField>
      <TextField
        select
        size="small"
        label="Intake filter"
        value={settings.filter ?? ''}
        onChange={(event) => change({ filter: (event.target.value || null) as CareSettings['filter'] })}
        helperText={FILTER_HELP}
        sx={selectSx}
        slotProps={{ select: { native: true }, htmlInput: { 'data-testid': TID.careFilter }, inputLabel: { shrink: true } }}
      >
        {FILTER_CHOICES.map((choice) => (
          <option key={choice.value ?? 'unsure'} value={choice.value ?? ''}>
            {choice.label}
          </option>
        ))}
      </TextField>
      <Box>
        <FormControlLabel
          control={
            <Switch
              checked={settings.reminders}
              onChange={(event) => change({ reminders: event.target.checked })}
              slotProps={{ input: { 'data-testid': TID.careReminders } }}
            />
          }
          label={REMINDERS_LABEL}
          sx={switchLabelSx}
        />
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {REMINDERS_HELP}
        </Typography>
      </Box>
      {failed ? (
        <Typography variant="body2" role="alert" sx={{ color: 'error.main' }}>
          {COULD_NOT_SAVE}
        </Typography>
      ) : null}
    </Stack>
  );
}

export function CareSection() {
  const { care } = useServices();
  const state = useCareState();
  const box = useRef<HTMLDivElement>(null);

  // The Care screen's "Set it in Settings" opened this: bring the section into view.
  useEffect(() => {
    const element = box.current;
    if (element && takeReveal('settings-care')) revealInOwnColumn(element.closest('section') ?? element);
  }, []);

  return (
    <Section title="Machine care">
      <Box ref={box} data-testid={TID.careSection}>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
          {CARE_LINE}
        </Typography>
        <Button
          variant="tonal"
          href={routeHref({ name: 'care', routine: 'daily' })}
          startIcon={<CleaningServicesRoundedIcon />}
          data-testid={TID.careOpen}
          sx={{ minHeight: 48 }}
        >
          Cleaning guide
        </Button>
        {care && state?.ready ? <CareFields care={care} settings={state.settings} /> : null}
      </Box>
    </Section>
  );
}
