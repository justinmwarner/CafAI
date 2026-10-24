/**
 * The coach's usage and cost for the screens (D239): Settings > Coach >
 * Usage and cost, and the Coach row's status line.
 */
import { useSyncExternalStore } from 'react';
import { useOptionalServices } from '../app/services.tsx';
import type { SpendSummary } from './types.ts';

const unchanging = () => () => undefined;
const nothing = () => null;

/**
 * The totals as they stand, every device's added; null without a spend
 * service (fakes and previews that leave it out). The same object until a
 * count or Decaid's copy changes them, so a screen re-renders only then.
 */
export function useSpendSummary(): SpendSummary | null {
  const spend = useOptionalServices()?.spend;
  return useSyncExternalStore(spend?.subscribe ?? unchanging, spend ? () => spend.summary() : nothing);
}
