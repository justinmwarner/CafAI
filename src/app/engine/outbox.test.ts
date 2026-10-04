import { describe, expect, it } from 'vitest';
import { createOutbox, OUTBOX_RETRY_MS, type OutboxTimers } from './outbox.ts';

/** Timers the test fires by hand. */
function manualTimers() {
  const scheduled = new Map<number, { callback: () => void; ms: number }>();
  let next = 0;
  const timers: OutboxTimers = {
    setTimeout(callback, ms) {
      next += 1;
      scheduled.set(next, { callback, ms });
      return next;
    },
    clearTimeout(handle) {
      scheduled.delete(handle as number);
    },
  };
  return {
    timers,
    delays: () => [...scheduled.values()].map((t) => t.ms),
    fire() {
      const due = [...scheduled.values()];
      scheduled.clear();
      for (const timer of due) timer.callback();
    },
  };
}

/** A write that fails while `down` is true and records every call. */
function decaid() {
  const state = { down: false, calls: [] as string[] };
  const write = (label: string) => async () => {
    state.calls.push(label);
    if (state.down) throw new Error('Could not reach Decaid.');
  };
  return { state, write };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('outbox', () => {
  it('sends a write at once and forgets it', async () => {
    const { timers, delays } = manualTimers();
    const outbox = createOutbox({ timers });
    const { state, write } = decaid();
    await expect(outbox.put('grinder', write('14'))).resolves.toBe(true);
    expect(state.calls).toEqual(['14']);
    expect(outbox.pending()).toEqual([]);
    expect(delays()).toEqual([]);
  });

  it('keeps a failed write and sends it again on flush', async () => {
    const { timers } = manualTimers();
    const outbox = createOutbox({ timers });
    const { state, write } = decaid();
    state.down = true;
    await expect(outbox.put('grinder', write('14'))).resolves.toBe(false);
    expect(outbox.pending()).toEqual(['grinder']);

    state.down = false;
    await outbox.flush();
    expect(state.calls).toEqual(['14', '14']);
    expect(outbox.pending()).toEqual([]);
  });

  it('sends only the latest write under a key', async () => {
    const { timers } = manualTimers();
    const outbox = createOutbox({ timers });
    const { state, write } = decaid();
    state.down = true;
    await outbox.put('grinder', write('14'));
    await outbox.put('grinder', write('13'));
    state.down = false;
    await outbox.flush();
    expect(state.calls).toEqual(['14', '13', '13']);
    expect(outbox.pending()).toEqual([]);
  });

  it('runs one write per key at a time: a newer write waits for the one in flight', async () => {
    const outbox = createOutbox({ timers: manualTimers().timers });
    const first = deferred();
    const calls: string[] = [];
    const a = outbox.put('shot:1', () => {
      calls.push('a');
      return first.promise;
    });
    const b = outbox.put('shot:1', async () => {
      calls.push('b');
    });
    await settle();
    expect(calls).toEqual(['a']);
    first.resolve();
    // A was replaced while it ran: B carries everything, so A has nothing left to report.
    await expect(a).resolves.toBe(true);
    await expect(b).resolves.toBe(true);
    expect(calls).toEqual(['a', 'b']);
    expect(outbox.pending()).toEqual([]);
  });

  it('keeps writes under different keys apart', async () => {
    const outbox = createOutbox({ timers: manualTimers().timers });
    const { state, write } = decaid();
    const slow = deferred();
    const shot = outbox.put('shot:1', () => slow.promise);
    await expect(outbox.put('grinder', write('14'))).resolves.toBe(true);
    expect(state.calls).toEqual(['14']);
    slow.reject(new Error('Decaid answered HTTP 500.'));
    await expect(shot).resolves.toBe(false);
    expect(outbox.pending()).toEqual(['shot:1']);
  });

  it('retries every 30 s while anything waits, and stops when nothing does', async () => {
    const { timers, delays, fire } = manualTimers();
    const outbox = createOutbox({ timers });
    const { state, write } = decaid();
    state.down = true;
    await outbox.put('grinder', write('14'));
    expect(delays()).toEqual([OUTBOX_RETRY_MS]);
    expect(OUTBOX_RETRY_MS).toBe(30_000);

    fire();
    await settle();
    expect(state.calls).toEqual(['14', '14']);
    expect(delays()).toEqual([OUTBOX_RETRY_MS]);

    state.down = false;
    fire();
    await settle();
    expect(state.calls).toEqual(['14', '14', '14']);
    expect(outbox.pending()).toEqual([]);
    expect(delays()).toEqual([]);
  });

  it('forgets a write that something else delivered', async () => {
    const { timers, delays } = manualTimers();
    const outbox = createOutbox({ timers });
    const { state, write } = decaid();
    state.down = true;
    await outbox.put('grinder', write('14'));
    outbox.drop('grinder');
    expect(outbox.pending()).toEqual([]);
    expect(delays()).toEqual([]);
    state.down = false;
    await outbox.flush();
    expect(state.calls).toEqual(['14']);
  });

  it('counts a write that throws at once as a failure', async () => {
    const outbox = createOutbox({ timers: manualTimers().timers });
    await expect(
      outbox.put('grinder', () => {
        throw new Error('bad input');
      }),
    ).resolves.toBe(false);
    expect(outbox.pending()).toEqual(['grinder']);
  });

  it('stops its timer on dispose and sends nothing after', async () => {
    const { timers, delays } = manualTimers();
    const outbox = createOutbox({ timers });
    const { state, write } = decaid();
    state.down = true;
    await outbox.put('grinder', write('14'));
    expect(delays()).toHaveLength(1);
    outbox.dispose();
    expect(delays()).toEqual([]);
    state.down = false;
    await outbox.flush();
    await outbox.put('shot:1', write('notes'));
    expect(state.calls).toEqual(['14']);
    expect(outbox.pending()).toEqual([]);
  });

  it('flushes with nothing waiting without sending anything', async () => {
    const outbox = createOutbox({ timers: manualTimers().timers });
    await outbox.flush();
    expect(outbox.pending()).toEqual([]);
  });
});
