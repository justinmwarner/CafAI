import { describe, expect, it, vi } from 'vitest';
import { GatewayError } from '../../api/types.ts';
import { createOutbox, OUTBOX_RETRY_MS, WriteLater, writeFailure, type OutboxTimers } from './outbox.ts';

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

const unreachable = () => new GatewayError(0, '/api/v1/workflow', 'Could not reach Decaid.', 'network');

/** A write that fails while `down` is true (Decaid does not answer) and records every call. */
function decaid() {
  const state = { down: false, calls: [] as string[] };
  const write = (label: string) => async () => {
    state.calls.push(label);
    if (state.down) throw unreachable();
  };
  return { state, write };
}

/** A write that always fails with `error`, counting its attempts. */
function failing(error: unknown) {
  const state = { calls: 0 };
  const write = async () => {
    state.calls += 1;
    throw error;
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
    slow.reject(new GatewayError(500, '/api/v1/shots/1', 'Decaid answered HTTP 500 for /api/v1/shots/1.', 'http'));
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
        throw unreachable();
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

describe('writes that cannot succeed (5.11)', () => {
  const refused = (status: number) =>
    new GatewayError(status, '/api/v1/shots/shot-1', 'enjoyment must be between 0 and 10', 'http', {
      error: 'Invalid request',
      message: 'Invalid argument(s): enjoyment must be between 0 and 10',
    });

  it('drops a write Decaid refuses (a 400), says so once, and never sends it again', async () => {
    const { timers, delays, fire } = manualTimers();
    const onDrop = vi.fn();
    const outbox = createOutbox({ timers, onDrop });
    const error = refused(400);
    const { state, write } = failing(error);
    await expect(outbox.put('shot:shot-1', write)).resolves.toBe(true);
    expect(outbox.pending()).toEqual([]);
    expect(delays()).toEqual([]);
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith('shot:shot-1', error);

    await outbox.flush();
    fire();
    await settle();
    expect(state.calls).toBe(1);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it('keeps a write that may go through later: no answer, a timeout, 408, 409, 425, 429 and 5xx', async () => {
    const errors = [
      unreachable(),
      new GatewayError(0, '/api/v1/shots/shot-1', 'Decaid did not answer in time.', 'timeout'),
      ...[408, 409, 425, 429, 500, 503].map((status) => refused(status)),
    ];
    for (const error of errors) {
      const onDrop = vi.fn();
      const outbox = createOutbox({ timers: manualTimers().timers, onDrop });
      await expect(outbox.put('shot:shot-1', failing(error).write), `${error.status} ${error.code}`).resolves.toBe(false);
      expect(outbox.pending()).toEqual(['shot:shot-1']);
      expect(onDrop).not.toHaveBeenCalled();
    }
  });

  it('drops a write that fails in CafAI itself (a TypeError) instead of trying it forever', async () => {
    const { timers, delays, fire } = manualTimers();
    const onDrop = vi.fn();
    const outbox = createOutbox({ timers, onDrop });
    const { state, write } = failing(new TypeError("Cannot read properties of undefined (reading 'trim')"));
    await expect(outbox.put('shot:shot-1', write)).resolves.toBe(true);
    expect(outbox.pending()).toEqual([]);
    expect(delays()).toEqual([]);
    fire();
    await outbox.flush();
    expect(state.calls).toBe(1);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it('counts a write Decaid took as sent when only its reply could not be read', async () => {
    const onDrop = vi.fn();
    const outbox = createOutbox({ timers: manualTimers().timers, onDrop });
    const unread = new GatewayError(200, '/api/v1/shots/shot-1', "Decaid sent a reply CafAI doesn't recognise.", 'unexpected_reply');
    const { state, write } = failing(unread);
    await expect(outbox.put('shot:shot-1', write)).resolves.toBe(true);
    expect(outbox.pending()).toEqual([]);
    await outbox.flush();
    expect(state.calls).toBe(1);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('keeps a write that says it has to wait', async () => {
    const onDrop = vi.fn();
    const outbox = createOutbox({ timers: manualTimers().timers, onDrop });
    await expect(outbox.put('shot:shot-1', failing(new WriteLater('The rating scale is not known yet.')).write)).resolves.toBe(false);
    expect(outbox.pending()).toEqual(['shot:shot-1']);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('says nothing about a refused write that a newer one replaced: the newer one carries it', async () => {
    const onDrop = vi.fn();
    const outbox = createOutbox({ timers: manualTimers().timers, onDrop });
    const first = deferred();
    const older = outbox.put('shot:shot-1', () => first.promise);
    const newer = failing(refused(400));
    const replaced = outbox.put('shot:shot-1', newer.write);
    first.reject(refused(400));
    await expect(older).resolves.toBe(true);
    await expect(replaced).resolves.toBe(true);
    expect(newer.state.calls).toBe(1);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it('sorts failures the way the outbox treats them', () => {
    expect(writeFailure(unreachable())).toBe('retry');
    expect(writeFailure(refused(429))).toBe('retry');
    expect(writeFailure(refused(502))).toBe('retry');
    expect(writeFailure(new WriteLater('later'))).toBe('retry');
    expect(writeFailure(refused(400))).toBe('drop');
    expect(writeFailure(refused(404))).toBe('drop');
    expect(writeFailure(new GatewayError(0, '/api/v1/store/cafai', 'bad key', 'invalid_key'))).toBe('drop');
    expect(writeFailure(new TypeError('x.trim is not a function'))).toBe('drop');
    expect(writeFailure(new GatewayError(200, '/api/v1/workflow', 'Decaid sent an empty reply.', 'http'))).toBe('landed');
  });
});
