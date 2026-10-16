/**
 * A shot card's curves: pressure and flow on Decent's 0-12 scale, their keys
 * beside them, and the newest shot's Graph link; under them, faint, the shot
 * the card's question asks about (D178-D182).
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
 *
 * The third key never squeezes the curves and never cuts its name short:
 * on a narrow card (a phone upright), and on any card whose key names a
 * coffee too long for the legend ("Last shot of Huila Pink Bourbon"), it
 * takes a line of its own under them, where its name has the card's width,
 * and the curves keep the room they have without it.
 */
import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
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

/**
 * The narrowest card (its content box, in CSS px) that keeps the third key
 * beside the curves: 120 px of curves, 12 px, the legend at its widest (the
 * band, 6 px and a name of 9.5em of 13 px: 141.5 px), 12 px and the Graph
 * link (85 px). A narrower card puts the key under the curves. The Graph link
 * counts whether a card shows it or not, so a card's key keeps its place as
 * Graph moves on to the newest card.
 */
export const KEY_BESIDE_FROM = 372;

/** The widest the third key's name may be beside the curves, in ems of its own size (D180): the legend keeps its share of the card. */
export const NAME_BESIDE_EM = 9.5;

/**
 * Whether the third key takes a line under the curves: on a card too narrow
 * to keep them 120 px beside the widest legend (D192), and on any card when
 * its whole name, set on one line, is wider than NAME_BESIDE_EM (D208),
 * so beside them the name is never cut. `nameWidth` is that natural width
 * and `fontSize` the name's, both in CSS px. Before a measurement, and in
 * jsdom, which has no layout, the card's width is 0: the key stays beside.
 */
export function keyUnderCurves(cardWidth: number, nameWidth: number, fontSize: number): boolean {
  if (cardWidth <= 0) return false;
  if (cardWidth < KEY_BESIDE_FROM) return true;
  return nameWidth > NAME_BESIDE_EM * fontSize;
}

/**
 * Where the third key goes, from the card's own width and the name's natural
 * width (keyUnderCurves). The name is measured on its ruler, never where the
 * key is, so moving the key cannot change the measurement and the key cannot
 * swing between its places. Measured before the first paint, and again when
 * the card's width changes (a rotation) or the ruler's (the font arriving),
 * as useOwnLayout.ts measures: the Chromium 91 WebView has no container
 * queries.
 */
function useKeyUnderCurves(card: RefObject<HTMLElement | null>, ruler: RefObject<HTMLElement | null>, name: string | null): boolean {
  const [under, setUnder] = useState(false);
  useLayoutEffect(() => {
    const box = card.current;
    if (!box) return;
    const measure = () => {
      const text = ruler.current;
      const nameWidth = text ? text.getBoundingClientRect().width : 0;
      const fontSize = text ? Number.parseFloat(getComputedStyle(text).fontSize) : 0;
      setUnder(keyUnderCurves(box.clientWidth, nameWidth, fontSize));
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (observer) {
      observer.observe(box);
      if (ruler.current) observer.observe(ruler.current);
    } else {
      window.addEventListener('resize', measure);
    }
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
    // The name is not read here: a new one is set on the ruler, which is then measured again.
  }, [card, ruler, name]);
  return under;
}

/** Out of the layout and out of sight: a box of no size that clips what it holds. */
const rulerBoxSx = { position: 'absolute', width: 0, height: 0, overflow: 'hidden', visibility: 'hidden' } as const;

/**
 * The third key's name once more, in its font, on one line and with no
 * width to keep to: its natural width, whatever the key's place. Hidden from
 * sight and from screen readers, and it takes no room.
 */
function NameRuler({ name, ruler }: { name: string; ruler: RefObject<HTMLSpanElement | null> }) {
  return (
    <Box component="span" aria-hidden sx={rulerBoxSx}>
      <Typography ref={ruler} variant="caption" sx={{ display: 'inline-block', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
        {name}
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

/**
 * The third key: the band's form, and the shot it stands for. Beside the
 * curves its name is whole within the legend's 9.5em (a longer one goes
 * under them), so the legend never takes more than its share of the card;
 * under them it has the card's width, and is cut only beyond it.
 */
function GuideLegendKey({ name, under }: { name: string; under: boolean }) {
  return (
    <Stack direction="row" spacing={0.75} data-testid={TID.shotGuideKey} sx={{ alignItems: 'center', minWidth: 0, mt: under ? 0.5 : 0 }}>
      <GuideSwatch />
      <Typography variant="caption" noWrap sx={{ color: 'text.secondary', lineHeight: 1.3, maxWidth: under ? 'none' : `${NAME_BESIDE_EM}em` }}>
        {name}
      </Typography>
    </Stack>
  );
}

/**
 * The curves, their keys and the Graph link, laid out for the card's own
 * width and the third key's name (useKeyUnderCurves). The curves take the
 * room the keys and the link leave, up to 360 px; the third key sits under
 * the Pressure and Flow keys when the card is wide and its name fits there
 * whole, and on a line of its own under the curves otherwise.
 */
function CurvesRow({ curves, guideName, graph }: { curves: ReactNode; guideName: string | null; graph: ReactNode }) {
  const colors = useTheme().palette.cafai.graph;
  const box = useRef<HTMLDivElement | null>(null);
  const ruler = useRef<HTMLSpanElement | null>(null);
  const under = useKeyUnderCurves(box, ruler, guideName);
  const guideKey = guideName === null ? null : <GuideLegendKey name={guideName} under={under} />;
  return (
    <Box ref={box} sx={{ mt: 1 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        {curves}
        <Stack spacing={0.25} sx={{ flexShrink: 0, minWidth: 0 }}>
          <LegendKey color={colors.pressure} label="Pressure" />
          <LegendKey color={colors.flow} label="Flow" />
          {under ? null : guideKey}
        </Stack>
        {graph}
      </Stack>
      {under ? guideKey : null}
      {guideName === null ? null : <NameRuler name={guideName} ruler={ruler} />}
    </Box>
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
  const previous = useComparisonSummary(target, summary.shotId);
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
  const curves = (
    <>
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
        // Hidden, so a screen reader hears it once, as the curves' description, and not again as text.
        <span id={descriptionId} hidden>
          {describeShot(target, previous)}
        </span>
      ) : null}
    </>
  );
  const graphLink = onOpenGraph ? (
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
  ) : null;
  return <CurvesRow curves={curves} guideName={guided ? target.name : null} graph={graphLink} />;
}
