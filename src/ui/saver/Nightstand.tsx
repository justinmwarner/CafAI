/**
 * Nightstand (D-SAVER-5), after a bedside clock, and the screensaver every
 * other one falls back to: text drawn by React, not a canvas. The time,
 * large, 24-hour as CafAI writes times; under it, when they are known, the
 * next wake time from Decaid's wake times, the bag on the machine and the
 * last shot in one line, as History writes one. The time in ink, the rest in
 * muted ink, on the page's dark colour (D-SAVER-4).
 *
 * The block jumps to a new place each minute, seeded, well inside the edges,
 * so nothing stays lit in one spot all night. A jump is not motion: it
 * jumps under reduced motion too.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import Box from '@mui/material/Box';
import type { WakeSchedule } from '../../api/types.ts';
import { useOptionalServices } from '../../app/services.tsx';
import type { CoachUiMessage } from '../../app/types.ts';
import type { ShotSummary } from '../../coach/types.ts';
import { formatBar, formatGrams, formatRatio, formatSeconds, shotRatio } from '../chat/format.ts';
import type { Palette } from '../palette.ts';
import { describeWhen, nextWake } from '../settings/wakeSchedule.ts';
import { TID } from '../testIds.ts';
import { createRandom } from './random.ts';

/** The share of the screen kept clear on every side. */
const EDGE = 0.1;

/** The newest shot in a conversation, or null. */
export function lastShotSummary(messages: readonly CoachUiMessage[]): ShotSummary | null {
  for (let m = messages.length - 1; m >= 0; m -= 1) {
    const parts = messages[m]!.parts;
    for (let p = parts.length - 1; p >= 0; p -= 1) {
      const part = parts[p]!;
      if (part.kind === 'shot') return part.summary;
    }
  }
  return null;
}

/** The last shot in one line, as History writes one: "Last shot: 28.1 s · 18.0 g → 36.4 g · 1:2.0 · peak 9.0 bar". */
export function shotLine(summary: ShotSummary): string {
  return `Last shot: ${[
    formatSeconds(summary.durationS),
    `${formatGrams(summary.doseG)} → ${formatGrams(summary.yieldG)}`,
    formatRatio(shotRatio(summary)),
    `peak ${formatBar(summary.peakPressureBar)}`,
  ].join(' · ')}`;
}

/** A few short numbers of the last shot for a screensaver to show (Brew Rain): its peak pressure, its yield and its time, ["9.0", "36.4", "28"]. */
export function shotNumbers(summary: ShotSummary | null): string[] {
  if (!summary) return [];
  const numbers: string[] = [];
  if (summary.peakPressureBar !== null && Number.isFinite(summary.peakPressureBar)) numbers.push(summary.peakPressureBar.toFixed(1));
  if (summary.yieldG !== null && Number.isFinite(summary.yieldG)) numbers.push(summary.yieldG.toFixed(1));
  if (Number.isFinite(summary.durationS) && summary.durationS > 0) numbers.push(String(Math.round(summary.durationS)));
  return numbers;
}

/** "Wakes at 06:00" within the next day; "Wakes Friday at 06:00" further off. */
export function wakeLine(at: Date, now: Date): string {
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  return at.getTime() - now.getTime() <= 86_400_000 ? `Wakes at ${time}` : `Wakes ${describeWhen(at, now)}`;
}

/** "06:05", 24-hour, as CafAI writes times. */
export function clockText(now: Date): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export interface Size {
  width: number;
  height: number;
}

/** Where the block goes for this minute: seeded, and at least a tenth of the screen from every edge where it fits. */
export function nightstandPlace(seed: number, minute: number, area: Size, block: Size): { left: number; top: number } {
  const random = createRandom(Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(minute | 0, 0x85ebca6b));
  const along = (room: number, size: number) => {
    const margin = room * EDGE;
    const free = room - size - 2 * margin;
    // Too big to keep the margins: centred.
    return free <= 0 ? Math.max(0, (room - size) / 2) : margin + random() * free;
  };
  const left = along(area.width, block.width);
  const top = along(area.height, block.height);
  return { left: Math.round(left), top: Math.round(top) };
}

/** The time, moved on at each minute's start. */
function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setTimeout(() => setNow(new Date()), 60_000 - (now.getTime() % 60_000) + 20);
    return () => clearTimeout(timer);
  }, [now]);
  return now;
}

const noSubscribe = () => () => undefined;
const nothing = () => null;

/** The lines under the time, from Decaid's wake times and the coach's state; none outside a ServicesProvider. */
function useLines(now: Date): string[] {
  const services = useOptionalServices();
  const decaid = services?.decaid ?? null;
  const coach = services?.coach ?? null;
  const [schedules, setSchedules] = useState<readonly WakeSchedule[] | null>(null);
  useEffect(() => {
    if (!decaid) return;
    let cancelled = false;
    decaid.getPresenceSettings().then(
      (settings) => {
        if (!cancelled) setSchedules(settings.schedules);
      },
      () => {
        // No wake time to show: the clock is enough.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [decaid]);
  const bag = useSyncExternalStore(coach?.subscribe ?? noSubscribe, coach ? () => coach.getState().activeBag?.name ?? null : nothing);
  const shot = useSyncExternalStore(coach?.subscribe ?? noSubscribe, coach ? () => lastShotLine(coach.getState().messages) : nothing);
  const next = schedules ? nextWake(schedules, now) : null;
  return [next ? wakeLine(next.at, now) : null, bag?.trim() ? bag.trim() : null, shot].filter((line): line is string => line !== null);
}

/** One string for the selector, so a streamed token never re-renders the clock. */
function lastShotLine(messages: readonly CoachUiMessage[]): string | null {
  const summary = lastShotSummary(messages);
  return summary ? shotLine(summary) : null;
}

export interface NightstandProps {
  palette: Palette;
  seed: number;
  /** The block is in its place. */
  onPainted?(): void;
}

export function Nightstand({ palette, seed, onPainted }: NightstandProps) {
  const now = useMinute();
  const lines = useLines(now);
  const minute = Math.floor(now.getTime() / 60_000);
  const area = useRef<HTMLDivElement>(null);
  const block = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const linesKey = lines.join('\n');

  useLayoutEffect(() => {
    const areaNode = area.current;
    const blockNode = block.current;
    if (!areaNode || !blockNode) return;
    const update = () => {
      const next = nightstandPlace(
        seed,
        minute,
        { width: areaNode.clientWidth, height: areaNode.clientHeight },
        { width: blockNode.offsetWidth, height: blockNode.offsetHeight },
      );
      setPlace((last) => (last && last.left === next.left && last.top === next.top ? last : next));
    };
    update();
    const resized = new ResizeObserver(update);
    resized.observe(areaNode);
    resized.observe(blockNode);
    return () => resized.disconnect();
  }, [seed, minute, linesKey]);

  const placed = place !== null;
  const painted = useRef(onPainted);
  useEffect(() => {
    painted.current = onPainted;
  });
  useEffect(() => {
    if (placed) painted.current?.();
  }, [placed]);

  return (
    <Box ref={area} data-testid={TID.nightstand} sx={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <Box
        ref={block}
        sx={{
          position: 'absolute',
          left: place?.left ?? 0,
          top: place?.top ?? 0,
          visibility: placed ? 'visible' : 'hidden',
          maxWidth: '80%',
          color: palette.inkMuted,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <Box
          component="time"
          data-testid={TID.nightstandTime}
          dateTime={clockText(now)}
          sx={{ display: 'block', color: palette.ink, fontSize: 'clamp(64px, 20vmin, 200px)', fontWeight: 300, lineHeight: 1 }}
        >
          {clockText(now)}
        </Box>
        {lines.map((line) => (
          <Box key={line} sx={{ fontSize: 'clamp(16px, 3.2vmin, 28px)', lineHeight: 1.35, mt: '0.4em' }}>
            {line}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
