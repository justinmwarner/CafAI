/**
 * Settings > Screensaver (D225): whether a screensaver covers CafAI on
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
 *
 * Then how long it waits and how far it dims (D247): Starts after (1, 2, 5,
 * 10 or 15 minutes; a minute until chosen, D223) and Dims the screen to (10
 * to 60 %; 30 until chosen, D224), both kept in the screensaver setting; the
 * line under them says the minutes chosen.
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
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { useScreensaverSetting, useServices } from '../../app/services.tsx';
import { SAVER_DIM_TO, SAVER_START_AFTER_MINUTES } from '../../storage/settings.ts';
import type { ScreensaverSetting } from '../../storage/types.ts';
import { canRun, DAILY, resolvePick, webglStarts } from '../saver/daily.ts';
import { saverBrightness, saverIdleMs } from '../saver/policy.ts';
import { saverPreview, type SaverPreviewStore } from '../saver/preview.ts';
import { localDayNumber } from '../saver/random.ts';
import { SAVERS, type SaverChoice } from '../saver/registry.ts';
import { TID } from '../testIds.ts';
import { Section } from './Section.tsx';

/** The line under the choices, saying the wait chosen: "…untouched for a minute." or "…for 5 minutes." */
export function saverHelp(minutes: number): string {
  const wait = minutes === 1 ? 'a minute' : `${minutes} minutes`;
  return `Shows once the machine has been asleep and the screen untouched for ${wait}. A tap wakes the machine. The screen stays on, dimmed, for 30 minutes.`;
}

/** The line while nothing was chosen: a minute (D223). */
export const SAVER_HELP = saverHelp(1);
export const SAVER_HERE_ONLY = 'Only on the Decent tablet: here, Preview shows it.';
const DAILY_LABEL = 'A different one each day';

/** The wait's and the brightness's test ids (D247); the coordinator moves them into testIds.ts. */
export const SAVER_TIMING_TID = { startAfter: 'saver-start-after', dimTo: 'saver-dim-to' } as const;

/** Every brightness on offer: 10 % to 60 % in tens (SAVER_DIM_TO). */
const DIM_LEVELS = Array.from({ length: (SAVER_DIM_TO.max - SAVER_DIM_TO.min) / SAVER_DIM_TO.step + 1 }, (_, index) => SAVER_DIM_TO.min + index * SAVER_DIM_TO.step);

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
  // The wait and the brightness as the policy acts on them: a minute and 30 until chosen.
  const minutes = saverIdleMs(setting) / 60_000;
  const help = saverHelp(minutes);

  /** A change names only what it changes; the store keeps the rest. */
  const save = (change: Partial<ScreensaverSetting>) => {
    const ticket = ++latestSave.current;
    setError(null);
    store.set(change).catch((reason: unknown) => {
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
                onChange={(event) => save({ on: event.target.checked })}
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
            if (next !== shown) save({ pick: next });
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
        <TextField
          select
          size="small"
          label="Starts after"
          value={String(minutes)}
          onChange={(event) => save({ startAfterMinutes: Number(event.target.value) })}
          sx={selectSx}
          slotProps={{
            select: { native: true },
            htmlInput: { 'data-testid': SAVER_TIMING_TID.startAfter, 'aria-describedby': helpId },
            inputLabel: { shrink: true },
          }}
        >
          {SAVER_START_AFTER_MINUTES.map((value) => (
            <option key={value} value={String(value)}>
              {value === 1 ? '1 minute' : `${value} minutes`}
            </option>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Dims the screen to"
          value={String(saverBrightness(setting))}
          onChange={(event) => save({ dimTo: Number(event.target.value) })}
          sx={selectSx}
          slotProps={{
            select: { native: true },
            htmlInput: { 'data-testid': SAVER_TIMING_TID.dimTo },
            inputLabel: { shrink: true },
          }}
        >
          {DIM_LEVELS.map((value) => (
            <option key={value} value={String(value)}>
              {`${value} %`}
            </option>
          ))}
        </TextField>
        <Typography id={helpId} variant="body2" sx={mutedSx}>
          {host.insideDecaid ? help : `${help} ${SAVER_HERE_ONLY}`}
        </Typography>
        {cannot.length > 0 ? (
          <Typography variant="body2" sx={mutedSx}>
            {`${inWords(cannot)} ${cannot.length === 1 ? 'needs' : 'need'} WebGL, which can't start on this device.`}
          </Typography>
        ) : null}
        <Box>
          <Button variant="tonal" startIcon={<PlayArrowRoundedIcon />} onClick={showPreview} data-testid={TID.saverPreview} sx={{ minHeight: 48 }}>
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
