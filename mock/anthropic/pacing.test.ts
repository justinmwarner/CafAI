import { describe, expect, it } from 'vitest';
import { chunkEvents, endsSentence, mulberry32, streamDelays } from './pacing.ts';
import { sseFrame, type SseMessage } from './sse.ts';

const textDelta = (text: string): SseMessage => ({
  event: 'content_block_delta',
  data: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text } },
});
const jsonDelta = (partial_json: string): SseMessage => ({
  event: 'content_block_delta',
  data: { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json } },
});
const PING: SseMessage = { event: 'ping', data: { type: 'ping' } };

/** `count` chunks; the ones at `ends` finish a sentence. */
const chunks = (count: number, ends: number[] = []) => Array.from({ length: count }, (_, i) => ({ endsSentence: ends.includes(i) }));

function joined(parts: Uint8Array[]): string {
  const decoder = new TextDecoder();
  return parts.map((part) => decoder.decode(part, { stream: true })).join('') + decoder.decode();
}

describe('endsSentence', () => {
  it('is true for a text_delta ending in ., ?, ! or :, then optional closing quotes or brackets and whitespace', () => {
    for (const text of ['Done.', 'Done. ', 'Ready?\n', 'Lovely!', 'the curve: ', 'v2.\n\n', '(see above.) ', '"Yes!" ', 'it.” ', "it.' ", '[sic.]']) {
      expect(endsSentence(textDelta(text)), JSON.stringify(text)).toBe(true);
    }
  });

  it('is false mid-sentence, after a closing bold marker, and for anything but a text_delta', () => {
    for (const text of ['28.4 s, ', '8.9 bar ', 'Lovely', '**Done.**', '', ' ']) {
      expect(endsSentence(textDelta(text)), JSON.stringify(text)).toBe(false);
    }
    expect(endsSentence(PING)).toBe(false);
    expect(endsSentence(jsonDelta('{"summary":"Done."'))).toBe(false);
  });
});

describe('mulberry32', () => {
  it('is a seeded generator in [0, 1): the same seed, the same numbers', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const values = Array.from({ length: 50 }, () => a());
    expect(Array.from({ length: 50 }, () => b())).toEqual(values);
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(mulberry32(43)()).not.toBe(values[0]);
  });
});

describe('streamDelays', () => {
  it("keeps today's timing by default: 400 ms before the first event, then 25 ms before each next one and before the end", () => {
    expect(streamDelays(chunks(4, [1]), {}, 1)).toEqual([400, 25, 25, 25, 25]);
    expect(streamDelays(chunks(3), { firstEventDelayMs: 100, eventDelayMs: 10 }, 9)).toEqual([100, 10, 10, 10]);
  });

  it('moves each gap by up to ± jitterMs, deterministically for a seed, and leaves the first delay alone', () => {
    const options = { firstEventDelayMs: 1300, eventDelayMs: 50, jitterMs: 20 };
    const delays = streamDelays(chunks(300), options, 7);
    const gaps = delays.slice(1);
    expect(delays[0]).toBe(1300);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(30);
      expect(gap).toBeLessThanOrEqual(70);
    }
    // The whole range is used, not one fixed offset.
    expect(new Set(gaps).size).toBeGreaterThan(250);
    expect(Math.min(...gaps)).toBeLessThan(33);
    expect(Math.max(...gaps)).toBeGreaterThan(67);
    expect(streamDelays(chunks(300), options, 7)).toEqual(delays);
    expect(streamDelays(chunks(300), options, 8)).not.toEqual(delays);
  });

  it('never lets a gap go below 0', () => {
    const gaps = streamDelays(chunks(300), { eventDelayMs: 5, jitterMs: 20 }, 3).slice(1);
    expect(Math.min(...gaps)).toBe(0);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(25);
  });

  it('adds the sentence pause after a chunk that ends a sentence, on top of its jittered gap', () => {
    const options = { eventDelayMs: 50, jitterMs: 20 };
    const plain = streamDelays(chunks(6, [1, 4]), options, 5);
    const paused = streamDelays(chunks(6, [1, 4]), { ...options, sentencePauseMs: 150 }, 5);
    // Six chunks and the end: the pause lands before chunks 2 and 5.
    expect(paused.map((delay, i) => Math.round(delay - (plain[i] ?? 0)))).toEqual([0, 0, 150, 0, 0, 150, 0]);
  });

  it('scales every delay by 1/speed, and sends everything at once at speed Infinity or <= 0', () => {
    const options = { firstEventDelayMs: 1300, eventDelayMs: 50, jitterMs: 20, sentencePauseMs: 150 };
    const normal = streamDelays(chunks(12, [3, 9]), options, 2);
    const fast = streamDelays(chunks(12, [3, 9]), { ...options, speed: 25 }, 2);
    expect(fast).toHaveLength(normal.length);
    fast.forEach((delay, i) => expect(delay).toBeCloseTo((normal[i] ?? Number.NaN) / 25, 9));
    for (const speed of [Infinity, 0, -1]) {
      expect(streamDelays(chunks(12, [3, 9]), { ...options, speed }, 2).every((delay) => delay === 0), String(speed)).toBe(true);
    }
  });
});

describe('chunkEvents', () => {
  const events = [PING, textDelta('Done. '), textDelta('Pull a '), jsonDelta('{"a":1}'), textDelta('shot?')];

  it('makes one chunk per event and marks the sentence ends', () => {
    const out = chunkEvents(events);
    expect(out.map((chunk) => new TextDecoder().decode(chunk.bytes))).toEqual(events.map(sseFrame));
    expect(out.map((chunk) => chunk.endsSentence)).toEqual([false, true, false, false, true]);
  });

  it('with chunkBytes cuts the same bytes anywhere, and pauses after the chunk holding the end of a sentence', () => {
    const size = 16;
    const out = chunkEvents(events, size);
    expect(joined(out.map((chunk) => chunk.bytes))).toBe(events.map(sseFrame).join(''));
    for (const chunk of out.slice(0, -1)) expect(chunk.bytes.length).toBe(size);
    const encoder = new TextEncoder();
    const endOf = (count: number) => encoder.encode(events.slice(0, count).map(sseFrame).join('')).length;
    const marked = new Set([Math.floor((endOf(2) - 1) / size), Math.floor((endOf(5) - 1) / size)]);
    expect(out.map((chunk) => chunk.endsSentence)).toEqual(out.map((_, i) => marked.has(i)));
  });
});
