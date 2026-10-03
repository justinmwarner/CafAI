import { describe, expect, it } from 'vitest';
import { createSseParser, type SseEvent } from './sse.ts';

// A byte order mark, comments, CRLF / LF / lone-CR line ends, multi-byte UTF-8,
// multi-line data, a field with no colon, an id, and a trailing unfinished
// event that must never be dispatched.
const FIXTURE =
  '﻿: a comment line, ignored\r\n' +
  'event: message_start\r\n' +
  'data: {"type":"message_start","message":{"id":"msg_1"}}\r\n' +
  '\r\n' +
  'event: content_block_delta\n' +
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"92 °C, 🙂 é"}}\n' +
  '\n' +
  'event: multi\r' +
  'data: line one\r' +
  'data:line two\r' +
  'data:  two spaces\r' +
  '\r' +
  'data\n' +
  'data: last\n' +
  '\n' +
  'id: 7\n' +
  'event: ping\n' +
  'data: {"type":"ping"}\n' +
  '\n' +
  'event: unfinished\n' +
  'data: never dispatched';

const EXPECTED: SseEvent[] = [
  { event: 'message_start', data: '{"type":"message_start","message":{"id":"msg_1"}}', id: '' },
  {
    event: 'content_block_delta',
    data: '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"92 °C, 🙂 é"}}',
    id: '',
  },
  { event: 'multi', data: 'line one\nline two\n two spaces', id: '' },
  { event: 'message', data: '\nlast', id: '' },
  { event: 'ping', data: '{"type":"ping"}', id: '7' },
];

const BYTES = new TextEncoder().encode(FIXTURE);

function parseChunks(chunks: Array<Uint8Array | string>): SseEvent[] {
  const parser = createSseParser();
  const events: SseEvent[] = [];
  for (const chunk of chunks) events.push(...parser.push(chunk));
  events.push(...parser.end());
  return events;
}

describe('createSseParser', () => {
  it('parses a whole stream', () => {
    expect(parseChunks([BYTES])).toEqual(EXPECTED);
  });

  it('gives the same events when the bytes are split at any boundary', () => {
    for (let i = 0; i <= BYTES.length; i++) {
      expect(parseChunks([BYTES.subarray(0, i), BYTES.subarray(i)]), `split at byte ${i}`).toEqual(EXPECTED);
    }
  });

  it('gives the same events when split into three pieces anywhere', () => {
    for (let i = 0; i <= BYTES.length; i += 3) {
      for (let j = i; j <= BYTES.length; j += 5) {
        const chunks = [BYTES.subarray(0, i), BYTES.subarray(i, j), BYTES.subarray(j)];
        expect(parseChunks(chunks), `split at ${i} and ${j}`).toEqual(EXPECTED);
      }
    }
  });

  it('gives the same events one byte at a time', () => {
    const chunks = Array.from(BYTES, (_, i) => BYTES.subarray(i, i + 1));
    expect(parseChunks(chunks)).toEqual(EXPECTED);
  });

  it('treats CR then LF in the next chunk as one line break', () => {
    expect(parseChunks(['event: a\r', '\ndata: x\r', '\n\r', '\n'])).toEqual([{ event: 'a', data: 'x', id: '' }]);
  });

  it('dispatches nothing for an event without data and resets its type', () => {
    expect(parseChunks(['event: lonely\n\n', 'data: y\n\n'])).toEqual([{ event: 'message', data: 'y', id: '' }]);
  });

  it('returns events as soon as their blank line arrives', () => {
    const parser = createSseParser();
    expect(parser.push('event: a\ndata: 1\n')).toEqual([]);
    expect(parser.push('\nevent: b\ndata: 2\n\n')).toEqual([
      { event: 'a', data: '1', id: '' },
      { event: 'b', data: '2', id: '' },
    ]);
    expect(parser.end()).toEqual([]);
  });

  it('accepts text chunks and strips a leading byte order mark from them', () => {
    expect(parseChunks(['﻿data: x\n\n'])).toEqual([{ event: 'message', data: 'x', id: '' }]);
  });
});
