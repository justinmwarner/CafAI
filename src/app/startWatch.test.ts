import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { START_RETRIED_KEY, START_RETRY_MS, START_SLOW_MS, watchStart, type StartWatch } from './startWatch.ts';

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem = (key: string) => this.items.get(key) ?? null;
  setItem = (key: string, value: string) => void this.items.set(key, value);
  removeItem = (key: string) => void this.items.delete(key);
}

describe('watchStart (D274)', () => {
  let storage: MemoryStorage;
  let reload: ReturnType<typeof vi.fn<() => void>>;
  let onSlow: ReturnType<typeof vi.fn<(stage: string | null) => void>>;
  let lines: string[];

  function start(): StartWatch {
    return watchStart({ storage, reload, onSlow, log: (line) => lines.push(line) });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    storage = new MemoryStorage();
    reload = vi.fn<() => void>();
    onSlow = vi.fn<(stage: string | null) => void>();
    lines = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('says nothing for a start that finishes in time, and logs its stages with their times', () => {
    const watch = start();
    watch.stage('opening this device’s storage');
    vi.advanceTimersByTime(120);
    watch.stage('opening the coach');
    vi.advanceTimersByTime(80);
    watch.done();
    vi.advanceTimersByTime(START_RETRY_MS * 2);
    expect(onSlow).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(lines).toEqual([
      '[CafAI] start: opening this device’s storage',
      '[CafAI] start: opening this device’s storage, 120 ms; opening the coach',
      '[CafAI] start: opening the coach, 80 ms; started in 200 ms',
    ]);
  });

  it('says the start is slow, with the stage it waits on, then reloads the page once by itself', () => {
    const watch = start();
    watch.stage("reading Decaid's backup");
    vi.advanceTimersByTime(START_SLOW_MS);
    expect(onSlow).toHaveBeenCalledWith("reading Decaid's backup");
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(START_RETRY_MS - START_SLOW_MS);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.items.get(START_RETRIED_KEY)).toBe('1');
    expect(lines.at(-1)).toBe(`[CafAI] start: still reading Decaid's backup after ${START_RETRY_MS} ms; reloading once`);
  });

  it('does not reload a second time: the page that already retried leaves it to Try again', () => {
    storage.items.set(START_RETRIED_KEY, '1');
    start();
    vi.advanceTimersByTime(START_RETRY_MS);
    expect(onSlow).toHaveBeenCalledWith(null);
    expect(reload).not.toHaveBeenCalled();
    expect(lines.at(-1)).toBe(`[CafAI] start: still before the first stage after ${START_RETRY_MS} ms; not reloading again`);
  });

  it('forgets the retry once a start finishes, so the next slow start may retry again', () => {
    storage.items.set(START_RETRIED_KEY, '1');
    const watch = start();
    watch.done();
    expect(storage.items.has(START_RETRIED_KEY)).toBe(false);
  });

  it('never reloads where storage is blocked: it could not tell it had', () => {
    const watch = watchStart({ storage: null, reload, onSlow, log: (line) => lines.push(line) });
    watch.stage('opening the coach');
    vi.advanceTimersByTime(START_RETRY_MS);
    expect(onSlow).toHaveBeenCalledWith('opening the coach');
    expect(reload).not.toHaveBeenCalled();
  });

  it('stops watching a start that failed, which says so itself', () => {
    const watch = start();
    watch.failed();
    vi.advanceTimersByTime(START_RETRY_MS);
    expect(onSlow).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps a stage name a storage that throws cannot stop', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const watch = watchStart({ storage: broken, reload, onSlow, log: (line) => lines.push(line) });
    watch.stage('opening the coach');
    vi.advanceTimersByTime(START_RETRY_MS);
    expect(watch.current()).toBe('opening the coach');
    expect(reload).not.toHaveBeenCalled();
    expect(() => watch.done()).not.toThrow();
  });
});
