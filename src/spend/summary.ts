/**
 * The totals Settings > Coach > Usage and cost shows (D239), from every
 * device's day records: today, this month (with each day and what it went
 * on), last month and all time, for each source apart. The API key's are
 * dollars on the bill; the computer's are what the same tokens would cost on
 * the API, which the plan pays instead.
 */
import { dayOf, monthOf, previousMonth } from './records.ts';
import type { SpendPeriod, SpendRecord, SpendSource, SpendSummary, SpendTotals } from './types.ts';

type SourceTotals = SpendSummary['anthropic'];

const totals = (): SpendTotals => ({ costMicros: 0, tokens: 0, requests: 0, replies: 0, webSearches: 0 });
const period = (): SpendPeriod => ({ ...totals(), days: [], byKind: { reply: 0, shot: 0, photo: 0, web: 0 } });
const sourceTotals = (): SourceTotals => ({ today: totals(), month: period(), lastMonth: totals(), allTime: totals() });

/** Everything sent and received: input, cache reads and writes, output. */
const tokensOf = (record: SpendRecord) => record.inputTokens + record.outputTokens + record.cacheReadTokens + record.cacheWriteTokens;

function add(into: SpendTotals, record: SpendRecord): void {
  into.costMicros += record.costMicros;
  into.tokens += tokensOf(record);
  into.requests += record.requests;
  into.replies += record.replies;
  into.webSearches += record.webSearches;
}

export function summarize(records: Iterable<SpendRecord>, now: Date): SpendSummary {
  const today = dayOf(now);
  const month = monthOf(now);
  const lastMonth = previousMonth(month);
  const sources: Record<SpendSource, SourceTotals> = { anthropic: sourceTotals(), computer: sourceTotals() };
  const days: Record<SpendSource, Map<string, { day: string; costMicros: number; tokens: number }>> = { anthropic: new Map(), computer: new Map() };
  const unpriced = new Set<string>();
  for (const record of records) {
    const source = sources[record.source];
    add(source.allTime, record);
    if (record.day === today) add(source.today, record);
    const recordMonth = record.day.slice(0, 7);
    if (recordMonth === month) {
      add(source.month, record);
      // A record's cost holds its searches: they go on the web, the rest on the kind.
      source.month.byKind[record.kind] += record.costMicros - record.webSearchMicros;
      source.month.byKind.web += record.webSearchMicros;
      const day = days[record.source].get(record.day) ?? { day: record.day, costMicros: 0, tokens: 0 };
      day.costMicros += record.costMicros;
      day.tokens += tokensOf(record);
      days[record.source].set(record.day, day);
      if (record.unpriced > 0) unpriced.add(record.model);
    } else if (recordMonth === lastMonth) {
      add(source.lastMonth, record);
    }
  }
  for (const source of ['anthropic', 'computer'] as const) {
    sources[source].month.days = [...days[source].values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  }
  return { month, anthropic: sources.anthropic, computer: sources.computer, unpricedModels: [...unpriced].sort() };
}
