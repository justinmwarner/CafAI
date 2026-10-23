/**
 * A deterministic stand-in for the browser WebSocket, for the socket tests
 * (telemetry, the display). Nothing happens until the test says so: `open()`,
 * `message()`, `fail()` and `drop()` play the server's part synchronously,
 * and `sent` keeps what the client sent. Test-only; no app code imports it.
 */

type Handler<E> = ((event: E) => void) | null;

export class FakeSocket {
  readonly url: string;
  readyState = 0;
  onopen: Handler<Event> = null;
  onmessage: Handler<{ data: unknown }> = null;
  onclose: Handler<{ code: number }> = null;
  onerror: Handler<Event> = null;
  /** True once the client called close(). */
  closedByClient = false;
  /** Every message the client sent, oldest first: CafAI sends only on the display socket. */
  readonly sent: string[] = [];

  constructor(url: string) {
    this.url = url;
  }

  /** Path part of the URL, e.g. "/ws/v1/devices". */
  get path(): string {
    return new URL(this.url).pathname;
  }

  close(): void {
    this.closedByClient = true;
    this.readyState = 3;
  }

  /** As a browser does: an error while still connecting, nothing once closed. */
  send(data: string): void {
    if (this.readyState === 0) throw new Error('InvalidStateError: the socket is still connecting');
    if (this.readyState === 1) this.sent.push(data);
  }

  /** What the client sent, as JSON. */
  sentJson(): unknown[] {
    return this.sent.map((data) => JSON.parse(data) as unknown);
  }

  // ---- the server's side -----------------------------------------------------------

  open(): this {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
    return this;
  }

  /** Deliver a frame: objects are JSON-encoded, strings sent as they are. */
  message(frame: unknown): this {
    this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
    return this;
  }

  /** An error, which browsers always follow with a close. */
  fail(): this {
    this.onerror?.(new Event('error'));
    this.drop(1006);
    return this;
  }

  /** The connection closes from the other end. */
  drop(code = 1006): this {
    this.readyState = 3;
    this.onclose?.({ code });
    return this;
  }
}

export interface FakeWebSocketFactory {
  /** Pass as `WebSocketImpl` (cast to `typeof WebSocket`). */
  WebSocketImpl: new (url: string) => FakeSocket;
  /** Every socket ever created, oldest first. */
  sockets: FakeSocket[];
  /** The newest socket for a path such as "/ws/v1/devices". */
  latest(path: string): FakeSocket;
  /** Sockets for a path that the client has not closed. */
  live(path: string): FakeSocket[];
}

export function createFakeWebSocket(): FakeWebSocketFactory {
  const sockets: FakeSocket[] = [];
  class Tracked extends FakeSocket {
    constructor(url: string) {
      super(url);
      sockets.push(this);
    }
  }
  return {
    WebSocketImpl: Tracked,
    sockets,
    latest(path) {
      const found = [...sockets].reverse().find((socket) => socket.path === path);
      if (!found) throw new Error(`no socket for ${path}`);
      return found;
    },
    live: (path) => sockets.filter((socket) => socket.path === path && !socket.closedByClient && socket.readyState !== 3),
  };
}
