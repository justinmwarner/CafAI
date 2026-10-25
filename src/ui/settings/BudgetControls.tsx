/**
 * Settings > Coach > Usage and cost > Monthly budget (D240): the coach's
 * monthly budget on the API key, inside the usage card while the coach runs
 * on Anthropic (replies through CafAI Bridge, on the Claude plan, never count
 * toward it). Three controls, each applied at once:
 *
 * - The budget: the drinks' stepper as a field of its own look (DrinkFields.tsx
 *   cannot hold "none"), whole dollars from $1 to $1,000, a dollar a tap, any
 *   whole dollar typed (kept within the range), and none when the field is
 *   cleared or No budget is tapped. From none, Raise starts at $1.
 * - A meter of the month's spend against it, success, then warning from 80 %,
 *   error at 100 %, with the words beside it ("37 % of $5.00").
 * - Pause the coach at the budget: the switch, held while there is no budget.
 *
 * Each is saved on its own (Settings.coachBudget, patched field by field),
 * then the coach reads its settings again: that is what sends a reply that
 * waited on the budget once it is raised, cleared or the pause turned off.
 * The line under them says "Saved." for 3 s, or why a change did not save,
 * keeping its height, as the line under a card does (D234); a change that
 * did not save goes back to what the coach still uses. Without a spend
 * service there is nothing to measure, and nothing is drawn.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import OutlinedInput from '@mui/material/OutlinedInput';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import AddRounded from '@mui/icons-material/AddRounded';
import RemoveRounded from '@mui/icons-material/RemoveRounded';
import { useServices } from '../../app/services.tsx';
import { formatUsd } from '../../spend/budget.ts';
import type { BudgetState } from '../../spend/types.ts';
import { useSpendSummary } from '../../spend/useSpend.ts';
import { BUDGET_USD, DEFAULT_BUDGET } from '../../storage/settings.ts';
import type { CoachBudget } from '../../storage/types.ts';
import { DASH } from '../machine/format.ts';
import { SaveLine, useSaveNote } from './SaveLine.tsx';
import { useSubheadingLevel } from './Section.tsx';
import { budgetPercent, sayDay } from './usageFormat.ts';
import { UsageMeter } from './UsageMeter.tsx';
import { TID } from '../testIds.ts';

// The test ids go on the inputs themselves, the elements a test (or a keyboard) can focus: the
// budget's spin button and the switch's checkbox.
declare module '@mui/material/InputBase' {
  interface InputBaseComponentsPropsOverrides {
    'data-testid'?: string;
  }
}
declare module '@mui/material/Switch' {
  interface SwitchInputSlotPropsOverrides {
    'data-testid'?: string;
  }
}

/** The controls' test ids, as kept with the rest in TID (src/ui/testIds.ts). */
export const BUDGET_TID = {
  /** The budget's field (a spin button). */
  amount: TID.coachBudgetAmount,
  lower: TID.coachBudgetLower,
  raise: TID.coachBudgetRaise,
  none: TID.coachBudgetNone,
  /** The meter of the month's spend and its words. */
  meter: TID.coachBudgetMeter,
  /** The pause switch's input. */
  pause: TID.coachBudgetPause,
  /** The line under them: "Saved.", or why a change did not save. */
  saved: TID.settingsSaved('budget'),
} as const;

const NBSP = '\xa0';

/** In place of the meter while there is no budget: what one would do. */
export const NO_BUDGET_LINE = `No budget. Set one to be told in the chat at 80${NBSP}% and 100${NBSP}% of it.`;
/** Under the pause switch: what it does. */
export const PAUSE_LINE = 'At the budget the coach sends nothing more until you raise it or a new month begins. Shots still save.';
const PAUSE_NEEDS_BUDGET = 'Set a budget to use this.';
const pausedLine = (resumesOn: string) =>
  `Paused now: the coach starts again on ${sayDay(resumesOn)}, or as soon as you raise the budget or turn this off.`;

const STEP_COLOUR: Readonly<Record<BudgetState['step'], string>> = {
  none: 'primary.main',
  under: 'success.main',
  near: 'warning.main',
  over: 'error.main',
};

const mutedSx = { color: 'text.secondary' } as const;

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/** Whole dollars within BUDGET_USD. */
function clampBudget(usd: number): number {
  return Math.min(BUDGET_USD.max, Math.max(BUDGET_USD.min, Math.round(usd)));
}

/** What was typed: none (an empty field), a number of dollars ("$12", "1,000", "7.6"), or not a number. */
function readDollars(text: string): number | 'none' | 'invalid' {
  const bare = text.trim().replace(/^\$/, '').replace(/[,\s]/g, '');
  if (bare === '') return 'none';
  const value = Number(bare);
  return Number.isFinite(value) ? value : 'invalid';
}

const spokenBudget = (usd: number) => `${usd} ${usd === 1 ? 'dollar' : 'dollars'} a month`;

/**
 * As the drinks' stepper (DrinkFields.tsx): Less and More fill 30% of the
 * outline at its ends (at least 48 px), the value between them in 17 px at
 * 600 in tabular figures, the dollar sign before it in ink-muted, centred
 * together. No budget is the empty field, its placeholder "None" in
 * ink-muted at full opacity, as every placeholder.
 */
const stepperSx: SxProps<Theme> = (theme) => ({
  width: '100%',
  minHeight: 48,
  '&.MuiInputBase-adornedStart': { pl: 0 },
  '&.MuiInputBase-adornedEnd': { pr: 0 },
  '& .MuiOutlinedInput-input': {
    flex: '0 1 auto',
    p: 0,
    textAlign: 'center',
    fontSize: '1.0625rem',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    '&::placeholder': { color: theme.palette.text.secondary, opacity: 1 },
  },
  '& .MuiOutlinedInput-input.Mui-disabled': { WebkitTextFillColor: theme.palette.text.secondary },
  // The value's own size, muted: money reads "$5", the number in ink; a tap on it reaches the field.
  '& .stepper-unit': {
    fontSize: '1.0625rem',
    fontWeight: 600,
    color: theme.palette.text.secondary,
    mr: '1px',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  },
  '& .stepper-gap': { flex: '1 1 0' },
  '& .stepper-button': { flex: '0 0 30%', minWidth: 48, height: 48, color: theme.palette.text.primary },
  '& .stepper-button.Mui-disabled': { color: theme.palette.action.disabled },
  '& .stepper-less': { borderRadius: `${theme.shape.borderRadius}px 0 0 ${theme.shape.borderRadius}px` },
  '& .stepper-more': { borderRadius: `0 ${theme.shape.borderRadius}px ${theme.shape.borderRadius}px 0` },
});

/** About as wide as what it shows, so the value and its dollar sign centre together (DrinkFields.tsx's valueWidth). */
function inputWidth(text: string, placeholder: boolean): string {
  if (placeholder) return '4.6ch';
  if (text === DASH) return '2ch';
  return `calc(${Math.min(Math.max(text.length, 1), 7)}ch + 2px)`;
}

interface BudgetFieldProps {
  /** Whole dollars; null for no budget; undefined until the settings are read. */
  value: number | null | undefined;
  disabled: boolean;
  /** The heading that names it. */
  labelledBy: string;
  onCommit(next: number | null): void;
}

function BudgetField({ value, disabled, labelledBy, onCommit }: BudgetFieldProps) {
  /** What is being typed, until it is sent or left; otherwise the field shows the budget. */
  const [draft, setDraft] = useState<string | null>(null);
  const known = value !== undefined;
  const shown = draft ?? (value === undefined ? DASH : value === null ? '' : String(value));
  const held = disabled || !known;

  const send = (next: number | null) => {
    setDraft(null);
    if (next !== value) onCommit(next);
  };
  /** What was typed, once the field is left (or Enter): kept within the range, empty for none, put back when it is not a number. */
  const commit = (raw: string) => {
    if (!known) return;
    const typed = readDollars(raw);
    if (typed === 'invalid') setDraft(null);
    else send(typed === 'none' ? null : clampBudget(typed));
  };
  /** A dollar from `from` (the budget, or what is typed); nothing at the end it points to. From none, Raise starts at $1. */
  const nudge = (direction: 1 | -1, from: number | null = value ?? null) => {
    if (held) return;
    if (from === null) {
      if (direction === 1) send(BUDGET_USD.min);
      return;
    }
    const next = clampBudget(from + direction);
    if (next !== from) send(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(event.currentTarget.value);
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const typed = draft === null ? 'invalid' : readDollars(draft);
    nudge(event.key === 'ArrowUp' ? 1 : -1, typeof typed === 'number' ? typed : (value ?? null));
  };

  // The dollar sign before a value, unless the barista typed one of their own.
  const unit = draft === null ? typeof value === 'number' : draft.trim() !== '' && !draft.trim().startsWith('$');

  const button = (direction: 1 | -1) => (
    <IconButton
      className={`stepper-button ${direction === 1 ? 'stepper-more' : 'stepper-less'}`}
      aria-label={direction === 1 ? 'Raise the budget' : 'Lower the budget'}
      data-testid={direction === 1 ? BUDGET_TID.raise : BUDGET_TID.lower}
      // Out of the tab order, as the spin button's own arrows do the same (WAI-ARIA's spin button).
      tabIndex={-1}
      disabled={held || (direction === -1 && value === null)}
      onClick={() => nudge(direction)}
    >
      {direction === 1 ? <AddRounded /> : <RemoveRounded />}
    </IconButton>
  );

  return (
    <OutlinedInput
      value={shown}
      placeholder={known ? 'None' : undefined}
      disabled={held}
      onChange={(event) => setDraft(event.target.value)}
      // Without a FormControl, MUI calls this with no event when the field is disabled while focused.
      onBlur={(event?: { target: { value: string } }) => commit(event ? event.target.value : shown)}
      startAdornment={
        <>
          {button(-1)}
          <span className="stepper-gap" />
          {unit ? (
            <Box component="span" className="stepper-unit" aria-hidden>
              $
            </Box>
          ) : null}
        </>
      }
      endAdornment={
        <>
          <span className="stepper-gap" />
          {button(1)}
        </>
      }
      slotProps={{
        input: {
          role: 'spinbutton',
          'aria-labelledby': labelledBy,
          'aria-valuenow': typeof value === 'number' ? value : undefined,
          'aria-valuemin': BUDGET_USD.min,
          'aria-valuemax': BUDGET_USD.max,
          'aria-valuetext': value === undefined ? 'Unknown' : value === null ? 'No budget' : spokenBudget(value),
          'data-testid': BUDGET_TID.amount,
          inputMode: 'numeric',
          style: { width: inputWidth(shown, known && shown === '') },
          onKeyDown,
        },
      }}
      sx={stepperSx}
    />
  );
}

export function BudgetControls() {
  const { storage, coach, spend } = useServices();
  // The meter follows the month's spend: a count, or Decaid's copy merged in.
  useSpendSummary();
  const headingId = useId();
  const pauseNoteId = useId();
  // Under the card's title: an h3 under a phone's h2, an h4 in a tablet's pane.
  const subheading = useSubheadingLevel();
  // As last read or saved here; null until the settings are read (held meanwhile).
  const [budget, setBudget] = useState<CoachBudget | null>(null);
  const note = useSaveNote();
  const { failed } = note;
  const latestSave = useRef(0);
  /** What storage holds, as far as these controls know: where a failed save goes back to. */
  const confirmed = useRef<CoachBudget>(DEFAULT_BUDGET);

  useEffect(() => {
    let live = true;
    storage.settings.get().then(
      (settings) => {
        if (!live) return;
        confirmed.current = settings.coachBudget ?? DEFAULT_BUDGET;
        setBudget(confirmed.current);
      },
      (reason: unknown) => {
        // Held: a budget shown without the saved one could hide one set here.
        if (live) failed(`Could not read the budget: ${errorText(reason)}`);
      },
    );
    return () => {
      live = false;
    };
  }, [storage, failed]);

  if (!spend) return null;

  /** One field of the budget, saved alone on what storage holds, then the coach reads its settings again. */
  const save = async (patch: Partial<CoachBudget>) => {
    if (budget === null) return;
    const ticket = ++latestSave.current;
    // Shown at once; what storage holds after the save replaces it.
    setBudget({ ...budget, ...patch });
    try {
      const saved = await storage.settings.update({ coachBudget: patch });
      confirmed.current = saved.coachBudget ?? DEFAULT_BUDGET;
      if (ticket === latestSave.current) {
        setBudget(confirmed.current);
        note.saved();
      }
    } catch (reason) {
      // Only the newest change speaks: one made after this that saved carried its own value.
      if (ticket === latestSave.current) {
        setBudget(confirmed.current);
        note.failed(`Could not save the budget: ${errorText(reason)}`);
      }
      return;
    }
    // A reply that waited on the budget goes once the coach finds it raised, cleared or the pause off.
    coach.refresh().catch(() => undefined);
  };

  const state = spend.budget(budget ?? DEFAULT_BUDGET);
  const percent = budgetPercent(state);
  const usd = budget === null ? undefined : budget.monthlyUsd;
  const noBudget = budget !== null && budget.monthlyUsd === null;
  const pauseNote = noBudget ? PAUSE_NEEDS_BUDGET : state.paused ? pausedLine(state.resumesOn) : PAUSE_LINE;

  return (
    <Box>
      <Stack spacing={1.5}>
        <Box>
          <Typography variant="subtitle2" component={subheading} id={headingId}>
            Monthly budget
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
            <Box sx={{ flex: '0 1 184px', minWidth: 0 }}>
              <BudgetField value={usd} disabled={budget === null} labelledBy={headingId} onCommit={(next) => void save({ monthlyUsd: next })} />
            </Box>
            <Button
              variant="text"
              disabled={budget === null || noBudget}
              onClick={() => void save({ monthlyUsd: null })}
              data-testid={BUDGET_TID.none}
              sx={{ minHeight: 48, flex: 'none' }}
            >
              No budget
            </Button>
          </Box>
        </Box>
        {budget === null ? null : state.budgetMicros !== null && percent !== null ? (
          <Box data-testid={BUDGET_TID.meter} sx={{ display: 'grid', gap: 0.75 }}>
            <UsageMeter share={percent / 100} color={STEP_COLOUR[state.step]} />
            <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {`${percent}${NBSP}% of ${formatUsd(state.budgetMicros)}`}
            </Typography>
          </Box>
        ) : (
          <Typography variant="body2" sx={mutedSx}>
            {NO_BUDGET_LINE}
          </Typography>
        )}
        <Box>
          <FormControlLabel
            control={
              <Switch
                checked={budget?.pauseAtBudget ?? false}
                disabled={budget === null || noBudget}
                onChange={(event) => void save({ pauseAtBudget: event.target.checked })}
                slotProps={{ input: { 'data-testid': BUDGET_TID.pause, 'aria-describedby': pauseNoteId } }}
              />
            }
            label="Pause the coach at the budget"
            sx={{ minHeight: 48, mr: 0 }}
          />
          <Typography id={pauseNoteId} variant="body2" sx={mutedSx}>
            {pauseNote}
          </Typography>
        </Box>
      </Stack>
      <SaveLine note={note.note} testId={BUDGET_TID.saved} />
    </Box>
  );
}
