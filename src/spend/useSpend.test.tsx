// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ServicesProvider } from '../app/services.tsx';
import { createFakeServices, createFakeSpend } from '../ui/testing/fakeServices.ts';
import { makeRecord } from './testing/fixtures.ts';
import { useSpendSummary } from './useSpend.ts';

const NOW = new Date(2026, 9, 24, 15, 0);

function withServices(services: ReturnType<typeof createFakeServices>) {
  return ({ children }: { children: ReactNode }) => <ServicesProvider services={services}>{children}</ServicesProvider>;
}

describe('useSpendSummary (D239)', () => {
  it('is null without a spend service, as in previews', () => {
    const { result } = renderHook(() => useSpendSummary(), { wrapper: withServices(createFakeServices()) });
    expect(result.current).toBeNull();
    expect(renderHook(() => useSpendSummary()).result.current).toBeNull();
  });

  it("shows the fake's totals, at the catalog's prices, and follows each count", () => {
    const spend = createFakeSpend({ records: [makeRecord({ costMicros: 1_840_000 })], now: () => NOW });
    const { result } = renderHook(() => useSpendSummary(), { wrapper: withServices(createFakeServices({ spend })) });
    expect(result.current?.anthropic.month.costMicros).toBe(1_840_000);
    const first = result.current;
    act(() => {
      spend.count({ at: NOW, source: 'anthropic', model: 'claude-haiku-5-5', kind: 'photo', call: 0, usage: { inputTokens: 10_000, outputTokens: 0 } });
    });
    // 10,000 tokens at Haiku 5.5's $0.10 per million.
    expect(result.current?.anthropic.month.costMicros).toBe(1_841_000);
    expect(result.current?.anthropic.month.byKind.photo).toBe(1000);
    expect(result.current).not.toBe(first);
  });

  it("measures the fake's budget as the real service does", () => {
    const spend = createFakeSpend({ records: [makeRecord({ costMicros: 4_100_000 })], now: () => NOW });
    expect(spend.budget({ monthlyUsd: 5, pauseAtBudget: true })).toMatchObject({ step: 'near', paused: false, resumesOn: '2026-11-01' });
  });
});
