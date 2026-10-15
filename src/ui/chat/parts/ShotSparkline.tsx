/**
 * A shot card's curves: pressure and flow on Decent's 0-12 scale, their keys
 * beside them, and the newest shot's Graph link; under them, faint, the shot
 * the card's question asks about (D-CURVE-1 to D-CURVE-5).
 *
 * The shot under is a pale band in each line's own hue, wider than the line
 * and under it, so the two tell apart by form and lightness as well as by
 * what the key says; the key is a third one, a pale band, named for it
 * ("Previous shot", "Last shot of Red Brick"). Its curve comes from its card
 * in the chat, or once from Decaid (useComparison.ts); without one the card
 * draws its own shot alone, as before.
 *
 * Both shots count from the pour's start, so they line up whatever their
 * preheat, and the time runs to the longer of the two.
 */
import { useId, useMemo } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import type { ShotBaseline } from '../../../app/types.ts';
import type { ShotSummary } from '../../../coach/types.ts';
import { comparisonTarget, describeShot, pourCurve, underThem } from '../../compare/comparison.ts';
import { GuideSwatch } from '../../compare/GuideKey.tsx';
import { useComparisonSummary } from '../../compare/useComparison.ts';
import { TID } from '../../testIds.ts';
import { sparklinePath } from '../sparkline.ts';

const SPARK_WIDTH = 240;
const SPARK_HEIGHT = 48;
// Bar and ml/s share one 0-12 axis, as on Decent's own shot graphs.
const SPARK_Y_MAX = 12;
/** The band of the shot under, in CSS px: two and a half times this shot's 2 px lines. */
const GUIDE_WIDTH = 5;

const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
} as const;

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

/** The third key: the band's form, and the shot it stands for, cut short on a narrow card rather than squeezing the curves. */
function GuideLegendKey({ name }: { name: string }) {
  return (
    <Stack direction="row" spacing={0.75} data-testid={TID.shotGuideKey} sx={{ alignItems: 'center', minWidth: 0 }}>
      <GuideSwatch />
      <Typography variant="caption" noWrap sx={{ color: 'text.secondary', lineHeight: 1.3, maxWidth: '9.5em' }}>
        {name}
      </Typography>
    </Stack>
  );
}

export interface ShotSparklineProps {
  summary: ShotSummary;
  /** What the card's question compares the shot with (D126): the shot drawn under it, when there is one. */
  baseline?: ShotBaseline | null;
  /** Opens the shot's full graph (#/shot). Without it there is no Graph link. */
  onOpenGraph?: () => void;
}

export function ShotSparkline({ summary, baseline = null, onOpenGraph }: ShotSparklineProps) {
  const theme = useTheme();
  const descriptionId = useId();
  const target = useMemo(() => comparisonTarget(baseline), [baseline]);
  const previous = useComparisonSummary(target);
  const own = pourCurve(summary);
  const under = previous !== null && previous.shotId !== summary.shotId ? pourCurve(previous) : null;
  const box = {
    width: SPARK_WIDTH,
    height: SPARK_HEIGHT,
    tMax: Math.max(own.endS, summary.durationS, under?.endS ?? 0),
    yMax: SPARK_Y_MAX,
  };
  const pressure = sparklinePath(own.t, own.pressure, box);
  const flow = sparklinePath(own.t, own.flow, box);
  if (!pressure && !flow) return null;
  const guidePressure = under ? sparklinePath(under.t, under.pressure, box) : '';
  const guideFlow = under ? sparklinePath(under.t, under.flow, box) : '';
  const guided = target !== null && previous !== null && (guidePressure !== '' || guideFlow !== '');
  const { graph } = theme.palette.cafai;
  const band = { fill: 'none', strokeWidth: GUIDE_WIDTH, vectorEffect: 'non-scaling-stroke', strokeLinejoin: 'round', strokeLinecap: 'round' } as const;
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mt: 1 }}>
      <Box
        component="svg"
        role="img"
        aria-label={guided ? `Pressure and flow during the shot, ${underThem(target)}` : 'Pressure and flow during the shot'}
        aria-describedby={guided ? descriptionId : undefined}
        viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
        preserveAspectRatio="none"
        sx={{ flex: 1, minWidth: 0, maxWidth: 360, height: SPARK_HEIGHT, display: 'block', overflow: 'visible' }}
      >
        <line x1={0} y1={SPARK_HEIGHT} x2={SPARK_WIDTH} y2={SPARK_HEIGHT} stroke={theme.palette.divider} strokeWidth={1} />
        {guided ? (
          <g data-testid={TID.shotGuide}>
            {guideFlow ? <path d={guideFlow} stroke={graph.flowGuide} {...band} /> : null}
            {guidePressure ? <path d={guidePressure} stroke={graph.pressureGuide} {...band} /> : null}
          </g>
        ) : null}
        {flow ? (
          <path d={flow} fill="none" stroke={graph.flow} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        ) : null}
        {pressure ? (
          <path d={pressure} fill="none" stroke={graph.pressure} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        ) : null}
      </Box>
      {guided ? (
        <Box component="span" id={descriptionId} sx={visuallyHidden}>
          {describeShot(target, previous)}
        </Box>
      ) : null}
      <Stack spacing={0.25} sx={{ flexShrink: 0, minWidth: 0 }}>
        <LegendKey color={graph.pressure} label="Pressure" />
        <LegendKey color={graph.flow} label="Flow" />
        {guided ? <GuideLegendKey name={target.name} /> : null}
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
