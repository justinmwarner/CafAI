/**
 * Incremental server-sent-events parser, fed with the chunks of
 * `response.body.getReader().read()`.
 *
 * Chromium 91 cannot async-iterate a ReadableStream and has no
 * TextDecoderStream-friendly EventSource for POST requests, so this follows
 * the WHATWG event-stream rules by hand: UTF-8 decoded with `{stream: true}`
 * (a character split across chunks survives), CRLF / LF / CR line ends (a CRLF
 * split across chunks counts once), comments, multi-line `data:`, and an
 * unfinished event at the end of the stream discarded.
 */

export interface SseEvent {
  /** The `event:` field, or "message" when there was none. */
  event: string;
  /** All `data:` lines of the event, joined with "\n". */
  data: string;
  /** The last `id:` seen on the stream, or "". */
  id: string;
}

export interface SseParser {
  /** Feed the next chunk; returns the events it completed, in order. */
  push(chunk: Uint8Array | string): SseEvent[];
  /** The stream ended: flush the decoder. An unfinished event is dropped. */
  end(): SseEvent[];
}

const LF = 10;
const CR = 13;
const COLON = 58;
const SPACE = 32;

export function createSseParser(): SseParser {
  const decoder = new TextDecoder('utf-8');
  let started = false;
  /** Text after the last line break, waiting for the rest of its line. */
  let pending = '';
  /** The previous chunk ended with CR: a leading LF in the next one belongs to it. */
  let skipLeadingLf = false;
  let eventType = '';
  let data = '';
  let lastId = '';

  function dispatch(out: SseEvent[]): void {
    if (data === '') {
      eventType = '';
      return;
    }
    out.push({ event: eventType || 'message', data: data.endsWith('\n') ? data.slice(0, -1) : data, id: lastId });
    eventType = '';
    data = '';
  }

  function processLine(line: string, out: SseEvent[]): void {
    if (line === '') {
      dispatch(out);
      return;
    }
    if (line.charCodeAt(0) === COLON) return;
    const colon = line.indexOf(':');
    let field = line;
    let value = '';
    if (colon !== -1) {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value.charCodeAt(0) === SPACE) value = value.slice(1);
    }
    switch (field) {
      case 'event':
        eventType = value;
        break;
      case 'data':
        data += `${value}\n`;
        break;
      case 'id':
        if (!value.includes('\0')) lastId = value;
        break;
      default:
        // `retry` and unknown fields: we never reconnect, so nothing to do.
        break;
    }
  }

  function processText(input: string, out: SseEvent[]): void {
    let text = input;
    if (!started && text !== '') {
      started = true;
      // TextDecoder already strips a BOM from bytes; text chunks need it here.
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    if (skipLeadingLf && text !== '') {
      skipLeadingLf = false;
      if (text.charCodeAt(0) === LF) text = text.slice(1);
    }
    let segmentStart = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code !== LF && code !== CR) continue;
      const line = pending + text.slice(segmentStart, i);
      pending = '';
      processLine(line, out);
      if (code === CR) {
        if (i + 1 < text.length) {
          if (text.charCodeAt(i + 1) === LF) i += 1;
        } else {
          skipLeadingLf = true;
        }
      }
      segmentStart = i + 1;
    }
    pending += text.slice(segmentStart);
  }

  return {
    push(chunk) {
      const out: SseEvent[] = [];
      processText(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }), out);
      return out;
    },
    end() {
      const out: SseEvent[] = [];
      processText(decoder.decode(), out);
      pending = '';
      eventType = '';
      data = '';
      return out;
    },
  };
}
