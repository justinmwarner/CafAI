/**
 * The stepper of Settings > Steam, hot water and flush and a drink's set of
 * them (D124), shared with each drink's view (D147). How they read and write
 * is useDrinkPresets.ts; the ranges and steps are drinkSettings.ts.
 *
 * A stepper is one outlined field: Less, the value with its unit, More. The
 * value is a spin button, so the arrow keys move it and the two buttons stay
 * out of the tab order, as in WAI-ARIA's spin button pattern. Only Decaid's
 * own values are shown: until Decaid answers, after a read that failed, and
 * for a field Decaid sent that CafAI could not read, the field is a dash,
 * never a made-up value. Steam below 135 °C is off in Decaid; CafAI shows
 * that read-only rather than clamp it up to "on". A write still on its way
 * after 0.4 s says "Saving…" under its field (Decaid's queue can hold one for
 * 30 s), and one that fails says why there, with the old value back.
 */
import { useEffect, useId, useState, type KeyboardEvent, type ReactElement } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import OutlinedInput from '@mui/material/OutlinedInput';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import AddRounded from '@mui/icons-material/AddRounded';
import AirRounded from '@mui/icons-material/AirRounded';
import RemoveRounded from '@mui/icons-material/RemoveRounded';
import ShowerRounded from '@mui/icons-material/ShowerRounded';
import WaterDropRounded from '@mui/icons-material/WaterDropRounded';
import type { Workflow } from '../../api/types.ts';
import { useTemperatureUnit } from '../../app/services.tsx';
import type { DrinkKind } from '../drinks/kinds.ts';
import { DASH } from '../machine/format.ts';
import {
  clampDrinkField,
  HOT_WATER_FIELDS,
  isDrinkOff,
  nudgeDrinkField,
  RINSE_FIELDS,
  steamFields,
  type DrinkFieldSpec,
} from './drinkSettings.ts';
import { fieldView } from './drinkUnits.ts';

const UNREADABLE = "CafAI could not read Decaid's value.";
const SAVING = 'Saving…';
/** A write still on its way after this long says so; one that lands sooner never flashes a word. */
const SAVING_AFTER_MS = 400;

/** The three objects of the workflow the drinks' settings read and write. */
export type PresetKey = 'steamSettings' | 'hotWaterData' | 'rinseData';
export type Presets = Pick<Workflow, PresetKey>;

export interface Drink {
  key: PresetKey;
  /** As the machine row names it. */
  name: string;
  icon: ReactElement;
  fields: readonly DrinkFieldSpec[];
}

/** The drinks in the order of Settings' title (Steam, hot water and flush), each with the machine row's own icon (MachineRow.tsx). */
export function drinksFor(model: string | null): readonly Drink[] {
  return [
    { key: 'steamSettings', name: 'Steam', icon: <AirRounded fontSize="small" />, fields: steamFields(model) },
    { key: 'hotWaterData', name: 'Hot water', icon: <WaterDropRounded fontSize="small" />, fields: HOT_WATER_FIELDS },
    { key: 'rinseData', name: 'Flush', icon: <ShowerRounded fontSize="small" />, fields: RINSE_FIELDS },
  ];
}

/** Each drink's preset on Decaid's workflow. */
export const PRESET_KEY: Readonly<Record<DrinkKind, PresetKey>> = { steam: 'steamSettings', hotWater: 'hotWaterData', flush: 'rinseData' };

/**
 * How a drink's settings sit: 'responsive' as Settings has them (one row per
 * setting on a phone, the label over the stepper from 600 px), 'rows' always
 * one row per setting, 'columns' side by side, each label over its stepper. A
 * drink's view picks by its own width (DrinkView.tsx), not the window's.
 */
export type DrinkFieldsLayout = 'responsive' | 'rows' | 'columns';

/** A field's value in one of the three presets: a number, or null when it is not known. */
export function fieldValue(data: object | null, key: string): number | null {
  if (data === null) return null;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** One field of one preset set to a value (Decaid's own, or the one going to it), the rest as they were. */
export function withField(presets: Presets, drink: PresetKey, key: string, value: unknown): Presets {
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

/** The key a field's writes and failure are kept under (useDrinkPresets.ts). */
export function fieldId(drink: PresetKey, key: string): string {
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
 * The grid a drink's settings share: one row per setting, or side by side.
 * In rows, the labels, then the steppers at the end, 184 px where there is
 * room and on the narrowest phones what the longest label leaves, the same
 * for every row. 'responsive' has them in rows on a phone and, from 600 px,
 * each label over its stepper.
 */
function fieldsSx(layout: DrinkFieldsLayout, count: number): SxProps<Theme> {
  const rows = {
    display: 'grid',
    gridTemplateColumns: 'max-content minmax(0, 184px)',
    justifyContent: 'space-between',
    alignItems: 'center',
    columnGap: 2,
    rowGap: 1,
  } as const;
  if (layout === 'rows') return rows;
  if (layout === 'columns') return { display: 'grid', gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`, alignItems: 'start', columnGap: 2, rowGap: 1.5 };
  return {
    display: 'grid',
    gridTemplateColumns: { xs: 'max-content minmax(0, 184px)', sm: 'minmax(0, 1fr)' },
    justifyContent: { xs: 'space-between', sm: 'stretch' },
    alignItems: 'center',
    columnGap: 2,
    rowGap: { xs: 1, sm: 1.5 },
  };
}

/** One setting: in a row its label, stepper and note join the grid; stacked, a column of its own. */
function fieldSx(layout: DrinkFieldsLayout): SxProps<Theme> {
  if (layout === 'rows') return { display: 'contents' };
  if (layout === 'columns') return { display: 'grid', rowGap: 0.75 };
  return { display: { xs: 'contents', sm: 'grid' }, rowGap: 0.75 };
}

/**
 * The note under a setting spans the row. With no width of its own (it fills
 * the row through min-width) it never widens the labels' column, where a long
 * sentence would squeeze the steppers to nothing.
 */
const noteSx = { gridColumn: '1 / -1', width: 0, minWidth: '100%' } as const;

/** A row's label, read like a list; over the stepper a muted field label, as Appearance has them. */
function labelSx(layout: DrinkFieldsLayout): SxProps<Theme> {
  return (theme) => {
    const row = { ...theme.typography.body2, color: theme.palette.text.primary };
    const stacked = { ...theme.typography.label, color: theme.palette.text.secondary };
    if (layout === 'rows') return row;
    if (layout === 'columns') return stacked;
    return { ...row, [theme.breakpoints.up('sm')]: stacked };
  };
}

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
  '&.stepper-off .MuiOutlinedInput-input': { ...theme.typography.body2, flex: '1 1 auto' },
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
  // The field's own corners, so a pressed button fills its end of the outline exactly.
  '& .stepper-less': { borderRadius: `${theme.shape.borderRadius}px 0 0 ${theme.shape.borderRadius}px` },
  '& .stepper-more': { borderRadius: `0 ${theme.shape.borderRadius}px ${theme.shape.borderRadius}px 0` },
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
  layout: DrinkFieldsLayout;
  /** Sends a value the user chose; nothing is sent while it cannot be written (the machine started, or went). */
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
export function DrinkField({ spec, value, loaded, disabled, saving, error, layout, onCommit }: DrinkFieldProps) {
  const inputId = useId();
  const noteId = useId();
  // What the barista reads and types: Decaid's own value, or a temperature in °F, which Decaid keeps in whole °C (D173).
  const view = fieldView(spec, useTemperatureUnit());
  /** What is being typed, until it is sent or left; otherwise the field shows Decaid's value (or the one on its way). */
  const [draft, setDraft] = useState<string | null>(null);
  const slow = useHeldFor(saving, SAVING_AFTER_MS);

  const off = value !== null && isDrinkOff(spec, value);
  const unknown = value === null;
  const note = error ?? (slow ? SAVING : unknown && loaded ? UNREADABLE : null);

  /** Sends a value the user chose. The field then shows it on its way, or Decaid's own if it cannot be written now. */
  const send = (next: number) => {
    setDraft(null);
    onCommit(next);
  };
  const commit = (raw: string) => {
    if (value === null || off) return;
    const trimmed = raw.trim();
    // Nothing typed: never clamp or re-send a value nobody touched, even one outside this field's range.
    if (trimmed === String(view.shown(value))) {
      setDraft(null);
      return;
    }
    const parsed = trimmed === '' ? Number.NaN : Number(trimmed);
    const next = clampDrinkField(spec, Number.isFinite(parsed) ? view.fromShown(parsed) : value);
    if (next === value) setDraft(null);
    else send(next);
  };
  /** One step from `from` (the value, or what was typed), written at once; nothing at the end it points to. */
  const nudge = (direction: 1 | -1, from: number | null = value) => {
    if (from === null || off) return;
    const next = nudgeDrinkField(spec, from, direction);
    if (next !== null) send(next);
  };
  /** Up and Down step from what is typed, so 57 then Up writes 58. */
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const typed = draft === null || draft.trim() === '' ? Number.NaN : Number(draft.trim());
    nudge(event.key === 'ArrowUp' ? 1 : -1, Number.isFinite(typed) ? view.fromShown(typed) : value);
  };

  const offText = spec.offText ?? 'Off';
  const shown = off ? offText : (draft ?? (value === null ? DASH : String(view.shown(value))));
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
    <Box sx={fieldSx(layout)}>
      <Typography component="label" htmlFor={inputId} sx={labelSx(layout)}>
        {spec.shortLabel}
      </Typography>
      <OutlinedInput
        id={inputId}
        className={off ? 'stepper-off' : undefined}
        value={shown}
        disabled={disabled || unknown || off}
        error={error !== null}
        onChange={(event) => setDraft(event.target.value)}
        // Without a FormControl, MUI calls this with no event when the field is disabled while
        // focused (the machine started): what was typed is offered, and refused, all the same.
        onBlur={(event?: { target: { value: string } }) => commit(event ? event.target.value : shown)}
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
                {view.unit}
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
            'aria-valuenow': off || unknown ? undefined : view.shown(value),
            'aria-valuemin': off || unknown ? undefined : view.range.min,
            'aria-valuemax': off || unknown ? undefined : view.range.max,
            'aria-valuetext': off ? offText : unknown ? 'Unknown' : `${view.shown(value)} ${view.spokenUnit}`,
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

export interface DrinkFieldsGridProps {
  drink: Drink;
  data: object | null;
  /** Decaid's presets are in: a dash now means Decaid sent something CafAI could not read. */
  loaded: boolean;
  disabled: boolean;
  pending: Readonly<Record<string, number>>;
  failed: Readonly<Record<string, string>>;
  onCommit(drink: Drink, spec: DrinkFieldSpec, value: number): void;
  layout?: DrinkFieldsLayout;
}

/** One drink's settings, without a heading: the caller names them. */
export function DrinkFieldsGrid({ drink, data, loaded, disabled, pending, failed, onCommit, layout = 'responsive' }: DrinkFieldsGridProps) {
  return (
    <Box sx={fieldsSx(layout, drink.fields.length)}>
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
            layout={layout}
            onCommit={(value) => onCommit(drink, spec, value)}
          />
        );
      })}
    </Box>
  );
}
