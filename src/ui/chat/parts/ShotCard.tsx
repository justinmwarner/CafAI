import { useId, useRef, type KeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { type SxProps, type Theme } from '@mui/material/styles';
import LocalCafeIcon from '@mui/icons-material/LocalCafe';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { isVisualizerShotUrl } from '../../../api/pluginData.ts';
import { SHOT_VERDICTS, SHOT_VERDICT_WORDS, type ShotBaseline, type ShotVerdict } from '../../../app/types.ts';
import { pourTime } from '../../../coach/summary/pourClock.ts';
import type { ShotSummary } from '../../../coach/types.ts';
import { TID } from '../../testIds.ts';
import { describeChannelingFlag, formatBar, formatGrams, formatRatio, formatSeconds, shotRatio } from '../format.ts';
import { ShotSparkline } from './ShotSparkline.tsx';
import { ShotTds } from './ShotTds.tsx';

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="label" component="div" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="body1" component="div" sx={{ fontWeight: 650, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Box>
  );
}

/**
 * "On Visualizer" (6.4): a plain link to the shot's page, which Decaid opens
 * in the system browser. Only a Visualizer shot page is linked, whatever an
 * imported record says.
 */
export function VisualizerLink({ url }: { url: string | null | undefined }) {
  if (!isVisualizerShotUrl(url)) return null;
  return (
    <Button
      component="a"
      href={url}
      rel="noreferrer"
      variant="text"
      color="primary"
      endIcon={<OpenInNewRoundedIcon />}
      data-testid={TID.visualizerLink}
      // Its own width in a grid row too (History's shot rows).
      sx={{ minHeight: 48, mt: 0.5, justifySelf: 'start' }}
    >
      On Visualizer
    </Button>
  );
}

/** "About the same": the answer an arrow key moves from, and the Tab stop, before there is one. */
const MIDDLE = SHOT_VERDICTS.indexOf('same');

/** The question names what the shot is compared with (D126); a card that does not say compares with the shot before it. */
function comparisonQuestion(baseline: ShotBaseline | null): string {
  if (baseline?.kind === 'usual') return 'Compared with the coffee you usually enjoy?';
  if (baseline?.kind === 'otherCoffee') return baseline.coffee ? `Compared with your last shot of ${baseline.coffee}?` : 'Compared with your last shot?';
  return 'Compared with your previous shot?';
}

/** The Mode control's raised track (DESIGN.md), the card's width in five even segments, so the words read as one scale. */
const trackSx: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: `repeat(${SHOT_VERDICTS.length}, minmax(0, 1fr))`,
  gap: '4px',
  p: '4px',
  bgcolor: 'cafai.raised',
  borderRadius: '14px',
};

/** A segment: at least 48 px tall, its word wrapping inside it on a phone; the chosen one paper-coloured with an ink word. */
const segmentSx: SxProps<Theme> = (theme) => ({
  minWidth: 0,
  minHeight: 48,
  px: 0.5,
  py: 0.5,
  borderRadius: '10px',
  color: 'text.secondary',
  fontSize: '0.9375rem',
  fontWeight: 600,
  lineHeight: 1.2,
  letterSpacing: '0.005em',
  textAlign: 'center',
  overflowWrap: 'break-word',
  transition: theme.transitions.create(['background-color', 'color', 'box-shadow'], { duration: theme.transitions.duration.shorter }),
  '&[aria-checked="true"]': {
    bgcolor: 'background.paper',
    color: 'text.primary',
    boxShadow: `0 1px 2px rgba(0, 0, 0, ${theme.palette.mode === 'dark' ? 0.35 : 0.14})`,
  },
  // Disabled only while the coach works: MUI's faded look, as for any control held for the moment.
  '&.Mui-disabled': { color: 'action.disabled' },
});

/**
 * "Compared with your previous shot?" (D126): five words from much worse to
 * much better, a radio group. The arrow keys move the answer as in any radio
 * group: right and down to the next word (towards better), left and up to
 * the previous one (towards worse); only the chosen word, or About the same before there is
 * one, takes Tab focus. Each word is a 48 px target.
 */
function ComparisonRating({
  verdict,
  baseline,
  disabled,
  onRate,
}: {
  verdict: ShotVerdict | null;
  baseline: ShotBaseline | null;
  disabled: boolean;
  onRate(verdict: ShotVerdict): void;
}) {
  const labelId = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const current = verdict === null ? -1 : SHOT_VERDICTS.indexOf(verdict);
  const rate = (index: number) => {
    const next = SHOT_VERDICTS[index];
    if (!next) return;
    onRate(next);
    buttons.current[index]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (disabled) return;
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = Math.min(SHOT_VERDICTS.length - 1, Math.max(0, (current < 0 ? MIDDLE : current) + step));
    if (next !== current) rate(next);
  };
  return (
    <Box sx={{ mt: 1 }}>
      <Typography id={labelId} variant="body2" sx={{ color: 'text.secondary', mb: 0.75 }}>
        {comparisonQuestion(baseline)}
      </Typography>
      <Box role="radiogroup" aria-labelledby={labelId} data-testid={TID.shotRating} onKeyDown={onKeyDown} sx={trackSx}>
        {SHOT_VERDICTS.map((value, index) => (
          <ButtonBase
            key={value}
            ref={(element: HTMLButtonElement | null) => {
              buttons.current[index] = element;
            }}
            role="radio"
            aria-checked={index === current}
            tabIndex={index === (current < 0 ? MIDDLE : current) ? 0 : -1}
            disabled={disabled}
            onClick={() => rate(index)}
            sx={segmentSx}
          >
            {SHOT_VERDICT_WORDS[value]}
          </ButtonBase>
        ))}
      </Box>
    </Box>
  );
}

export interface ShotCardProps {
  summary: ShotSummary;
  /** What the barista compares the shot with (D126); the question names it. */
  baseline?: ShotBaseline | null;
  /** The barista's verdict against it; null or absent until rated. */
  verdict?: ShotVerdict | null;
  /** A 1-5 star rating given before D126: said as it was, with no question. */
  stars?: number | null;
  /** Rate the shot. Without it the card shows no rating. */
  onRate?: (verdict: ShotVerdict) => void;
  /** True while the coach is working; blocks a rating tap and a TDS save. */
  disabled?: boolean;
  /** Opens the shot's full graph (#/shot). Without it the card shows no Graph link. */
  onOpenGraph?: () => void;
  /** The shot's page on Visualizer, once Decaid's Visualizer plugin uploaded it (6.4). */
  visualizerUrl?: string | null;
  /** Keep the barista's TDS (%) or remove it (null) (D162). Without it the card shows a reading it has, and no Add. */
  onSaveTds?: (tdsPct: number | null) => void;
}

/** A finished shot at a glance: the numbers the coach reasons about, its curves, and the barista's verdict. */
export function ShotCard({
  summary,
  baseline = null,
  verdict = null,
  stars = null,
  onRate,
  disabled = false,
  onOpenGraph,
  visualizerUrl = null,
  onSaveTds,
}: ShotCardProps) {
  // The shot time is the pour, so every other time counts from its start too:
  // a peak "at 61 s" of a 60 s shot would come after the shot ended.
  const peakAt = pourTime(summary.peakPressureAtS, summary.pourStartS);
  const firstDrop = pourTime(summary.timeToFirstDropS, summary.pourStartS);
  const peak =
    summary.peakPressureBar === null
      ? formatBar(null)
      : peakAt === null
        ? formatBar(summary.peakPressureBar)
        : `${formatBar(summary.peakPressureBar)} at ${Math.round(peakAt)} s`;
  return (
    <Paper variant="outlined" data-testid={TID.shotCard} sx={{ p: 1.5, my: 0.5, bgcolor: 'background.paper' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <LocalCafeIcon fontSize="small" sx={{ color: 'primary.main' }} />
        <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>
          Shot {formatSeconds(summary.durationS)}
        </Typography>
        {summary.profileTitle ? (
          <Typography variant="body2" noWrap sx={{ color: 'text.secondary', minWidth: 0 }}>
            · {summary.profileTitle}
          </Typography>
        ) : null}
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', columnGap: 2, rowGap: 1 }}>
        <Metric label="Dose → yield" value={`${formatGrams(summary.doseG)} → ${formatGrams(summary.yieldG)}`} />
        <Metric label="Ratio" value={formatRatio(shotRatio(summary))} />
        <Metric label="Peak pressure" value={peak} />
        <Metric label="First drop" value={formatSeconds(firstDrop)} />
        <ShotTds summary={summary} onSave={onSaveTds} busy={disabled} />
      </Box>
      {/* The shot under is the one the question below names (D178): none where the card asks nothing. */}
      <ShotSparkline summary={summary} baseline={onRate && stars === null ? baseline : null} onOpenGraph={onOpenGraph} />
      {summary.channelingFlags.length > 0 ? (
        <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'flex-start', color: 'warning.main' }}>
          <WarningAmberIcon fontSize="small" sx={{ mt: 0.25 }} />
          <Typography variant="body2">
            Possible channeling: {summary.channelingFlags.map(describeChannelingFlag).join('; ')}.
          </Typography>
        </Stack>
      ) : null}
      <VisualizerLink url={visualizerUrl} />
      {!onRate ? null : stars !== null ? (
        // Rated before shots were compared: the stars stay as given, words or not, as rating does (D126).
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
          You rated it {stars} of 5 stars.
        </Typography>
      ) : (
        <ComparisonRating verdict={verdict} baseline={baseline} disabled={disabled} onRate={onRate} />
      )}
    </Paper>
  );
}
