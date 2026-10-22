import { describe, expect, it } from 'vitest';
import FACTS from './facts.json';
import { loadFacts } from './load.ts';

describe('loadFacts (D199)', () => {
  it("reads CafAI's own list, once", async () => {
    const first = loadFacts();
    expect(loadFacts()).toBe(first);
    expect(await first).toEqual(FACTS);
  });
});
