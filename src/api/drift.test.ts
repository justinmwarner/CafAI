import { describe, expect, it, vi } from 'vitest';
import { createDriftLog, formatDriftReport } from './drift.ts';

const at = (iso: string) => () => new Date(iso);

describe('drift log', () => {
  it('keeps one entry per source and problem, counting repeats', () => {
    const warn = vi.fn();
    const log = createDriftLog({ now: at('2026-10-09T10:00:00Z'), warn });
    log.report({ source: 'ws/v1/machine/snapshot', problem: 'pressure: missing' });
    log.report({ source: 'ws/v1/machine/snapshot', problem: 'pressure: missing' });
    log.report({ source: 'GET /api/v1/workflow', problem: 'profile: missing' });
    expect(log.list()).toEqual([
      { source: 'ws/v1/machine/snapshot', problem: 'pressure: missing', count: 2, firstAt: '2026-10-09T10:00:00.000Z', lastAt: '2026-10-09T10:00:00.000Z' },
      { source: 'GET /api/v1/workflow', problem: 'profile: missing', count: 1, firstAt: '2026-10-09T10:00:00.000Z', lastAt: '2026-10-09T10:00:00.000Z' },
    ]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('notifies on new entries only and keeps the same list until one arrives', () => {
    const log = createDriftLog({ warn: () => {} });
    const listener = vi.fn();
    log.subscribe(listener);
    log.report({ source: 'a', problem: 'b' });
    const first = log.list();
    log.report({ source: 'a', problem: 'b' });
    expect(log.list()).toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops adding kinds at the limit', () => {
    const log = createDriftLog({ warn: () => {}, limit: 2 });
    for (const problem of ['x', 'y', 'z']) log.report({ source: 's', problem });
    expect(log.list().map((entry) => entry.problem)).toEqual(['x', 'y']);
  });

  it('formats a report a person can paste into an issue', () => {
    const log = createDriftLog({ now: at('2026-10-09T10:00:00Z'), warn: () => {} });
    log.report({ source: 'GET /api/v1/workflow', problem: 'profile: missing' });
    expect(formatDriftReport(log.list(), { appVersion: '0.1.0', decaidVersion: '0.9.0', verifiedWith: '0.8.8' })).toBe(
      'CafAI 0.1.0 with Decaid 0.9.0 (verified with 0.8.8)\n' +
        'GET /api/v1/workflow: profile: missing (1 time, first 2026-10-09T10:00:00.000Z)',
    );
  });
});
