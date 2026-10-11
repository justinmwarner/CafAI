import { useId, useRef, type KeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import LocalCafeIcon from '@mui/icons-material/LocalCafe';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { isVisualizerShotUrl } from '../../../api/pluginData.ts';
import { pourTime } from '../../../coach/summary/pourClock.ts';
import type { ShotSummary } from '../../../coach/types.ts';
import { TID } from '../../testIds.ts';
import { describeChannelingFlag, formatBar, formatGrams, formatRatio, formatSeconds, shotRatio } from '../format.ts';
import { sparklinePath } from '../sparkline.ts';

const SPARK_WIDTH = 240;
const SPARK_HEIGHT = 48;
// Bar and ml/s share one 0-12 axis, as on Decent's own shot graphs.
const SPARK_Y_MAX = 12;

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

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
      <Box component="span" aria-hidden sx={{ width: 12, height: 3, borderRadius: 1, bgcolor: color, flexShrink: 0 }} />
      <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.3 }}>
        {label}
      </Typography>
    </Stack>
  );
}

function Sparkline({ summary, onOpenGraph }: { summary: ShotSummary; onOpenGraph?: () => void }) {
  const theme = useTheme();
  const { series } = summary;
  const lastT = series.tS.length > 0 ? (series.tS[series.tS.length - 1] ?? 0) : 0;
  const box = { width: SPARK_WIDTH, height: SPARK_HEIGHT, tMax: Math.max(summary.durationS, lastT), yMax: SPARK_Y_MAX };
  const pressure = sparklinePath(series.tS, series.pressure, box);
  const flow = sparklinePath(series.tS, series.flow, box);
  if (!pressure && !flow) return null;
  const pressureColor = theme.palette.cafai.graph.pressure;
  const flowColor = theme.palette.cafai.graph.flow;
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mt: 1 }}>
      <Box
        component="svg"
        role="img"
        aria-label="Pressure and flow during the shot"
        viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
        preserveAspectRatio="none"
        sx={{ flex: 1, minWidth: 0, maxWidth: 360, height: SPARK_HEIGHT, display: 'block', overflow: 'visible' }}
      >
        <line x1={0} y1={SPARK_HEIGHT} x2={SPARK_WIDTH} y2={SPARK_HEIGHT} stroke={theme.palette.divider} strokeWidth={1} />
        {flow ? (
          <path d={flow} fill="none" stroke={flowColor} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        ) : null}
        {pressure ? (
          <path d={pressure} fill="none" stroke={pressureColor} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        ) : null}
      </Box>
      <Stack spacing={0.25} sx={{ flexShrink: 0 }}>
        <LegendKey color={pressureColor} label="Pressure" />
        <LegendKey color={flowColor} label="Flow" />
      </Stack>
      {onOpenGraph ? (
        <Button
          variant="text"
          color="primary"
          endIcon={<ChevronRightRoundedIcon />}
          data-testid={TID.openShotGraph}
          onClick={onOpenGraph}
          sx={{ minHeight: 48, flexShrink: 0 }}
        >
          Graph
        </Button>
      ) : null}
    </Stack>
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

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * "How much did you enjoy it?": five 48 px stars, a radio group (arrow keys
 * move the rating; only the rated star, or the first, takes Tab focus).
 */
function StarRating({ stars, disabled, onRate }: { stars: number | null; disabled: boolean; onRate(stars: number): void }) {
  const labelId = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const current = stars ?? 0;
  const rate = (value: number) => {
    onRate(value);
    buttons.current[value - 1]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (disabled) return;
    const step = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    // Unrated, either arrow starts at one star.
    rate(current === 0 ? 1 : Math.min(5, Math.max(1, current + step)));
  };
  return (
    <Stack direction="row" useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', columnGap: 1, mt: 0.5 }}>
      <Typography id={labelId} variant="body2" sx={{ color: 'text.secondary' }}>
        How much did you enjoy it?
      </Typography>
      <Box role="radiogroup" aria-labelledby={labelId} onKeyDown={onKeyDown} sx={{ display: 'flex' }}>
        {STARS.map((value) => {
          const lit = value <= current;
          return (
            <IconButton
              key={value}
              ref={(element) => {
                buttons.current[value - 1] = element;
              }}
              role="radio"
              aria-checked={value === current}
              aria-label={`Rate ${value} out of 5`}
              tabIndex={value === (current || 1) ? 0 : -1}
              disabled={disabled}
              onClick={() => rate(value)}
              sx={{ width: 48, height: 48, color: lit ? 'warning.main' : 'text.secondary' }}
            >
              {lit ? <StarIcon /> : <StarBorderIcon />}
            </IconButton>
          );
        })}
      </Box>
    </Stack>
  );
}

export interface ShotCardProps {
  summary: ShotSummary;
  /** The barista's 1-5 star rating; null or absent until rated. */
  stars?: number | null;
  /** Rate the shot. Without it the card shows no rating. */
  onRate?: (stars: number) => void;
  /** True while the coach is working; blocks a rating tap. */
  disabled?: boolean;
  /** Opens the shot's full graph (#/shot). Without it the card shows no Graph link. */
  onOpenGraph?: () => void;
  /** The shot's page on Visualizer, once Decaid's Visualizer plugin uploaded it (6.4). */
  visualizerUrl?: string | null;
}

/** A finished shot at a glance: the numbers the coach reasons about, its curves, and the barista's rating. */
export function ShotCard({ summary, stars = null, onRate, disabled = false, onOpenGraph, visualizerUrl = null }: ShotCardProps) {
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
      </Box>
      <Sparkline summary={summary} onOpenGraph={onOpenGraph} />
      {summary.channelingFlags.length > 0 ? (
        <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'flex-start', color: 'warning.main' }}>
          <WarningAmberIcon fontSize="small" sx={{ mt: 0.25 }} />
          <Typography variant="body2">
            Possible channeling: {summary.channelingFlags.map(describeChannelingFlag).join('; ')}.
          </Typography>
        </Stack>
      ) : null}
      <VisualizerLink url={visualizerUrl} />
      {onRate ? <StarRating stars={stars} disabled={disabled} onRate={onRate} /> : null}
    </Paper>
  );
}
