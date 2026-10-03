import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import LocalCafeIcon from '@mui/icons-material/LocalCafe';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
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
      <Typography variant="caption" component="div" sx={{ color: 'text.secondary', lineHeight: 1.2 }}>
        {label}
      </Typography>
      <Typography variant="body1" component="div" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
        {value}
      </Typography>
    </Box>
  );
}

function Sparkline({ summary }: { summary: ShotSummary }) {
  const theme = useTheme();
  const { series } = summary;
  const lastT = series.tS.length > 0 ? (series.tS[series.tS.length - 1] ?? 0) : 0;
  const box = { width: SPARK_WIDTH, height: SPARK_HEIGHT, tMax: Math.max(summary.durationS, lastT), yMax: SPARK_Y_MAX };
  const pressure = sparklinePath(series.tS, series.pressure, box);
  const flow = sparklinePath(series.tS, series.flow, box);
  if (!pressure && !flow) return null;
  const pressureColor = theme.palette.success.main;
  const flowColor = theme.palette.info.main;
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
        <Typography variant="caption" sx={{ color: pressureColor, lineHeight: 1.3 }}>
          ━ Pressure
        </Typography>
        <Typography variant="caption" sx={{ color: flowColor, lineHeight: 1.3 }}>
          ━ Flow
        </Typography>
      </Stack>
    </Stack>
  );
}

/** A finished shot at a glance: the numbers the coach reasons about, plus its curves. */
export function ShotCard({ summary }: { summary: ShotSummary }) {
  const peak =
    summary.peakPressureBar === null
      ? formatBar(null)
      : summary.peakPressureAtS === null
        ? formatBar(summary.peakPressureBar)
        : `${formatBar(summary.peakPressureBar)} at ${Math.round(summary.peakPressureAtS)} s`;
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
        <Metric label="First drop" value={formatSeconds(summary.timeToFirstDropS)} />
      </Box>
      <Sparkline summary={summary} />
      {summary.channelingFlags.length > 0 ? (
        <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'flex-start', color: 'warning.main' }}>
          <WarningAmberIcon fontSize="small" sx={{ mt: 0.25 }} />
          <Typography variant="body2">
            Possible channeling: {summary.channelingFlags.map(describeChannelingFlag).join('; ')}.
          </Typography>
        </Stack>
      ) : null}
    </Paper>
  );
}
