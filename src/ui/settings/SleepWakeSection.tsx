/**
 * Settings > Sleep and wake (D157-D160): Decaid's idle sleep and its wake
 * times, so "warm at 06:30 on weekdays" is set without leaving CafAI. Decaid
 * keeps them and acts on them while it runs, CafAI open or not; CafAI only
 * edits them (usePresence.ts), each change at once, as the drink settings
 * above do. The words and sums are wakeSchedule.ts; the wake time's dialog
 * is WakeTimeDialog.tsx.
 *
 * Sleep when idle is a switch with the minutes under it while it is on (the
 * drink settings' stepper). The wake times are rows, earliest first: the
 * time, its days and how long it keeps the machine awake, a tap on any of
 * which opens the dialog, and the wake time's own switch at the end, as a
 * phone's alarms are laid out. Over them, when the next wake is.
 */
import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import type { WakeSchedule } from '../../api/types.ts';
import { useTelemetry } from '../../app/services.tsx';
import { TID } from '../testIds.ts';
import { DrinkField } from './DrinkFields.tsx';
import { Section } from './Section.tsx';
import { usePresence } from './usePresence.ts';
import { describeDays, describeSchedule, describeWhen, keptAwakeUntil, nextWake, SLEEP_AFTER, sortSchedules } from './wakeSchedule.ts';
import { WakeTimeDialog } from './WakeTimeDialog.tsx';

export const SLEEP_WAKE_HELP = 'Decaid sleeps and wakes the machine while it runs, with CafAI open or not. Changes go to Decaid at once.';
const READING = "Reading Decaid's sleep and wake settings…";
const SLEEP_ON = 'Using the machine, or CafAI, starts the time again.';
const SLEEP_OFF = 'The machine stays on until you put it to sleep.';
const NO_WAKES = 'No wake times yet.';
const ALL_OFF = 'Every wake time is off.';
const NEEDS_MACHINE = 'Decaid can wake the machine only while it is connected.';

const mutedSx = { color: 'text.secondary' } as const;

/** MUI's switch is 38 px tall: the label around it, which toggles it too, is the 48 px touch target. */
const switchLabelSx = { minHeight: 48, mr: 0 } as const;

/** Hairlines over, between and under the rows. */
const listSx: SxProps<Theme> = (theme) => ({ borderBottom: `1px solid ${theme.palette.divider}` });

/** The time, then its days, as one button; the switch beside it. */
const rowSx: SxProps<Theme> = (theme) => ({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  columnGap: 1,
  borderTop: `1px solid ${theme.palette.divider}`,
});

const editSx: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  columnGap: 1.5,
  justifyItems: 'start',
  textAlign: 'left',
  minHeight: 64,
  py: 1,
  pl: 0.5,
  pr: 1,
  borderRadius: '12px',
};

/** The time large, in tabular figures; an off wake time in ink-muted, never faded (DESIGN: no opacity on content). */
const timeSx = { fontSize: '1.375rem', fontWeight: 650, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' } as const;

/** The time, moved on once a minute, so the next wake stays right while Settings stays open. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

interface WakeRowProps {
  schedule: WakeSchedule;
  switching: boolean;
  onEdit(): void;
  onSwitch(enabled: boolean): void;
}

function WakeRow({ schedule, switching, onEdit, onSwitch }: WakeRowProps) {
  const days = describeDays(schedule.daysOfWeek);
  const ink = schedule.enabled ? 'text.primary' : 'text.secondary';
  return (
    <Box role="listitem" sx={rowSx} data-testid={TID.wakeRow(schedule.id)}>
      <ButtonBase onClick={onEdit} aria-label={`Change the wake time ${schedule.time}, ${days}`} data-testid={TID.wakeEdit(schedule.id)} sx={editSx}>
        <Box sx={{ minWidth: 0 }}>
          <Typography component="div" sx={{ ...timeSx, color: ink }}>
            {schedule.time}
          </Typography>
          <Typography variant="body2" component="div" sx={mutedSx}>
            {describeSchedule(schedule)}
          </Typography>
        </Box>
        <EditRoundedIcon fontSize="small" sx={mutedSx} />
      </ButtonBase>
      <Box component="label" sx={{ display: 'flex', alignItems: 'center', minHeight: 48, cursor: 'pointer' }}>
        <Switch
          checked={schedule.enabled}
          disabled={switching}
          onChange={(event) => onSwitch(event.target.checked)}
          slotProps={{ input: { 'aria-label': `Wake at ${schedule.time}, ${days}`, 'data-testid': TID.wakeSwitch(schedule.id) } }}
        />
      </Box>
    </Box>
  );
}

type Editing = { schedule: WakeSchedule | null } | null;

export function SleepWakeSection() {
  const presence = usePresence();
  const connected = useTelemetry((state) => state.machineConnected);
  const now = useMinuteClock();
  const [editing, setEditing] = useState<Editing>(null);
  const { settings } = presence;

  const schedules = settings ? sortSchedules(settings.schedules) : [];
  const next = settings ? nextWake(settings.schedules, now) : null;
  // Only while the idle sleep is on does a keep-awake window hold anything off.
  const awakeUntil = settings && presence.sleepWhenIdle ? keptAwakeUntil(settings.keepAwakeUntil, now) : null;
  const wakesLine = schedules.length === 0 ? NO_WAKES : next ? `Next wake: ${describeWhen(next.at, now)}.` : ALL_OFF;

  return (
    <Section title="Sleep and wake">
      <Stack spacing={2} data-testid={TID.sleepWake}>
        <Typography variant="body2" role="status" sx={mutedSx}>
          {settings ? SLEEP_WAKE_HELP : presence.loadError ? null : READING}
        </Typography>
        {presence.loadError ? (
          <Alert
            severity="error"
            sx={{ alignItems: 'center', '& .MuiAlert-action': { pt: 0, alignItems: 'center' } }}
            action={
              <Button color="inherit" onClick={presence.retry} sx={{ minHeight: 48 }}>
                Retry
              </Button>
            }
          >
            {presence.loadError}
          </Alert>
        ) : null}
        {settings ? (
          <>
            <Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={presence.sleepWhenIdle}
                    disabled={presence.sleepBusy}
                    onChange={(event) => presence.setSleepWhenIdle(event.target.checked)}
                    slotProps={{ input: { 'data-testid': TID.sleepWhenIdle } }}
                  />
                }
                label="Sleep when idle"
                sx={switchLabelSx}
              />
              {presence.sleepWhenIdle ? (
                <Box sx={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 184px)', justifyContent: 'space-between', alignItems: 'center', columnGap: 2, rowGap: 1, mt: 1 }}>
                  <DrinkField
                    spec={SLEEP_AFTER}
                    value={settings.sleepTimeoutMinutes}
                    loaded
                    disabled={presence.sleepBusy}
                    saving={presence.minutesSaving}
                    error={presence.minutesError}
                    layout="rows"
                    onCommit={presence.setSleepAfter}
                  />
                </Box>
              ) : null}
              <Typography variant="body2" sx={{ ...mutedSx, mt: 1 }}>
                {presence.sleepWhenIdle ? SLEEP_ON : SLEEP_OFF}
              </Typography>
              {awakeUntil ? (
                <Typography variant="body2" sx={mutedSx}>
                  A wake time keeps the machine awake until {awakeUntil}.
                </Typography>
              ) : null}
              {presence.sleepError ? (
                <Typography variant="body2" role="alert" sx={{ color: 'error.main', mt: 0.5 }}>
                  {presence.sleepError}
                </Typography>
              ) : null}
            </Box>
            <Box>
              <Typography variant="subtitle2" component="h3">
                Wake times
              </Typography>
              <Typography variant="body2" role="status" data-testid={TID.nextWake} sx={{ ...mutedSx, mb: 1 }}>
                {wakesLine}
              </Typography>
              {schedules.length > 0 ? (
                <Box role="list" aria-label="Wake times" sx={listSx}>
                  {schedules.map((schedule) => (
                    <WakeRow
                      key={schedule.id}
                      schedule={schedule}
                      switching={presence.switching.has(schedule.id)}
                      onEdit={() => setEditing({ schedule })}
                      onSwitch={(enabled) => presence.setScheduleEnabled(schedule, enabled)}
                    />
                  ))}
                </Box>
              ) : null}
              {presence.scheduleError ? (
                <Typography variant="body2" role="alert" sx={{ color: 'error.main', mt: 1 }}>
                  {presence.scheduleError}
                </Typography>
              ) : null}
              <Button startIcon={<AddRoundedIcon />} onClick={() => setEditing({ schedule: null })} data-testid={TID.wakeAdd} sx={{ minHeight: 48, mt: 1 }}>
                Add a wake time
              </Button>
              {!connected ? (
                <Typography variant="body2" sx={mutedSx}>
                  {NEEDS_MACHINE}
                </Typography>
              ) : null}
            </Box>
          </>
        ) : null}
      </Stack>
      {editing ? (
        <WakeTimeDialog
          schedule={editing.schedule}
          sleepWhenIdle={presence.sleepWhenIdle}
          onAdd={presence.addSchedule}
          onSave={presence.updateSchedule}
          onDelete={presence.deleteSchedule}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Section>
  );
}
