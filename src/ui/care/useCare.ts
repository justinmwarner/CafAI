/**
 * Machine care's live state for the screens (D183-D188): the
 * service's state (src/app/care/careService.ts), each step's status, and the
 * most overdue step for the stats card's line. Statuses move with the time
 * (a step comes due as days pass), so they are worked out with a clock that
 * moves on every minute.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { allStatuses, mostOverdue, stepStatus, type StepStatus, type TrackedStepId } from '../../app/care/careRules.ts';
import type { CareState } from '../../app/care/careService.ts';
import { useServices } from '../../app/services.tsx';

const noSubscribe = () => () => undefined;

/** The care service's state; null where there is none (fakes and previews). */
export function useCareState(): CareState | null {
  const { care } = useServices();
  return useSyncExternalStore(care ? care.subscribe : noSubscribe, () => care?.getState() ?? null);
}

/** The time, moved on every minute. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** One step's status, with the time it was worked out at; null until the care service has read its records. */
export function useStepStatus(step: TrackedStepId): { status: StepStatus; now: number; state: CareState } | null {
  const state = useCareState();
  // A mark made since the clock last moved is up to a minute ahead of it: still today, and counted from 0.
  const now = useMinuteClock();
  if (!state?.ready) return null;
  return { status: stepStatus(step, state.records.get(step) ?? null, state.settings, state.totals, now), now, state };
}

/** The most overdue step while the stats card's line is on; null when nothing is due (D188). */
export function useDueStep(): { status: StepStatus; now: number } | null {
  const state = useCareState();
  const now = useMinuteClock();
  if (!state?.ready || !state.settings.reminders) return null;
  const status = mostOverdue(allStatuses(state.records, state.settings, state.totals, now));
  return status ? { status, now } : null;
}
