/**
 * Settings > Coach > Usage and cost (D239): what the coach has used, from
 * the spend service (src/spend/), every device that uses this Decaid added
 * together, as the bill does (D238).
 *
 * On the API key, "Usage and cost": the month's estimated cost large, with
 * its tokens and replies; a bar for each day of the month so far (today in
 * ink, the rest in the accent, the tallest day the scale, each named with its
 * day and cost for assistive tech); today, last month and all time; what the
 * month went on, each with a meter of its share; the monthly budget
 * (BudgetControls.tsx); and where the count comes from. A month that also ran
 * on the computer says how many tokens that was and what they would have
 * cost on the API; a model typed by hand, whose price CafAI does not know, is
 * named, its cost left out.
 *
 * While the coach runs on the computer, "Usage": the plan pays, so there are
 * no dollars of its own; the plan's use this 5 hours and this week, from
 * CafAI Bridge's status without a probe (so no test reply is spent), read
 * when the card shows and every 60 s while it stays, and nothing of it when
 * the bridge cannot be reached; the month's tokens and today's, and what the
 * same replies would cost on the API; and what the API key spent this month,
 * if it did.
 *
 * It reads Decaid's copy of every device's counts when it shows
 * (spend.refresh()), and comes into view when the pause card's Open Settings
 * asked (src/spend/reveal.ts). It shows nothing until it knows where the
 * coach runs, so the API key's card never flashes up on the computer. Every
 * number is in tabular figures, so nothing moves as it counts. Without a
 * spend service (previews) it draws nothing.
 */
import { useEffect, useId, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useClockFormat, useServices } from '../../app/services.tsx';
import { getBridgeStatus, type BridgeStatus, type BridgeUsageWindow } from '../../llm/bridgeClient.ts';
import { PRICES_AS_OF } from '../../llm/models.ts';
import { dayOf } from '../../spend/records.ts';
import { takeUsageReveal } from '../../spend/reveal.ts';
import type { SpendPeriod, SpendSummary } from '../../spend/types.ts';
import { useSpendSummary } from '../../spend/useSpend.ts';
import { normalizeAddress, normalizeCode } from '../../storage/coachSource.ts';
import { revealInOwnColumn } from '../care/careReveal.ts';
import { formatTime, type ClockFormat } from '../clock.ts';
import { DASH } from '../machine/format.ts';
import { BudgetControls } from './BudgetControls.tsx';
import { useCoachRunsOnComputer, useShowsApiKey } from './coachSourceView.ts';
import { Section, useSubheadingLevel } from './Section.tsx';
import { formatCost, formatPercent, formatTokens, sayDate, sayDay } from './usageFormat.ts';
import { UsageMeter } from './UsageMeter.tsx';
import { describeWhen } from './wakeSchedule.ts';
import { TID } from '../testIds.ts';

/** The tiles of the month, today and the rest: the API key's in dollars, the computer's in tokens. */
type UsagePeriod = 'today' | 'last-month' | 'all-time' | 'month-tokens' | 'today-tokens' | 'on-api';
type PlanWindowId = 'five-hour' | 'seven-day';

/** The card's test ids, as kept with the rest in TID (src/ui/testIds.ts). */
export const USAGE_CARD_TID = {
  card: TID.coachUsage,
  /** The month's estimated cost (the API key's). */
  cost: TID.coachUsageCost,
  /** The line under it: its tokens and replies, or nothing yet. */
  summary: TID.coachUsageSummary,
  /** What the other place spent this month: the computer's tokens on the API key, the API key's dollars on the computer. */
  also: TID.coachUsageAlso,
  unpriced: TID.coachUsageUnpriced,
  days: TID.coachUsageDays,
  /** Each tile: today, last-month, all-time on the API key; month-tokens, today-tokens, on-api on the computer. */
  period: (period: UsagePeriod) => TID.coachUsagePeriod(period),
  kinds: TID.coachUsageKinds,
  /** The plan's use on the computer, and each of its windows. */
  plan: TID.coachUsagePlan,
  planWindow: (window: PlanWindowId) => TID.coachUsagePlanWindow(window),
} as const;

/** The plan's use is read again this often while the card shows. */
export const PLAN_EVERY_MS = 60_000;
/** A bridge on the local network answers its status at once; one that does not is as good as away. */
const PLAN_TIMEOUT_MS = 10_000;

const NBSP = '\xa0';
const NOTHING_YET = 'Nothing yet this month.';
const NOTHING_ON_KEY = 'Nothing on your API key yet this month.';
const PLAN_PAYS = 'The coach runs on your Claude plan, so there is nothing to pay per reply.';
const NO_PLAN_USE_YET = "Your plan's use shows here after the coach's next reply on your computer.";
const PLAN_LIMIT = "The plan's limit is reached for now. The coach answers again once it resets.";
/** The bridge's status says what Claude Code reported with the last run, not when: that run was the coach's last reply. */
const PLAN_REPORTED = "As Claude Code reported them with the coach's last reply.";
const PLAN_REPORTED_ONE = "As Claude Code reported it with the coach's last reply.";

const COUNTED = `Counted on every device that uses this Decaid, at Anthropic's prices of ${sayDate(PRICES_AS_OF)}.`;
const BILL = "Your bill is in Anthropic's Console.";

const KINDS: ReadonlyArray<{ kind: keyof SpendPeriod['byKind']; label: string }> = [
  { kind: 'reply', label: 'Replies to you' },
  { kind: 'shot', label: 'Replies after shots' },
  { kind: 'photo', label: 'Bag photos' },
  { kind: 'web', label: 'Web searches' },
];

const mutedSx = { color: 'text.secondary' } as const;
const tabularSx = { fontVariantNumeric: 'tabular-nums' } as const;
const mutedNumbersSx = { ...mutedSx, ...tabularSx } as const;

/** Read by assistive tech, not drawn. */
const visuallyHidden = {
  position: 'absolute',
  // Strings: in sx a bare 1 is 100%.
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
} as const;

type Place = 'anthropic' | 'computer';

/**
 * Where the coach runs, once known: null until it has been read, so neither
 * card flashes up first. While it is read again after a change, each of the
 * two answers comes in its own time; the card keeps the one it showed until
 * the new place is known, rather than vanish for a moment.
 */
function useUsageSource(): Place | null {
  const onComputer = useCoachRunsOnComputer();
  const showsKey = useShowsApiKey();
  const known: Place | null = onComputer ? 'computer' : showsKey ? 'anthropic' : null;
  const [last, setLast] = useState<Place | null>(known);
  if (known !== null && known !== last) setLast(known);
  return known ?? last;
}

/** Today, moved on at midnight: the bars and the totals turn to the new day (and month) while the card stays open. */
function useToday(): Date {
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const timer = setTimeout(() => setToday(new Date()), Math.max(1_000, midnight.getTime() - Date.now() + 1_000));
    return () => clearTimeout(timer);
  }, [today]);
  return today;
}

/**
 * CafAI Bridge's status, for the plan's use: read now, every 60 s while the
 * card shows (not while the page is hidden; again as it comes back), and
 * whenever the address or code is saved. Never a probe, so no test reply is
 * spent. Null until read, and whenever the bridge cannot be reached or the
 * address and code are not set.
 */
function usePlanStatus(): BridgeStatus | null {
  const { coachSource } = useServices();
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  useEffect(() => {
    if (!coachSource) return undefined;
    let live = true;
    let latest = 0;
    const read = async () => {
      const ticket = ++latest;
      const settle = (next: BridgeStatus | null) => {
        if (live && ticket === latest) setStatus(next);
      };
      const source = await coachSource.get().catch(() => null);
      const where = source ? normalizeAddress(source.address) : null;
      const code = source ? normalizeCode(source.code) : null;
      if (!source || source.kind !== 'computer' || !where?.ok || !code?.ok) {
        settle(null);
        return;
      }
      const result = await getBridgeStatus({ baseUrl: where.baseUrl, code: code.code, probe: false, timeoutMs: PLAN_TIMEOUT_MS });
      settle(result.ok ? result.status : null);
    };
    void read();
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void read();
    }, PLAN_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void read();
    };
    document.addEventListener('visibilitychange', onVisible);
    const stop = coachSource.subscribe(() => void read());
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      stop();
    };
  }, [coachSource]);
  return status;
}

function unpricedLine(models: readonly string[]): string | null {
  if (models.length === 0) return null;
  const names = models.length === 1 ? models[0] : `${models.slice(0, -1).join(', ')} and ${models[models.length - 1]}`;
  return `Price not known for ${names}, so ${models.length === 1 ? 'its' : 'their'} cost is left out.`;
}

function Unpriced({ models }: { models: readonly string[] }) {
  const line = unpricedLine(models);
  return line ? (
    <Typography variant="body2" sx={mutedSx} data-testid={USAGE_CARD_TID.unpriced}>
      {line}
    </Typography>
  ) : null;
}

function Footnote({ text }: { text: string }) {
  return (
    <Typography variant="caption" component="p" sx={mutedSx}>
      {text}
    </Typography>
  );
}

/**
 * A bar for each day of the month so far, in a slot for every day of the
 * month, so the bars keep their width all month and today stands where it
 * falls in it. The tallest day is the scale (by cost; by tokens in a month
 * whose every model's price is unknown); a day that spent anything shows at
 * least a sliver over the baseline.
 */
function DayBars({ month, days, today }: { month: string; days: SpendPeriod['days']; today: Date }) {
  const captionId = useId();
  const inMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const todayKey = dayOf(today);
  const soFar = todayKey.startsWith(`${month}-`) ? today.getDate() : inMonth;
  const held = new Map(days.map((day) => [day.day, day]));
  const list = Array.from({ length: soFar }, (_, index) => {
    const day = `${month}-${String(index + 1).padStart(2, '0')}`;
    return { day, costMicros: held.get(day)?.costMicros ?? 0, tokens: held.get(day)?.tokens ?? 0 };
  });
  const byCost = list.some((day) => day.costMicros > 0);
  const size = (day: (typeof list)[number]) => (byCost ? day.costMicros : day.tokens);
  const tallest = Math.max(0, ...list.map(size));
  return (
    <Box>
      <Box
        role="list"
        aria-labelledby={captionId}
        data-testid={USAGE_CARD_TID.days}
        sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(${inMonth}, minmax(0, 1fr))`,
          columnGap: '3px',
          alignItems: 'end',
          height: 56,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        {list.map((day) => {
          const share = tallest > 0 ? size(day) / tallest : 0;
          return (
            <Box role="listitem" key={day.day} sx={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'flex-end' }}>
              <Box
                aria-hidden
                className="usage-day-bar"
                sx={{
                  width: '100%',
                  height: `${Math.round(share * 1000) / 10}%`,
                  minHeight: size(day) > 0 ? 2 : 0,
                  bgcolor: day.day === todayKey ? 'text.primary' : 'primary.main',
                  borderRadius: '3px 3px 0 0',
                }}
              />
              <Box component="span" sx={visuallyHidden}>
                {`${sayDay(day.day)}: ${formatCost(day.costMicros)}`}
              </Box>
            </Box>
          );
        })}
      </Box>
      <Typography id={captionId} variant="caption" component="p" sx={{ ...mutedSx, mt: 0.5 }}>
        Each day this month
      </Typography>
    </Box>
  );
}

interface PeriodCell {
  id: UsagePeriod;
  label: string;
  value: string;
  /** Under the value, muted: what it counts ("tokens"). */
  unit?: string;
}

/** The periods side by side, each a label over its value on raised, as a list of terms and values. */
function Periods({ cells }: { cells: readonly PeriodCell[] }) {
  return (
    <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))`, gap: 1 }}>
      {cells.map((cell) => (
        <Box key={cell.id} data-testid={USAGE_CARD_TID.period(cell.id)} sx={{ minWidth: 0, bgcolor: 'cafai.raised', borderRadius: '12px', px: 1.25, py: 1 }}>
          <Typography component="dt" variant="label" sx={{ ...mutedSx, display: 'block' }}>
            {cell.label}
          </Typography>
          <Typography component="dd" variant="readout" sx={{ m: 0, mt: 0.25, whiteSpace: 'nowrap' }}>
            {cell.value}
          </Typography>
          {cell.unit ? (
            <Typography component="dd" variant="caption" sx={{ ...mutedSx, m: 0, display: 'block' }}>
              {cell.unit}
            </Typography>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}

/** What the month went on: each kind's cost, a meter of its share of the month, and that share said for assistive tech. */
function WentOn({ byKind, total }: { byKind: SpendPeriod['byKind']; total: number }) {
  const headingId = useId();
  // Under the card's title: an h3 under a phone's h2, an h4 in a tablet's pane.
  const subheading = useSubheadingLevel();
  return (
    <Box>
      <Typography id={headingId} variant="subtitle2" component={subheading}>
        What it went on
      </Typography>
      <Box role="list" aria-labelledby={headingId} data-testid={USAGE_CARD_TID.kinds} sx={{ display: 'grid', gap: 1.25, mt: 1 }}>
        {KINDS.map(({ kind, label }) => {
          const share = total > 0 ? byKind[kind] / total : 0;
          return (
            <Box
              role="listitem"
              key={kind}
              sx={{ position: 'relative', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 1.5, rowGap: 0.5, alignItems: 'baseline' }}
            >
              <Typography variant="body2">{label}</Typography>
              <Typography variant="body2" sx={tabularSx}>
                {formatCost(byKind[kind])}
              </Typography>
              <Box sx={{ gridColumn: '1 / -1' }}>
                <UsageMeter share={share} />
              </Box>
              <Box component="span" sx={visuallyHidden}>
                {` (${formatPercent(share)} of this month)`}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function monthLine(month: SpendPeriod): string {
  return `estimated this month · ${formatTokens(month.tokens)} tokens · ${month.replies} ${month.replies === 1 ? 'reply' : 'replies'}`;
}

function ApiUsage({ summary, today }: { summary: SpendSummary; today: Date }) {
  const { month, lastMonth, allTime } = summary.anthropic;
  const computer = summary.computer.month;
  const empty = month.requests === 0;
  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="readoutLarge" component="p" data-testid={USAGE_CARD_TID.cost}>
          {formatCost(month.costMicros)}
        </Typography>
        <Typography variant="body2" sx={{ ...mutedNumbersSx, mt: 0.5 }} data-testid={USAGE_CARD_TID.summary}>
          {empty ? (computer.requests > 0 ? NOTHING_ON_KEY : NOTHING_YET) : monthLine(month)}
        </Typography>
        {computer.requests > 0 ? (
          <Typography variant="body2" sx={mutedNumbersSx} data-testid={USAGE_CARD_TID.also}>
            {`Also ${formatTokens(computer.tokens)} tokens on your computer (≈${NBSP}${formatCost(computer.costMicros)} on the API).`}
          </Typography>
        ) : null}
        <Unpriced models={summary.unpricedModels} />
      </Box>
      {empty ? null : <DayBars month={summary.month} days={month.days} today={today} />}
      <Periods
        cells={[
          { id: 'today', label: 'Today', value: formatCost(summary.anthropic.today.costMicros) },
          { id: 'last-month', label: 'Last month', value: formatCost(lastMonth.costMicros) },
          { id: 'all-time', label: 'All time', value: formatCost(allTime.costMicros) },
        ]}
      />
      {empty ? null : <WentOn byKind={month.byKind} total={month.costMicros} />}
      <BudgetControls />
      <Footnote text={`${COUNTED} ${BILL}`} />
    </Stack>
  );
}

/** When a window starts again, as Claude Code reported it; null when it did not say, or said something unreadable. */
function resetOf(use: BridgeUsageWindow): Date | null {
  const reset = use.resetsAt === null ? null : new Date(use.resetsAt);
  return reset !== null && Number.isFinite(reset.getTime()) ? reset : null;
}

/** A window whose reset has passed since Claude Code reported it has started again: its old share no longer holds. */
function startedAgain(use: BridgeUsageWindow, now: Date): boolean {
  const reset = resetOf(use);
  return reset !== null && reset.getTime() <= now.getTime();
}

/** A window's share as the card shows it: a whole percent, 0 to 100. */
function percentOf(use: BridgeUsageWindow): number {
  return Math.min(100, Math.max(0, Math.round(use.utilization * 100)));
}

/**
 * One window of the plan's use: its share and a meter, and when it starts
 * again. A window whose reset has passed since Claude Code reported it has
 * started again, its old share no longer true: it says so, and shows none.
 */
function PlanWindow({ id, label, use, clock, now }: { id: PlanWindowId; label: string; use: BridgeUsageWindow; clock: ClockFormat; now: Date }) {
  const resets = resetOf(use);
  const started = startedAgain(use, now);
  const percent = percentOf(use);
  return (
    <Box
      data-testid={USAGE_CARD_TID.planWindow(id)}
      sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 1.5, rowGap: 0.5, alignItems: 'baseline' }}
    >
      <Typography variant="body2">{label}</Typography>
      <Typography variant="body2" sx={tabularSx}>
        {started ? DASH : `${percent}${NBSP}%`}
      </Typography>
      <Box sx={{ gridColumn: '1 / -1' }}>
        <UsageMeter share={started ? 0 : percent / 100} />
      </Box>
      {resets ? (
        <Typography variant="caption" component="p" sx={{ ...mutedNumbersSx, gridColumn: '1 / -1' }}>
          {started
            ? `Started again at ${formatTime(resets, clock)}: the coach's next reply updates it.`
            : `Resets ${describeWhen(resets, now, clock)}`}
        </Typography>
      ) : null}
    </Box>
  );
}

/** The Claude plan's use, as CafAI Bridge last heard it from Claude Code; nothing while the bridge cannot be reached. */
function PlanUse() {
  const status = usePlanStatus();
  const clock = useClockFormat();
  if (status === null) return null;
  const usage = status.usage;
  const reported = usage !== null && (usage.fiveHour !== undefined || usage.sevenDay !== undefined);
  const now = new Date();
  // Claude Code said no with the last reply; the limit still holds while a window it reported full has not started again.
  const atLimit =
    usage !== null &&
    usage.status === 'rejected' &&
    [usage.fiveHour, usage.sevenDay].some((use) => use !== undefined && !startedAgain(use, now) && percentOf(use) >= 100);
  return (
    <Box data-testid={USAGE_CARD_TID.plan} sx={{ display: 'grid', gap: 1.5 }}>
      {usage === null || !reported ? (
        <Typography variant="body2" sx={mutedSx}>
          {NO_PLAN_USE_YET}
        </Typography>
      ) : (
        <>
          {usage.fiveHour ? <PlanWindow id="five-hour" label="Plan, this 5 hours" use={usage.fiveHour} clock={clock} now={now} /> : null}
          {usage.sevenDay ? <PlanWindow id="seven-day" label="Plan, this week" use={usage.sevenDay} clock={clock} now={now} /> : null}
          {atLimit ? (
            <Typography variant="body2" sx={{ color: 'warning.main' }}>
              {PLAN_LIMIT}
            </Typography>
          ) : null}
          <Typography variant="caption" component="p" sx={mutedSx}>
            {usage.fiveHour && usage.sevenDay ? PLAN_REPORTED : PLAN_REPORTED_ONE}
          </Typography>
        </>
      )}
    </Box>
  );
}

function ComputerUsage({ summary }: { summary: SpendSummary }) {
  const { month, today } = summary.computer;
  const onKey = summary.anthropic.month;
  return (
    <Stack spacing={2}>
      <Typography variant="body2" sx={mutedSx}>
        {PLAN_PAYS}
      </Typography>
      <PlanUse />
      {month.requests > 0 ? (
        <Periods
          cells={[
            { id: 'month-tokens', label: 'This month', value: formatTokens(month.tokens), unit: 'tokens' },
            { id: 'today-tokens', label: 'Today', value: formatTokens(today.tokens), unit: 'tokens' },
            { id: 'on-api', label: 'On the API', value: `≈${NBSP}${formatCost(month.costMicros)}`, unit: 'this month' },
          ]}
        />
      ) : (
        <Typography variant="body2" sx={mutedSx}>
          {NOTHING_YET}
        </Typography>
      )}
      {onKey.requests > 0 ? (
        <Typography variant="body2" sx={mutedNumbersSx} data-testid={USAGE_CARD_TID.also}>
          {`Also ${formatCost(onKey.costMicros)} on your API key this month.`}
        </Typography>
      ) : null}
      <Unpriced models={summary.unpricedModels} />
      <Footnote text={COUNTED} />
    </Stack>
  );
}

export function UsageCard() {
  const { spend } = useServices();
  const summary = useSpendSummary();
  const source = useUsageSource();
  const today = useToday();
  const box = useRef<HTMLDivElement>(null);
  /** Whether the pause card's Open Settings asked for this card: taken once, when it mounts. */
  const revealAsked = useRef<boolean | null>(null);

  // Every device's counts, as Decaid holds them now (D238).
  useEffect(() => {
    if (spend) void spend.refresh();
  }, [spend]);

  useEffect(() => {
    if (revealAsked.current === null) revealAsked.current = takeUsageReveal();
  }, []);

  const shown = summary === null ? null : source;
  // Brought into view once it has something to show: where the coach runs may still be read when it mounts.
  useEffect(() => {
    const element = box.current;
    if (shown === null || element === null || !revealAsked.current) return;
    revealAsked.current = false;
    revealInOwnColumn(element.closest('section') ?? element);
  }, [shown]);

  if (summary === null || shown === null) return null;
  return (
    <Section title={shown === 'computer' ? 'Usage' : 'Usage and cost'}>
      <Box ref={box} data-testid={USAGE_CARD_TID.card}>
        {shown === 'computer' ? <ComputerUsage summary={summary} /> : <ApiUsage summary={summary} today={today} />}
      </Box>
    </Section>
  );
}
