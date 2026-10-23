// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { CLARITY_TAG, loadClarity } from './clarity.ts';

type Stubbed = Window & { clarity?: ((...args: unknown[]) => void) & { q?: ArrayLike<unknown>[] } };

afterEach(() => {
  document.querySelectorAll('script[data-cafai-clarity]').forEach((script) => script.remove());
  delete (window as Stubbed).clarity;
});

describe('loadClarity (D-USAGE-6)', () => {
  it("adds Clarity's tag once, async, and queues the calls made before it runs", () => {
    const call = loadClarity(window, 'abc123');
    loadClarity(window, 'abc123');
    const scripts = document.querySelectorAll<HTMLScriptElement>('script[data-cafai-clarity]');
    expect(scripts).toHaveLength(1);
    expect(scripts[0]!.src).toBe(`${CLARITY_TAG}abc123`);
    expect(scripts[0]!.async).toBe(true);
    call('event', 'shot_read');
    const queue = (window as Stubbed).clarity!.q!;
    expect(Array.from(queue[0]!)).toEqual(['event', 'shot_read']);
  });

  it('calls the Clarity that replaced the stub once its script ran', () => {
    const call = loadClarity(window, 'abc123');
    const heard: unknown[][] = [];
    (window as Stubbed).clarity = (...args: unknown[]) => void heard.push(args);
    call('set', 'layout', 'tablet');
    expect(heard).toEqual([['set', 'layout', 'tablet']]);
  });

  it("never lets Clarity's own trouble out", () => {
    (window as Stubbed).clarity = () => {
      throw new Error('broken');
    };
    const call = loadClarity(window, 'abc123');
    expect(() => call('event', 'shot_read')).not.toThrow();
  });
});
