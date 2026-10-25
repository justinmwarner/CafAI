/** Records for the spend tests: one Opus 5.5 reply of 24 October 2026 on the API key unless told otherwise. */
import type { SpendRecord } from '../types.ts';

export function makeRecord(over: Partial<SpendRecord> = {}): SpendRecord {
  return {
    day: '2026-10-24',
    device: 'dev12345',
    source: 'anthropic',
    model: 'claude-opus-5-5',
    kind: 'reply',
    requests: 1,
    replies: 1,
    inputTokens: 900,
    outputTokens: 40,
    cacheReadTokens: 4000,
    cacheWriteTokens: 300,
    webSearches: 1,
    costMicros: 17900,
    webSearchMicros: 10000,
    unpriced: 0,
    ...over,
  };
}
