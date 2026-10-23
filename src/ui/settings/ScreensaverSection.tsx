/**
 * Settings > Screensaver (D-SAVER-3): whether a screensaver covers CafAI on
 * the tablet while the machine sleeps, which one, and a Preview of it. Applied
 * at once, as the temperature unit is (no Save), through the setting's store
 * (src/app/screensaverSetting.ts); its error shows as TemperatureUnitRow's.
 *
 * "A different one each day" comes first and is the default (daily.ts);
 * then every screensaver, in the registry's order. One that needs WebGL, on
 * a device where WebGL cannot start, is greyed out with a line saying so, and
 * the day's pick passes it by. Preview shows the chosen one now, full screen,
 * today's for "A different one each day"; a tap closes it, and it never
 * wakes the machine (preview.ts, SaverOverlay.tsx).
 */
import { useId, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useScreensaverSetting, useServices } from '../../app/services.tsx';
import { canRun, DAILY, resolvePick, webglStarts } from '../saver/daily.ts';
import { saverPreview, type SaverPreviewStore } from '../saver/preview.ts';
import { localDayNumber } from '../saver/random.ts';
import { SAVERS, type SaverChoice } from '../saver/registry.ts';
import { TID } from '../testIds.ts';
import { Section } from './Section.tsx';

export const SAVER_HELP =
  'Shows once the machine has been asleep and the screen untouched for a minute. A tap wakes the machine. The screen stays on, dimmed, for 30 minutes.';
export const SAVER_HERE_ONLY = 'Only on the Decent tablet: here, Preview shows it.';
const DAILY_LABEL = 'A different one each day';

const mutedSx = { color: 'text.secondary' } as const;
/** MUI's switch is 38 px tall: the label around it, which toggles it too, is the 48 px touch target. */
const switchLabelSx = { minHeight: 48, mr: 0 } as const;
/** A native select opens only from the select element itself, so it is the 48 px target. */
const selectSx = { '& .MuiInputBase-root': { minHeight: 48 }, '& .MuiNativeSelect-select': { py: '12.5px' } } as const;

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/** "Espresso Pipes", "Espresso Pipes and Latte Art": a list in words. */
function inWords(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

export interface ScreensaverSectionProps {
  /** The screensavers to offer: the registry's unless a test passes its own. */
  savers?: readonly SaverChoice[];
  /** Whether WebGL starts here: asked of the device, only when a screensaver needs it, unless a test says. */
  webgl?: boolean;
  /** The Preview store: the app's own unless a test passes one. */
  preview?: SaverPreviewStore;
}

export function ScreensaverSection({ savers = SAVERS, webgl, preview = saverPreview }: ScreensaverSectionProps) {
  const { screensaver: store, host } = useServices();
  const setting = useScreensaverSetting();
  const helpId = useId();
  const [error, setError] = useState<string | null>(null);
  const latestSave = useRef(0);

  // Starting WebGL to ask costs a weak tablet a context: only when a screensaver offered needs it.
  const webglHere = webgl ?? (savers.some((saver) => saver.context === 'webgl') ? webglStarts() : false);
  const runnable = savers.filter((saver) => canRun(saver, webglHere)).map((saver) => saver.id);
  const cannot = savers.filter((saver) => !canRun(saver, webglHere)).map((saver) => saver.label);
  // A pick this build does not know, or this device cannot run, shows as the day's.
  const shown = setting.pick !== DAILY && runnable.some((id) => id === setting.pick) ? setting.pick : DAILY;
  const today = localDayNumber(new Date());
  const todays = resolvePick(DAILY, runnable, today);
  const todaysLabel = savers.find((saver) => saver.id === todays)?.label ?? '';

  const save = (next: { on: boolean; pick: string }) => {
    const ticket = ++latestSave.current;
    setError(null);
    store.set(next).catch((reason: unknown) => {
      // Only the newest change speaks: one made after this that saved carried this one with it.
      if (ticket === latestSave.current) setError(`Could not save the screensaver: ${errorText(reason)}`);
    });
  };

  const showPreview = () => preview.show(resolvePick(shown, runnable, today), { seed: today });

  return (
    <Section title="Screensaver">
      <Stack spacing={1.5} data-testid={TID.saverSection}>
        <Box>
          <FormControlLabel
            control={
              <Switch
                checked={setting.on}
                onChange={(event) => save({ on: event.target.checked, pick: setting.pick })}
                slotProps={{ input: { 'data-testid': TID.saverOn } }}
              />
            }
            label="Screensaver"
            sx={switchLabelSx}
          />
        </Box>
        <TextField
          select
          size="small"
          label="Which"
          value={shown}
          onChange={(event) => {
            const next = event.target.value;
            if (next !== shown) save({ on: setting.on, pick: next });
          }}
          helperText={shown === DAILY && todaysLabel ? `Today: ${todaysLabel}` : ' '}
          sx={selectSx}
          slotProps={{
            select: { native: true },
            htmlInput: { 'data-testid': TID.saverPick, 'aria-describedby': helpId },
            inputLabel: { shrink: true },
          }}
        >
          <option value={DAILY}>{DAILY_LABEL}</option>
          {savers.map((saver) => (
            <option key={saver.id} value={saver.id} disabled={!canRun(saver, webglHere)}>
              {saver.label}
            </option>
          ))}
        </TextField>
        <Typography id={helpId} variant="body2" sx={mutedSx}>
          {host.insideDecaid ? SAVER_HELP : `${SAVER_HELP} ${SAVER_HERE_ONLY}`}
        </Typography>
        {cannot.length > 0 ? (
          <Typography variant="body2" sx={mutedSx}>
            {`${inWords(cannot)} ${cannot.length === 1 ? 'needs' : 'need'} WebGL, which can't start on this device.`}
          </Typography>
        ) : null}
        <Box>
          <Button variant="outlined" onClick={showPreview} data-testid={TID.saverPreview} sx={{ minHeight: 48 }}>
            Preview
          </Button>
        </Box>
        {error ? (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
      </Stack>
    </Section>
  );
}
