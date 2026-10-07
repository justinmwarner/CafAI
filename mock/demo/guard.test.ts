// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { TID } from '../../src/ui/testIds.ts';
import { GUARD_NOTE, GUARD_NOTE_HEIGHT_PX, showGuardNote } from './guard.ts';

/** The smallest Decent tablet layout, in CSS px (playwright.config.ts). */
const TABLET_WIDTH = 962;

/** The app's frame as AppShell draws it: fixed over the whole page. */
function appFrame(): HTMLElement {
  const app = document.createElement('div');
  app.setAttribute('data-testid', TID.appReady);
  app.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0';
  document.body.append(app);
  return app;
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('the guard note: one slim line', () => {
  it('is 34 px high whatever its text, and the app moves down by just that', () => {
    expect(GUARD_NOTE_HEIGHT_PX).toBeGreaterThanOrEqual(32);
    expect(GUARD_NOTE_HEIGHT_PX).toBeLessThanOrEqual(36);
    const app = appFrame();
    const note = showGuardNote(document);
    expect(note.style.height).toBe(`${GUARD_NOTE_HEIGHT_PX}px`);
    expect(note.style.boxSizing).toBe('border-box');
    expect([note.style.position, note.style.top, note.style.left, note.style.right]).toEqual(['fixed', '0px', '0px', '0px']);
    // The text never wraps to a second line: a narrow window cuts it, with the whole text on hover.
    const text = note.querySelector('span')!;
    expect(text.textContent).toBe(GUARD_NOTE);
    expect([text.style.whiteSpace, text.style.overflow, text.style.textOverflow]).toEqual(['nowrap', 'hidden', 'ellipsis']);
    expect(text.title).toBe(GUARD_NOTE);
    expect(getComputedStyle(app).top).toBe(`${GUARD_NOTE_HEIGHT_PX}px`);
  });

  it('says why and what to run, short enough for one line beside its button at 962 px', () => {
    expect(GUARD_NOTE).toContain('The demo did not load');
    expect(GUARD_NOTE).toContain('npm run demo');
    // At a generous 8 px a character, next to the paddings, the gap and an 80 px button.
    expect(GUARD_NOTE.length * 8).toBeLessThan(TABLET_WIDTH - 16 - 8 - 12 - 80);
  });

  it('has a Dismiss button inside the line, which gives the app its whole height back', () => {
    const app = appFrame();
    const note = showGuardNote(document);
    const dismiss = note.querySelector('button')!;
    expect(dismiss.textContent).toBe('Dismiss');
    expect(dismiss.getAttribute('aria-label')).toBe('Dismiss');
    expect(Number.parseFloat(dismiss.style.height)).toBeLessThan(GUARD_NOTE_HEIGHT_PX);
    dismiss.click();
    expect(document.body.querySelector('[role="status"]')).toBeNull();
    expect(getComputedStyle(app).top).toBe('0px');
  });
});
