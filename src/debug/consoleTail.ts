/**
 * While the DEBUG flag is on: the page's last console lines, for a report.
 * Every line still goes on to the console as before (Decaid keeps those too,
 * in its WebView log).
 */

export interface ConsoleTail {
  lines(): string[];
  stop(): void;
}

const LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;
type Level = (typeof LEVELS)[number];
const MAX_LINE = 600;

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function captureConsole(con: Pick<Console, Level>, max = 300, clock: { now(): number } = Date): ConsoleTail {
  const kept: string[] = [];
  const originals = new Map<Level, Console[Level]>();
  for (const level of LEVELS) {
    const original = con[level];
    originals.set(level, original);
    con[level] = (...args: unknown[]) => {
      const line = `${new Date(clock.now()).toISOString()} ${level} ${args.map(text).join(' ')}`;
      kept.push(line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line);
      if (kept.length > max) kept.shift();
      original.apply(con, args);
    };
  }
  return {
    lines: () => [...kept],
    stop() {
      for (const [level, original] of originals) con[level] = original;
    },
  };
}
