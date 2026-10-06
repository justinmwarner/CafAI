/**
 * When each chunk of the scripted coach's event stream goes out. By default a
 * fixed wait before the first event (time to first token) and a fixed gap
 * between events, which the e2e specs rely on. The demo (D76) adds a small
 * jitter to every gap and a pause after each sentence, so the reply reads
 * like a model writing rather than a ticker. The jitter comes from a seeded
 * generator, never Math.random(): the same conversation streams with the
 * same rhythm on every run.
 */
import { sseFrame, type SseMessage } from './sse.ts';

/** The timing fields of AnthropicMockOptions (handlers.ts documents them). */
export interface Pacing {
  speed?: number;
  firstEventDelayMs?: number;
  eventDelayMs?: number;
  jitterMs?: number;
  sentencePauseMs?: number;
}

export interface StreamChunk {
  bytes: Uint8Array;
  /** The sentence pause follows this chunk. */
  endsSentence: boolean;
}

/** ., ?, ! or :, then optional closing quotes or brackets and whitespace, at the very end. */
const SENTENCE_END = /[.?!:]["'”’)\]]*\s*$/;

/** True for a text_delta whose text ends a sentence. */
export function endsSentence(event: SseMessage): boolean {
  const delta = event.data.delta;
  if (typeof delta !== 'object' || delta === null) return false;
  const { type, text } = delta as Record<string, unknown>;
  return type === 'text_delta' && typeof text === 'string' && SENTENCE_END.test(text);
}

/** mulberry32: a tiny seeded generator, uniform in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The stream's chunks: one per event, or with `chunkBytes` the same bytes cut
 * every that many bytes, ignoring event boundaries (as a network may). A cut
 * chunk ends a sentence when the last byte of a sentence-ending event is in it.
 */
export function chunkEvents(events: readonly SseMessage[], chunkBytes?: number): StreamChunk[] {
  const encoder = new TextEncoder();
  const frames = events.map((event) => ({ bytes: encoder.encode(sseFrame(event)), endsSentence: endsSentence(event) }));
  if (chunkBytes === undefined || !(chunkBytes > 0)) return frames;

  const sentenceEnds: number[] = [];
  let frameEnd = 0;
  for (const frame of frames) {
    frameEnd += frame.bytes.length;
    if (frame.endsSentence) sentenceEnds.push(frameEnd);
  }
  const all = encoder.encode(events.map(sseFrame).join(''));
  const chunks: StreamChunk[] = [];
  for (let i = 0; i < all.length; i += chunkBytes) {
    const bytes = all.subarray(i, i + chunkBytes);
    const end = i + bytes.length;
    chunks.push({ bytes, endsSentence: sentenceEnds.some((at) => at > i && at <= end) });
  }
  return chunks;
}

/**
 * How long to wait before each chunk, then once more before the stream
 * closes, in ms. The first wait is firstEventDelayMs; every later gap is
 * eventDelayMs moved by up to ± jitterMs (never below 0), plus
 * sentencePauseMs after a chunk that ends a sentence. Everything scales by
 * 1/speed; speed Infinity (or <= 0) sends it all at once.
 */
export function streamDelays(chunks: readonly Pick<StreamChunk, 'endsSentence'>[], pacing: Pacing, seed: number): number[] {
  const speed = pacing.speed ?? 1;
  const scale = speed > 0 && Number.isFinite(speed) ? 1 / speed : 0;
  const gap = pacing.eventDelayMs ?? 25;
  const jitter = Math.max(0, pacing.jitterMs ?? 0);
  const pause = Math.max(0, pacing.sentencePauseMs ?? 0);
  const random = mulberry32(seed);

  const delays = [(pacing.firstEventDelayMs ?? 400) * scale];
  for (const chunk of chunks) {
    const jittered = jitter > 0 ? gap + (random() * 2 - 1) * jitter : gap;
    delays.push((Math.max(0, jittered) + (chunk.endsSentence ? pause : 0)) * scale);
  }
  return delays;
}
