/**
 * MSW handlers for the Anthropic Messages API, backed by the scripted fake
 * coach. Replies stream as `text/event-stream` with small delays between
 * events so the chat UI streams the way it will against the real API.
 *
 *   setupServer(...decaidHandlers, ...anthropicHandlers({ speed: Infinity }))  // Vitest
 *   startMockWorker({ extraHandlers: anthropicHandlers({ speed }) })           // dev / Playwright
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import { createScenarioMemory, resetScenarioMemory, respond, type ScenarioMemory } from './scenario.ts';
import { sseFrame, type SseMessage } from './sse.ts';

export const ANTHROPIC_API_ORIGIN = 'https://api.anthropic.com';

export interface AnthropicMockOptions {
  /** Playback speed: 2 is twice as fast; Infinity (or 0) plays with no delays. Default 1. */
  speed?: number;
  /** Wait before the first event at speed 1 (time to first token). Default 400 ms. */
  firstEventDelayMs?: number;
  /** Wait between events at speed 1. Default 25 ms. */
  eventDelayMs?: number;
  /** Cut the byte stream into chunks of this many bytes, ignoring event boundaries. */
  chunkBytes?: number;
  /** Conversation memory; defaults to the shared one that resetAnthropicMock() clears. */
  memory?: ScenarioMemory;
  /** Default https://api.anthropic.com. */
  baseUrl?: string;
}

const sharedMemory = createScenarioMemory();

/** Forget every assistant turn the fake produced (between tests). */
export function resetAnthropicMock(): void {
  resetScenarioMemory(sharedMemory);
}

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-expose-headers': 'retry-after, request-id',
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function eventStream(events: SseMessage[], options: AnthropicMockOptions): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const speed = options.speed ?? 1;
  const scale = speed > 0 && Number.isFinite(speed) ? 1 / speed : 0;
  const firstDelay = (options.firstEventDelayMs ?? 400) * scale;
  const eventDelay = (options.eventDelayMs ?? 25) * scale;

  let chunks = events.map((event) => encoder.encode(sseFrame(event)));
  if (options.chunkBytes !== undefined && options.chunkBytes > 0) {
    const size = options.chunkBytes;
    const all = encoder.encode(events.map(sseFrame).join(''));
    chunks = [];
    for (let i = 0; i < all.length; i += size) chunks.push(all.subarray(i, i + size));
  }

  let next = 0;
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const ms = next === 0 ? firstDelay : eventDelay;
      if (ms > 0) await wait(ms);
      if (cancelled) return;
      const chunk = chunks[next];
      next += 1;
      if (chunk === undefined) controller.close();
      else controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
}

export function anthropicHandlers(options: AnthropicMockOptions = {}): HttpHandler[] {
  const url = `${(options.baseUrl ?? ANTHROPIC_API_ORIGIN).replace(/\/+$/, '')}/v1/messages`;
  const memory = options.memory ?? sharedMemory;

  return [
    http.options(url, () => new HttpResponse(null, { status: 204, headers: CORS_HEADERS })),
    http.post(url, async ({ request }) => {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        body = undefined;
      }
      const result = respond(body, request.headers, memory);
      if ('errorBody' in result) {
        return HttpResponse.json(result.errorBody, { status: result.status, headers: CORS_HEADERS });
      }
      return new HttpResponse(eventStream(result.events, options), {
        status: 200,
        headers: { ...CORS_HEADERS, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
      });
    }),
  ];
}
