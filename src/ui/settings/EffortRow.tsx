/**
 * Settings > Coach > How the coach replies (D243): how hard the coach thinks
 * before a reply, the request's effort: Quicker (low), Balanced (medium,
 * CafAI's default, D30) or Thorough (high). The line under it says what the
 * chosen one trades; the usage card shows by how much. The bag photo stays
 * low whatever is chosen (the engine's own).
 *
 * Drawn as the Mode control (AppearanceSection.tsx). A tap applies at once:
 * saved as coachEffort, then the coach reads its settings again, so its next
 * reply takes it. A change costs one fuller request, once: the prompt cache
 * starts again (through CafAI Bridge, a new Claude Code session). A save that
 * lands says "Saved." in the line under the card it sits in (D234); one that
 * fails says so under the row, and the control goes back to what the coach
 * still uses.
 *
 * It applies on the computer too: CafAI Bridge passes the request's effort to
 * Claude Code (--effort). Held, with a line saying why, on a model without
 * effort: one CafAI knows as such (Haiku 4.5, a former model, so the lookup
 * covers every model CafAI has rules for, not only those it offers), or one
 * typed by hand, which the request never carries an effort for (modelInfo,
 * src/llm/anthropic.ts). The card it sits in may pass the model its Model
 * field shows, so a model picked there takes effect here at once.
 */
import { useEffect, useId, useRef, useState } from 'react';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useServices } from '../../app/services.tsx';
import { KNOWN_MODELS, resolveModel } from '../../llm/models.ts';
import { DEFAULT_COACH_EFFORT } from '../../storage/settings.ts';
import type { CoachEffort } from '../../storage/types.ts';
import { useCoachRunsOnComputer } from './coachSourceView.ts';
import { TID } from '../testIds.ts';

/** The row's test ids, as kept with the rest in TID (src/ui/testIds.ts). */
export const EFFORT_TID = {
  /** Each choice: coach-effort-low, coach-effort-medium, coach-effort-high. */
  effort: (effort: CoachEffort) => TID.coachEffort(effort),
} as const;

const CHOICES: ReadonlyArray<{ effort: CoachEffort; label: string }> = [
  { effort: 'low', label: 'Quicker' },
  { effort: 'medium', label: 'Balanced' },
  { effort: 'high', label: 'Thorough' },
];

/** What each one trades while the coach runs on the API key, where a reply is paid for. */
export const EFFORT_LINES: Readonly<Record<CoachEffort, string>> = {
  low: 'Quicker answers sooner and costs less; fine for an easy dial-in.',
  medium: "Balanced: CafAI's default.",
  high: 'Thorough thinks longer: better on a hard dial-in, and it costs more.',
};

/** The same on the Claude plan, where a reply costs nothing but the plan's use. */
const PLAN_LINES: Readonly<Record<CoachEffort, string>> = {
  low: 'Quicker answers sooner and uses less of your plan; fine for an easy dial-in.',
  medium: "Balanced: CafAI's default.",
  high: 'Thorough thinks longer: better on a hard dial-in, and it uses more of your plan.',
};

/** Said after the line while the coach runs on the computer: the bridge passes the effort on. */
export const ON_COMPUTER_LINE = 'Claude Code on your computer follows it too.';

/** Why the row is held: a model CafAI knows has no effort, or one typed by hand is sent none. */
function heldLine(model: string, label: string | null): string {
  return label === null
    ? `${model} is typed by hand, so CafAI sends it no setting for this.`
    : `${label} has no setting for this, so it always replies the same way.`;
}

/** The Mode control's track (AppearanceSection.tsx): the chosen one a paper-coloured pill on raised. */
const trackSx: SxProps<Theme> = (theme) => ({
  bgcolor: 'cafai.raised',
  borderRadius: '14px',
  p: '4px',
  gap: '4px',
  '& .MuiToggleButtonGroup-grouped': {
    flex: '1 1 0',
    minWidth: 0,
    minHeight: 48,
    m: 0,
    border: 0,
    borderRadius: '10px',
    color: 'text.secondary',
    fontSize: '0.9375rem',
    transition: theme.transitions.create(['background-color', 'color', 'box-shadow'], {
      duration: theme.transitions.duration.shorter,
    }),
    '&.Mui-selected, &.Mui-selected:hover': {
      bgcolor: 'background.paper',
      color: 'text.primary',
      boxShadow: `0 1px 2px rgba(0, 0, 0, ${theme.palette.mode === 'dark' ? 0.35 : 0.14})`,
    },
    // Held: still the Mode control's track, without the outline MUI gives a disabled toggle; the
    // choice kept for another model stays on its pill, its label muted with the rest.
    '&.Mui-disabled': { border: 0, color: theme.palette.action.disabled },
    '&.Mui-selected.Mui-disabled': { color: theme.palette.text.secondary },
  },
});

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

export interface EffortRowProps {
  /**
   * The model the card's Model field shows (blank for the default), so a
   * pick there holds or frees the row at once; without it the row reads the
   * saved model.
   */
  model?: string;
  /** The newest change saved: the card says "Saved." in its line, as for its own (D234). */
  onSaved?: () => void;
}

export function EffortRow({ model: shownModel, onSaved }: EffortRowProps) {
  const { storage, coach, models } = useServices();
  const onComputer = useCoachRunsOnComputer();
  const helpId = useId();
  // The choice as last read or saved here; null until the settings are read.
  const [effort, setEffort] = useState<CoachEffort | null>(null);
  const [savedModel, setSavedModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestSave = useRef(0);
  /** What storage holds, as far as this row knows: where a failed save goes back to. */
  const confirmed = useRef<CoachEffort>(DEFAULT_COACH_EFFORT);

  useEffect(() => {
    let live = true;
    storage.settings.get().then(
      (settings) => {
        if (!live) return;
        confirmed.current = settings.coachEffort ?? DEFAULT_COACH_EFFORT;
        setEffort(confirmed.current);
        setSavedModel(settings.model);
      },
      (reason: unknown) => {
        // Held: a choice shown without the saved one could hide one made here.
        if (live) setError(`Could not read how the coach replies: ${errorText(reason)}`);
      },
    );
    return () => {
      live = false;
    };
  }, [storage]);

  const model = resolveModel(shownModel ?? savedModel);
  const info = models.find((m) => m.id === model) ?? KNOWN_MODELS.find((m) => m.id === model) ?? null;
  const takesEffort = info?.supportsEffort === true;
  const held = effort === null || !takesEffort;
  const line = !takesEffort
    ? heldLine(model, info?.label ?? null)
    : effort === null
      ? ''
      : onComputer
        ? `${PLAN_LINES[effort]} ${ON_COMPUTER_LINE}`
        : EFFORT_LINES[effort];

  const save = async (next: CoachEffort) => {
    const ticket = ++latestSave.current;
    setError(null);
    // Shown at once; what storage holds after the save replaces it.
    setEffort(next);
    try {
      const saved = await storage.settings.update({ coachEffort: next });
      confirmed.current = saved.coachEffort ?? DEFAULT_COACH_EFFORT;
      if (ticket === latestSave.current) {
        setEffort(confirmed.current);
        onSaved?.();
      }
    } catch (reason) {
      // Only the newest change speaks: one made after this that saved carried its own choice.
      if (ticket === latestSave.current) {
        setEffort(confirmed.current);
        setError(`Could not save how the coach replies: ${errorText(reason)}`);
      }
      return;
    }
    // The coach reads its settings again, so its next reply takes the new effort. A refresh
    // that fails leaves the choice saved, and the coach takes it at its next one.
    await coach.refresh().catch(() => undefined);
  };

  const choose = (next: CoachEffort | null) => {
    // A tap on the chosen one reports null: it stays chosen.
    if (next === null || next === effort || held) return;
    void save(next);
  };

  return (
    <Stack spacing={1}>
      <Typography variant="label" component="div" sx={{ color: 'text.secondary' }}>
        How the coach replies
      </Typography>
      <ToggleButtonGroup
        exclusive
        fullWidth
        aria-label="How the coach replies"
        aria-describedby={helpId}
        value={effort}
        disabled={held}
        onChange={(_event, next: CoachEffort | null) => choose(next)}
        sx={trackSx}
      >
        {CHOICES.map(({ effort: value, label }) => (
          <ToggleButton key={value} value={value} data-testid={EFFORT_TID.effort(value)}>
            {label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography id={helpId} variant="body2" sx={{ color: 'text.secondary' }}>
        {line}
      </Typography>
      {error ? (
        <Typography variant="body2" role="alert" sx={{ color: 'error.main' }}>
          {error}
        </Typography>
      ) : null}
    </Stack>
  );
}
