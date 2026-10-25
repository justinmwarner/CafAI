/**
 * Add a wake time, or change one, for Settings > Sleep and wake (D157-D160):
 * the time, the days and how long the machine stays awake after. Decaid gets
 * it when Add or Save is tapped (usePresence.ts); a change sends only what
 * changed. Mounted only while open, so each opening starts from the wake time
 * it is for, or from a new one's 06:00, every day, awake for an hour.
 *
 * The time is taken in the clock the barista chose (D245): the hour 00-23 on
 * the 24-hour clock; on the 12-hour one the hour 12, 1-11 and am or pm.
 * Either way Decaid gets "HH:MM".
 */
import { useId, useState, type FormEvent } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import type { WakeSchedule, WakeSchedulePatch, WakeScheduleRequest } from '../../api/types.ts';
import { fromTwelveHour, toTwelveHour, type ClockFormat, type ClockHalf } from '../clock.ts';
import { TID } from '../testIds.ts';
import {
  daysPicked,
  daysToStore,
  describeDays,
  describeKeepAwake,
  KEEP_AWAKE_CHOICES,
  NEW_KEEP_AWAKE,
  NEW_WAKE_TIME,
  WEEKDAYS,
} from './wakeSchedule.ts';

const fieldSx = { '& .MuiInputBase-root': { minHeight: 48 } } as const;
/** A native select opens only from the select element itself, so it is the 48 px target. */
const selectSx = { ...fieldSx, '& .MuiNativeSelect-select': { py: '12.5px' } } as const;
const mutedSx = { color: 'text.secondary' } as const;

/** The time's figures as the rows draw them: 22 px at 650, tabular. */
const figuresSx = { fontSize: '1.375rem', fontWeight: 650, fontVariantNumeric: 'tabular-nums' } as const;
/** The hour and the minute in those figures; 8.5 px over and under a 22 px line makes each select 48 px tall. */
const timeSelectSx = { ...fieldSx, minWidth: 88, '& .MuiNativeSelect-select': { ...figuresSx, py: '8.5px' } } as const;

const pad = (value: number) => String(value).padStart(2, '0');
/**
 * The hour and the minute as two selects, not the browser's time field: that
 * one shows the device's own clock ("06:00 AM" in US English), whatever the
 * clock chosen in CafAI (D245). Every minute, as Decaid takes any. On the
 * 12-hour clock the hours run as a clock face does, 12 first.
 */
const HOURS = Array.from({ length: 24 }, (_, hour) => pad(hour));
const TWELVE_HOURS = Array.from({ length: 12 }, (_, index) => String(index === 0 ? 12 : index));
const MINUTES = Array.from({ length: 60 }, (_, minute) => pad(minute));

const HALVES: readonly ClockHalf[] = ['am', 'pm'];

/** The am and pm choices' test ids (D245), as kept with the rest in TID (src/ui/testIds.ts). */
export const WAKE_DIALOG_HALF_TID: Readonly<Record<ClockHalf, string>> = { am: TID.wakeDialogHalf('am'), pm: TID.wakeDialogHalf('pm') };

/**
 * The days as the Appearance mode control draws its choices: on the raised
 * track, each day picked a paper-coloured pill. Seven share the track's
 * width, 48 px tall; on a phone upright the padding and gaps are 2 px, so
 * each is still 44 px wide on a 390 px screen.
 */
const daysSx: SxProps<Theme> = (theme) => ({
  bgcolor: 'cafai.raised',
  borderRadius: '14px',
  p: { xs: '2px', sm: '3px' },
  gap: { xs: '2px', sm: '3px' },
  '& .MuiToggleButtonGroup-grouped': {
    flex: '1 1 0',
    minWidth: 0,
    minHeight: 48,
    px: 0,
    m: 0,
    border: 0,
    // The track's radius less its padding, so the corners stay concentric.
    borderRadius: { xs: '12px', sm: '11px' },
    color: 'text.secondary',
    fontSize: '0.9375rem',
    transition: theme.transitions.create(['background-color', 'color', 'box-shadow'], {
      duration: theme.transitions.duration.shorter,
    }),
    '&.Mui-selected, &.Mui-selected:hover': {
      bgcolor: 'background.paper',
      color: 'text.primary',
      fontWeight: 650,
      boxShadow: `0 1px 2px rgba(0, 0, 0, ${theme.palette.mode === 'dark' ? 0.35 : 0.14})`,
    },
  },
});

/** am and pm as the days are drawn, on the raised track, after the minute; each a 48 px target. */
const halfSx: SxProps<Theme> = (theme) => ({
  bgcolor: 'cafai.raised',
  borderRadius: '14px',
  p: '3px',
  gap: '3px',
  '& .MuiToggleButtonGroup-grouped': {
    minWidth: 52,
    minHeight: 48,
    px: 1.5,
    m: 0,
    border: 0,
    borderRadius: '11px',
    color: 'text.secondary',
    fontSize: '0.9375rem',
    transition: theme.transitions.create(['background-color', 'color', 'box-shadow'], {
      duration: theme.transitions.duration.shorter,
    }),
    '&.Mui-selected, &.Mui-selected:hover': {
      bgcolor: 'background.paper',
      color: 'text.primary',
      fontWeight: 650,
      boxShadow: `0 1px 2px rgba(0, 0, 0, ${theme.palette.mode === 'dark' ? 0.35 : 0.14})`,
    },
  },
});

export interface WakeTimeDialogProps {
  /** The wake time to change, or null to add one. */
  schedule: WakeSchedule | null;
  /** The clock the time is shown and taken in (D245); Decaid gets "HH:MM" either way. */
  clock: ClockFormat;
  /** Sleep when idle is on: only then does staying awake after the wake change anything. */
  sleepWhenIdle: boolean;
  onAdd(request: WakeScheduleRequest): Promise<void>;
  onSave(id: string, patch: WakeSchedulePatch): Promise<void>;
  onDelete(id: string): Promise<void>;
  onClose(): void;
}

type Busy = 'saving' | 'deleting' | null;

export function WakeTimeDialog({ schedule, clock, sleepWhenIdle, onAdd, onSave, onDelete, onClose }: WakeTimeDialogProps) {
  // "HH:MM", as CafAI reads every wake time (readers.ts): the hour kept on the 24-hour day whatever the clock shows.
  const [hour, setHour] = useState(() => (schedule?.time ?? NEW_WAKE_TIME).slice(0, 2));
  const [minute, setMinute] = useState(() => (schedule?.time ?? NEW_WAKE_TIME).slice(3, 5));
  const [days, setDays] = useState<number[]>(() => daysPicked(schedule?.daysOfWeek ?? []));
  const [keepAwake, setKeepAwake] = useState<number | null>(schedule ? (schedule.keepAwakeFor ?? null) : NEW_KEEP_AWAKE);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const timeLabelId = useId();
  const daysLabelId = useId();

  const picked = `${hour}:${minute}`;
  // The hour as the 12-hour clock says it, and its half.
  const said = toTwelveHour(Number(hour));
  const setSaid = (next: { hour: number; half: ClockHalf }) => {
    setHour(pad(fromTwelveHour(next.hour, next.half)));
    setError(null);
  };
  const noDays = days.length === 0;
  // A wake time Decaid holds outside the choices (set on its own page) is offered as it is.
  const choices = keepAwake === null || KEEP_AWAKE_CHOICES.includes(keepAwake) ? KEEP_AWAKE_CHOICES : [...KEEP_AWAKE_CHOICES, keepAwake];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // React carries the submit up through the portal to any form around the section.
    event.stopPropagation();
    if (busy !== null || noDays) return;
    const daysOfWeek = daysToStore(days);
    setBusy('saving');
    setError(null);
    try {
      if (schedule === null) {
        // No keep-awake window: the key left out, as Decaid's own toJson does.
        await onAdd({ time: picked, daysOfWeek, enabled: true, ...(keepAwake === null ? {} : { keepAwakeFor: keepAwake }) });
      } else {
        const patch: WakeSchedulePatch = {};
        if (picked !== schedule.time) patch.time = picked;
        if (daysOfWeek.join() !== daysToStore(schedule.daysOfWeek).join()) patch.daysOfWeek = daysOfWeek;
        if (keepAwake !== (schedule.keepAwakeFor ?? null)) patch.keepAwakeFor = keepAwake;
        if (Object.keys(patch).length > 0) await onSave(schedule.id, patch);
      }
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(null);
    }
  };

  const remove = async () => {
    if (schedule === null || busy !== null) return;
    setBusy('deleting');
    setError(null);
    try {
      await onDelete(schedule.id);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(null);
    }
  };

  const disabled = busy !== null;
  return (
    <Dialog
      open
      onClose={() => {
        // A change on its way to Decaid finishes first: closing would hide whether it got there.
        if (!disabled) onClose();
      }}
      fullWidth
      maxWidth="sm"
      scroll="paper"
      data-testid={TID.wakeDialog}
      // 16 px from a phone's edges rather than 32, so the seven days keep about 44 px each.
      sx={{ '& .MuiDialog-paper': { mx: { xs: 2, sm: 4 }, width: { xs: 'calc(100% - 32px)', sm: 'calc(100% - 64px)' } } }}
      slotProps={{ paper: { component: 'form', onSubmit: (event: FormEvent) => void submit(event) } }}
    >
      <DialogTitle>{schedule === null ? 'Add a wake time' : 'Change the wake time'}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2.5, alignContent: 'start', px: { xs: 2, sm: 3 } }}>
        <Box sx={{ display: 'grid', gap: 1 }}>
          <Typography variant="label" component="div" id={timeLabelId} sx={mutedSx}>
            Time
          </Typography>
          <Box role="group" aria-labelledby={timeLabelId} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
            <TextField
              select
              size="small"
              value={clock === '12h' ? String(said.hour) : hour}
              disabled={disabled}
              onChange={(event) => {
                if (clock === '12h') {
                  setSaid({ hour: Number(event.target.value), half: said.half });
                  return;
                }
                setHour(event.target.value);
                setError(null);
              }}
              sx={timeSelectSx}
              slotProps={{ select: { native: true }, htmlInput: { 'aria-label': 'Hour', 'data-testid': TID.wakeDialogHour } }}
            >
              {(clock === '12h' ? TWELVE_HOURS : HOURS).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </TextField>
            <Typography component="span" aria-hidden sx={figuresSx}>
              :
            </Typography>
            <TextField
              select
              size="small"
              value={minute}
              disabled={disabled}
              onChange={(event) => {
                setMinute(event.target.value);
                setError(null);
              }}
              sx={timeSelectSx}
              slotProps={{ select: { native: true }, htmlInput: { 'aria-label': 'Minute', 'data-testid': TID.wakeDialogMinute } }}
            >
              {MINUTES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </TextField>
            {clock === '12h' ? (
              <ToggleButtonGroup
                exclusive
                value={said.half}
                aria-label="am or pm"
                disabled={disabled}
                // A tap on the half already chosen reports null: it stays chosen.
                onChange={(_event, half: ClockHalf | null) => {
                  if (half !== null) setSaid({ hour: said.hour, half });
                }}
                sx={halfSx}
              >
                {HALVES.map((half) => (
                  <ToggleButton key={half} value={half} data-testid={WAKE_DIALOG_HALF_TID[half]}>
                    {half}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            ) : null}
          </Box>
          <Typography variant="body2" sx={mutedSx}>
            The machine takes a while to heat, so set it a little before you want coffee.
          </Typography>
        </Box>
        <Box sx={{ display: 'grid', gap: 1 }}>
          <Typography variant="label" component="div" id={daysLabelId} sx={mutedSx}>
            Days
          </Typography>
          <ToggleButtonGroup
            value={days}
            aria-labelledby={daysLabelId}
            onChange={(_event, next: number[]) => {
              setDays(next);
              setError(null);
            }}
            disabled={disabled}
            fullWidth
            sx={daysSx}
          >
            {WEEKDAYS.map(({ day, short, name }) => (
              <ToggleButton key={day} value={day} aria-label={name} data-testid={TID.wakeDialogDay(short)}>
                {short}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography variant="body2" role={noDays ? 'alert' : undefined} sx={{ color: noDays ? 'error.main' : 'text.secondary' }}>
            {noDays ? 'Pick at least one day.' : describeDays(daysToStore(days))}
          </Typography>
        </Box>
        <TextField
          select
          size="small"
          label="After waking"
          value={keepAwake === null ? '' : String(keepAwake)}
          disabled={disabled}
          onChange={(event) => setKeepAwake(event.target.value === '' ? null : Number(event.target.value))}
          helperText={
            sleepWhenIdle
              ? 'How long the machine stays on after the wake, even if nobody uses it.'
              : 'Sleep when idle is off, so the machine stays on after the wake anyway.'
          }
          sx={selectSx}
          slotProps={{ select: { native: true }, htmlInput: { 'data-testid': TID.wakeDialogKeepAwake }, inputLabel: { shrink: true } }}
        >
          {choices.map((minutes) => (
            <option key={minutes ?? 'none'} value={minutes === null ? '' : String(minutes)}>
              {describeKeepAwake(minutes)}
            </option>
          ))}
        </TextField>
        {error ? <Alert severity="error">{error}</Alert> : null}
      </DialogContent>
      <DialogActions sx={{ px: { xs: 2, sm: 3 }, pb: 2 }}>
        {schedule !== null ? (
          <Button
            color="error"
            variant="tonal"
            disabled={disabled}
            onClick={() => void remove()}
            data-testid={TID.wakeDialogDelete}
            sx={{ minHeight: 48, mr: 'auto' }}
          >
            {busy === 'deleting' ? 'Deleting…' : 'Delete'}
          </Button>
        ) : null}
        <Button onClick={onClose} disabled={disabled} sx={{ minHeight: 48 }}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="contained"
          disabled={disabled || noDays}
          data-testid={TID.wakeDialogSave}
          sx={{ minHeight: 48 }}
        >
          {busy === 'saving' ? (schedule === null ? 'Adding…' : 'Saving…') : schedule === null ? 'Add wake time' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
