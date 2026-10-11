/**
 * Settings > Steam, hot water and flush (6.6): the three drink presets
 * Decaid keeps on the workflow, the ones the machine row's Steam, Hot water
 * and Flush run with. Each field reads GET /api/v1/workflow and writes its
 * own object with PUT /api/v1/workflow (never the profile), clamped by
 * drinkSettings.ts. Disabled while a shot, steam, hot water or flush is
 * running, since Decaid is already using these values then, and while no
 * machine is connected, since Decaid refuses these writes without one (it
 * puts them on the DE1 at once).
 *
 * Only Decaid's own values are shown: until Decaid answers, after a read
 * that failed (with Retry), and for a field Decaid sent that CafAI could not
 * read, the field is a dash, never a made-up value. A blur, a stepper tap or
 * an arrow key only ever writes a value the user actually chose: leaving a
 * field untouched never clamps or re-sends whatever Decaid already had, even
 * when that value sits outside CafAI's own range (another skin's), and a
 * stepper at the end of the range sends nothing. Steam below 135 °C is off in
 * Decaid; CafAI shows that read-only rather than clamp it up to "on".
 *
 * Laid out as the machine row draws the drinks (D124): a group for each under
 * its name and the row's icon, side by side on a tablet and stacked on a
 * phone, where each setting is one row with its stepper at the end. A stepper
 * is one outlined field: Less, the value with its unit, More. The value is a
 * spin button, so the arrow keys move it and the two buttons stay out of the
 * tab order, as in WAI-ARIA's spin button pattern. The line under the title
 * says what the section is for, or why it cannot be changed now, in one place
 * that keeps its height, so nothing moves when the machine starts. A write
 * still on its way after 0.4 s says "Saving…" under its field (Decaid's queue
 * can hold one for 30 s), and one that fails says why there, with the old
 * value back.
 */
import { useEffect, useId, useState, type KeyboardEvent, type ReactElement } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import OutlinedInput from '@mui/material/OutlinedInput';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import AddRounded from '@mui/icons-material/AddRounded';
import AirRounded from '@mui/icons-material/AirRounded';
import RemoveRounded from '@mui/icons-material/RemoveRounded';
import ShowerRounded from '@mui/icons-material/ShowerRounded';
import WaterDropRounded from '@mui/icons-material/WaterDropRounded';
import type { Workflow, WorkflowPatch } from '../../api/types.ts';
import { useServices, useTelemetry } from '../../app/services.tsx';
import { DASH } from '../machine/format.ts';
import { TID } from '../testIds.ts';
import {
  blocksDrinkSettings,
  clampDrinkField,
  HOT_WATER_FIELDS,
  isDrinkOff,
  nudgeDrinkField,
  RINSE_FIELDS,
  steamFields,
  type DrinkFieldSpec,
} from './drinkSettings.ts';
import { Section } from './Section.tsx';

const HELP = 'The Steam, Hot water and Flush buttons use these. Changes go to Decaid at once.';
const NOT_WHILE_RUNNING = 'Not while the machine is running.';
const NOT_CONNECTED = 'Connect the DE1 to change these.';
const READING = "Reading Decaid's drink settings…";
const UNREADABLE = "CafAI could not read Decaid's value.";
const SAVING = 'Saving…';
/** A write still on its way after this long says so; one that lands sooner never flashes a word. */
const SAVING_AFTER_MS = 400;

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

const mutedSx = { color: 'text.secondary' } as const;

/** The three objects of the workflow this section reads and writes. */
type PresetKey = 'steamSettings' | 'hotWaterData' | 'rinseData';
type Presets = Pick<Workflow, PresetKey>;

interface Drink {
  key: PresetKey;
  /** As the machine row names it. */
  name: string;
  icon: ReactElement;
  fields: readonly DrinkFieldSpec[];
}

/** The drinks in the title's order, each with the machine row's own icon (MachineRow.tsx). */
function drinksFor(model: string | null): readonly Drink[] {
  return [
    { key: 'steamSettings', name: 'Steam', icon: <AirRounded fontSize="small" />, fields: steamFields(model) },
    { key: 'hotWaterData', name: 'Hot water', icon: <WaterDropRounded fontSize="small" />, fields: HOT_WATER_FIELDS },
    { key: 'rinseData', name: 'Flush', icon: <ShowerRounded fontSize="small" />, fields: RINSE_FIELDS },
  ];
}

/** A field's value in one of the three presets: a number, or null when it is not known. */
function fieldValue(data: object | null, key: string): number | null {
  if (data === null) return null;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** One field of one preset set to a value (Decaid's own, or the one going to it), the rest as they were. */
function withField(presets: Presets, drink: PresetKey, key: string, value: unknown): Presets {
  return { ...presets, [drink]: { ...presets[drink], [key]: value } } as Presets;
}

/**
 * About as wide as `text` in the value's tabular figures, so the value and its
 * unit centre together: a figure is 1ch, a point less than half of one.
 */
function valueWidth(text: string): string {
  if (text === DASH) return '2ch';
  const points = text.replace(/[^.,]/g, '').length;
  const chars = Math.min(Math.max(text.length - points * 0.55, 1), 8);
  return `calc(${chars}ch + 2px)`;
}

/** The key the section keeps a field's writes and failure under. */
function fieldId(drink: PresetKey, key: string): string {
  return `${drink}.${key}`;
}

/** True once `on` has held for `ms`, and false again as soon as it stops. */
function useHeldFor(on: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!on) return undefined;
    const timer = setTimeout(() => setHeld(true), ms);
    return () => {
      clearTimeout(timer);
      setHeld(false);
    };
  }, [on, ms]);
  return on && held;
}

/**
 * A drink's settings. On a phone each is one row of a grid the drink shares:
 * the labels, then the steppers at the end, 184 px where there is room and on
 * the narrowest phones what the longest label leaves, the same for every row.
 * From 600 px each setting's label sits over its stepper.
 */
const fieldsSx = {
  display: 'grid',
  gridTemplateColumns: { xs: 'max-content minmax(0, 184px)', sm: 'minmax(0, 1fr)' },
  justifyContent: { xs: 'space-between', sm: 'stretch' },
  alignItems: 'center',
  columnGap: 2,
  rowGap: { xs: 1, sm: 1.5 },
} as const;

/** One setting: on a phone its label, stepper and note join the drink's grid; from 600 px a column of its own. */
const fieldSx = { display: { xs: 'contents', sm: 'grid' }, rowGap: 0.75 } as const;

/**
 * The note under a setting spans the row. With no width of its own (it fills
 * the row through min-width) it never widens the labels' column, where a long
 * sentence would squeeze the steppers to nothing.
 */
const noteSx = { gridColumn: '1 / -1', width: 0, minWidth: '100%' } as const;

/** A row's label on a phone, read like a list; over the stepper a muted field label, as Appearance has them. */
const labelSx: SxProps<Theme> = (theme) => ({
  ...theme.typography.body2,
  color: theme.palette.text.primary,
  [theme.breakpoints.up('sm')]: { ...theme.typography.label, color: theme.palette.text.secondary },
});

const RADIUS = 12;

/**
 * One outlined field, MUI's as in the other settings. Less and More each fill
 * 30% of it at its ends (at least 48 px), so a thumb that misses the icon
 * still lands on its button rather than opening the keyboard, and the icons
 * line up from one stepper to the next. The value with its unit sits centred
 * between two equal gaps, in tabular figures. Decaid's value stays readable
 * while the stepper is disabled: only the buttons fade.
 */
const stepperSx: SxProps<Theme> = (theme) => ({
  width: '100%',
  minHeight: 48,
  // MUI pads an adorned field for an icon; these buttons reach the outline.
  '&.MuiInputBase-adornedStart': { pl: 0 },
  '&.MuiInputBase-adornedEnd': { pr: 0 },
  '& .MuiOutlinedInput-input': {
    flex: '0 1 auto',
    p: 0,
    textAlign: 'center',
    fontSize: '1.0625rem',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  '& .MuiOutlinedInput-input.Mui-disabled': { WebkitTextFillColor: theme.palette.text.secondary },
  // Steam off in Decaid: words across the whole field, in body text rather than figures.
  '&.stepper-off .MuiOutlinedInput-input': { ...theme.typography.body2, flex: '1 1 auto', p: 0 },
  // Smaller and muted, as units are beside live numbers (D81), on the number's baseline; a tap on it reaches the field.
  '& .stepper-unit': {
    ...theme.typography.label,
    color: theme.palette.text.secondary,
    ml: '3px',
    position: 'relative',
    top: '2px',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  },
  '& .stepper-gap': { flex: '1 1 0' },
  // In ink, as the machine row's starts are: they are what the barista reaches for.
  '& .stepper-button': { flex: '0 0 30%', minWidth: 48, height: 48, color: theme.palette.text.primary },
  '& .stepper-button.Mui-disabled': { color: theme.palette.action.disabled },
  '& .stepper-less': { borderRadius: `${RADIUS}px 0 0 ${RADIUS}px` },
  '& .stepper-more': { borderRadius: `0 ${RADIUS}px ${RADIUS}px 0` },
});

interface DrinkFieldProps {
  spec: DrinkFieldSpec;
  value: number | null;
  /** Decaid's presets are in: a dash now means Decaid sent something CafAI could not read. */
  loaded: boolean;
  disabled: boolean;
  /** A write of this field is on its way to Decaid. */
  saving: boolean;
  /** Why the last write of this field failed, until it is written again. */
  error: string | null;
  onCommit(value: number): void;
}

/**
 * A setting's label and its stepper, clamped into the field's range. A dash,
 * disabled and without buttons, while its value is not known (`loaded` false:
 * not read yet; true: Decaid sent something CafAI could not read, which a note
 * says); read-only "Off in Decaid", without buttons, when the value means the
 * drink is off, in the field itself so the drinks stay in line. Under it, one
 * note at a time: a failed save, "Saving…", or a value CafAI could not read.
 */
function DrinkField({ spec, value, loaded, disabled, saving, error, onCommit }: DrinkFieldProps) {
  const inputId = useId();
  const noteId = useId();
  const [draft, setDraft] = useState(value === null ? DASH : String(value));
  useEffect(() => setDraft(value === null ? DASH : String(value)), [value]);
  const slow = useHeldFor(saving, SAVING_AFTER_MS);

  const off = value !== null && isDrinkOff(spec, value);
  const unknown = value === null;
  const note = error ?? (slow ? SAVING : unknown && loaded ? UNREADABLE : null);

  const commit = (raw: string) => {
    if (value === null || off) return;
    const trimmed = raw.trim();
    // Nothing typed: never clamp or re-send a value nobody touched, even one outside this field's range.
    if (trimmed === String(value)) {
      setDraft(String(value));
      return;
    }
    const parsed = trimmed === '' ? Number.NaN : Number(trimmed);
    const next = clampDrinkField(spec, Number.isFinite(parsed) ? parsed : value);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  /** One step from `from` (the value, or what was typed), written at once; nothing at the end it points to. */
  const nudge = (direction: 1 | -1, from: number | null = value) => {
    if (from === null || off) return;
    const next = nudgeDrinkField(spec, from, direction);
    if (next === null) return;
    setDraft(String(next));
    onCommit(next);
  };
  /** Up and Down step from what is typed, so 57 then Up writes 58. */
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const typed = draft.trim() === '' ? Number.NaN : Number(draft.trim());
    nudge(event.key === 'ArrowUp' ? 1 : -1, Number.isFinite(typed) ? typed : value);
  };

  const offText = spec.offText ?? 'Off';
  const shown = off ? offText : draft;
  // Only a value Decaid gave can be stepped: a dash between a minus and a plus would read as a third minus.
  const stepping = !off && !unknown;
  const button = (direction: 1 | -1) =>
    stepping ? (
      <IconButton
        className={`stepper-button ${direction === 1 ? 'stepper-more' : 'stepper-less'}`}
        aria-label={`${direction === 1 ? 'More' : 'Less'} ${spec.label.toLowerCase()}`}
        tabIndex={-1}
        disabled={disabled}
        onClick={() => nudge(direction)}
      >
        {direction === 1 ? <AddRounded /> : <RemoveRounded />}
      </IconButton>
    ) : null;

  return (
    <Box sx={fieldSx}>
      <Typography component="label" htmlFor={inputId} sx={labelSx}>
        {spec.shortLabel}
      </Typography>
      <OutlinedInput
        id={inputId}
        className={off ? 'stepper-off' : undefined}
        value={shown}
        disabled={disabled || unknown || off}
        error={error !== null}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        startAdornment={
          <>
            {button(-1)}
            <span className="stepper-gap" />
          </>
        }
        endAdornment={
          <>
            {stepping ? (
              <Box component="span" className="stepper-unit" aria-hidden>
                {spec.unit}
              </Box>
            ) : null}
            <span className="stepper-gap" />
            {button(1)}
          </>
        }
        slotProps={{
          input: {
            role: 'spinbutton',
            'aria-label': spec.label,
            'aria-valuenow': off || unknown ? undefined : value,
            'aria-valuetext': off ? offText : unknown ? 'Unknown' : `${value} ${spec.spokenUnit}`,
            'aria-describedby': note ? noteId : undefined,
            'aria-busy': saving || undefined,
            inputMode: spec.integer ? 'numeric' : 'decimal',
            // As wide as what it shows, so the value and its unit centre together.
            style: off ? undefined : { width: valueWidth(shown) },
            onKeyDown,
          },
        }}
        sx={stepperSx}
      />
      {note ? (
        <Typography id={noteId} variant="body2" role={error ? 'alert' : undefined} sx={{ ...noteSx, color: error ? 'error.main' : 'text.secondary' }}>
          {note}
        </Typography>
      ) : null}
    </Box>
  );
}

interface DrinkGroupProps {
  drink: Drink;
  data: object | null;
  loaded: boolean;
  disabled: boolean;
  pending: Readonly<Record<string, number>>;
  failed: Readonly<Record<string, string>>;
  onCommit(drink: Drink, spec: DrinkFieldSpec, value: number): void;
}

/** One drink: its name under the machine row's icon, then its settings. A group, named by its heading. */
function DrinkGroup({ drink, data, loaded, disabled, pending, failed, onCommit }: DrinkGroupProps) {
  const headingId = useId();
  return (
    <Box role="group" aria-labelledby={headingId}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, color: 'text.secondary' }}>
        {drink.icon}
        <Typography id={headingId} variant="subtitle2" component="h3" sx={{ color: 'text.primary' }}>
          {drink.name}
        </Typography>
      </Box>
      <Box sx={fieldsSx}>
        {drink.fields.map((spec) => {
          const id = fieldId(drink.key, spec.key);
          return (
            <DrinkField
              key={spec.key}
              spec={spec}
              value={fieldValue(data, spec.key)}
              loaded={loaded}
              disabled={disabled}
              saving={(pending[id] ?? 0) > 0}
              error={failed[id] ?? null}
              onCommit={(value) => onCommit(drink, spec, value)}
            />
          );
        })}
      </Box>
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

export function DrinkSettingsSection() {
  const { decaid } = useServices();
  const connected = useTelemetry((state) => state.machineConnected);
  const runningState = useTelemetry((state) => state.machine?.state.state ?? null);
  const blocked = blocksDrinkSettings(runningState);

  const [model, setModel] = useState<string | null>(null);
  const [presets, setPresets] = useState<Presets | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Bumped by Retry: reads the workflow again. */
  const [reads, setReads] = useState(0);
  /** Writes still on their way to Decaid, and why a field's last write failed, by fieldId. */
  const [pending, setPending] = useState<Readonly<Record<string, number>>>({});
  const [failed, setFailed] = useState<Readonly<Record<string, string>>>({});

  useEffect(() => {
    let live = true;
    setLoadError(null);
    decaid
      .getWorkflow()
      .then((workflow) => {
        if (!live) return;
        setPresets({ steamSettings: workflow.steamSettings, hotWaterData: workflow.hotWaterData, rinseData: workflow.rinseData });
      })
      .catch((caught: unknown) => {
        if (live) setLoadError(`Could not read Decaid's drink settings: ${errorText(caught)}`);
      });
    return () => {
      live = false;
    };
  }, [decaid, reads]);

  useEffect(() => {
    let live = true;
    // Steam's enabled range depends on the machine (DE1 160, Bengle 165); fails safe to the
    // narrower DE1 range (steamTemperatureField's own default) while this is unknown.
    decaid
      .getMachineInfo()
      .then((info) => {
        if (live) setModel(info.model);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [decaid]);

  const loaded = presets !== null;
  const disabled = blocked || !connected || !loaded;
  /** Re-checked at the write, not just at render: the machine may have started, or gone, between the tap and the call. */
  const writable = () => connected && !blocksDrinkSettings(runningState);

  const commit = async (drink: Drink, spec: DrinkFieldSpec, value: number) => {
    if (!presets || !writable()) return;
    const previous = (presets[drink.key] as Record<string, unknown>)[spec.key];
    if (previous === value) return;
    const id = fieldId(drink.key, spec.key);
    setPresets((now) => now && withField(now, drink.key, spec.key, value));
    setFailed(({ [id]: _cleared, ...rest }) => rest);
    setPending((now) => ({ ...now, [id]: (now[id] ?? 0) + 1 }));
    try {
      const patch = { [drink.key]: { [spec.key]: value } } as WorkflowPatch;
      const updated = await decaid.updateWorkflow(patch);
      // Decaid's word on the whole drink, so a field its reply does not give in a readable form shows a dash.
      setPresets((now) => now && ({ ...now, [drink.key]: updated[drink.key] } as Presets));
    } catch (caught) {
      // Only this field goes back: a write of another field that landed meanwhile stays.
      setPresets((now) => now && withField(now, drink.key, spec.key, previous));
      setFailed((now) => ({ ...now, [id]: `Could not save the ${spec.label.toLowerCase()}: ${errorText(caught)}` }));
    } finally {
      setPending(({ [id]: count = 0, ...rest }) => (count > 1 ? { ...rest, [id]: count - 1 } : rest));
    }
  };

  // One reason at a time: without a machine, what it runs says nothing.
  const reason = !connected ? NOT_CONNECTED : blocked ? NOT_WHILE_RUNNING : !loaded && loadError === null ? READING : null;

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
        {loadError ? (
          <Alert
            severity="error"
            sx={{ alignItems: 'center', '& .MuiAlert-action': { pt: 0, alignItems: 'center' } }}
            action={
              <Button color="inherit" onClick={() => setReads((count) => count + 1)} sx={{ minHeight: 48 }}>
                Retry
              </Button>
            }
          >
            {loadError}
          </Alert>
        ) : null}
        <Box sx={groupsSx}>
          {drinksFor(model).map((drink) => (
            <DrinkGroup
              key={drink.key}
              drink={drink}
              data={presets?.[drink.key] ?? null}
              loaded={loaded}
              disabled={disabled}
              pending={pending}
              failed={failed}
              onCommit={(which, spec, value) => void commit(which, spec, value)}
            />
          ))}
        </Box>
      </Stack>
    </Section>
  );
}
