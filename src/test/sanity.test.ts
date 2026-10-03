// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { openDB } from 'idb';

describe('test environment', () => {
  it('has a DOM', () => {
    document.body.innerHTML = '<p data-testid="x">hi</p>';
    expect(document.querySelector('[data-testid=x]')).toHaveTextContent('hi');
  });

  it('has IndexedDB', async () => {
    const db = await openDB('sanity', 1, { upgrade: (d) => d.createObjectStore('s') });
    await db.put('s', 1, 'k');
    expect(await db.get('s', 'k')).toBe(1);
  });
});
