import { describe, expect, it } from 'vitest';
import { createSaverPreview, previewFromUrl } from './preview.ts';

describe('createSaverPreview', () => {
  it('shows one, tells subscribers, and hides it', () => {
    const preview = createSaverPreview();
    let calls = 0;
    preview.subscribe(() => void (calls += 1));
    expect(preview.current()).toBeNull();
    preview.show('beanfield', { seed: 20_383 });
    expect(preview.current()).toBe('beanfield');
    expect(preview.request()).toEqual({ id: 'beanfield', seed: 20_383, at: null });
    preview.hide();
    expect(preview.current()).toBeNull();
    // Hiding nothing tells nobody.
    preview.hide();
    expect(calls).toBe(2);
  });

  it('keeps the same request until another show, and a new one for each show', () => {
    const preview = createSaverPreview();
    preview.show('rain');
    const first = preview.request();
    expect(preview.request()).toBe(first);
    preview.show('rain');
    expect(preview.request()).not.toBe(first);
  });

  it('holds a moment only when it is one', () => {
    const preview = createSaverPreview();
    preview.show('lava', { at: 20_000 });
    expect(preview.request()?.at).toBe(20_000);
    preview.show('lava', { at: -1 });
    expect(preview.request()?.at).toBeNull();
    preview.show('lava', { at: Number.NaN });
    expect(preview.request()?.at).toBeNull();
  });

  it('a subscriber that leaves hears nothing more', () => {
    const preview = createSaverPreview();
    let calls = 0;
    const leave = preview.subscribe(() => void (calls += 1));
    leave();
    preview.show('steam');
    expect(calls).toBe(0);
  });
});

describe('previewFromUrl (mock builds)', () => {
  it('reads ?saverPreview and ?saverAt', () => {
    expect(previewFromUrl('?mockSpeed=25&saverPreview=beanfield&saverAt=3000')).toEqual({ id: 'beanfield', at: 3000 });
    expect(previewFromUrl('?saverPreview=nightstand')).toEqual({ id: 'nightstand', at: null });
    expect(previewFromUrl('?saverPreview=rain&saverAt=soon')).toEqual({ id: 'rain', at: null });
  });

  it('opens nothing without a screensaver this build knows', () => {
    expect(previewFromUrl('')).toBeNull();
    expect(previewFromUrl('?saverPreview=pipes&saverAt=10')).toBeNull();
    expect(previewFromUrl('?saverAt=10')).toBeNull();
  });
});
