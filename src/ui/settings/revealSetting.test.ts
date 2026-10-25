// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TID } from '../testIds.ts';
import { findControl, REVEAL_WAIT_MS, revealSetting, WASH_MS } from './revealSetting.ts';
import type { SettingsIndexEntry } from './settingsIndex.ts';

const WASH = '#3a2d1f';

/** Microtasks: the page's mutations reach the search as a MutationObserver hears them. */
async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function entry(over: Partial<SettingsIndexEntry> = {}): SettingsIndexEntry {
  return { id: 'grinder-setting', name: 'Current grinder setting', group: 'grinder', card: 'Your grinder', control: { testId: TID.grinderSetting }, words: [], ...over };
}

/** A group's page as GroupPage draws it: the pane scrolling itself, a card (a section named by its title) in it. */
function page(group: string, card: string, body: string): HTMLElement {
  const pane = document.createElement('div');
  pane.setAttribute('data-testid', TID.settingsPane(group));
  pane.style.overflowY = 'auto';
  pane.innerHTML = `<div><section aria-label="${card}"><h3>${card}</h3>${body}</section></div>`;
  return pane;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('revealSetting (D236)', () => {
  it("waits for the group's page and the control, then focuses it and washes its card for 1.2 s", async () => {
    revealSetting(entry(), { wash: WASH });
    await settle();
    // The address changes first; the page comes a moment later.
    const pane = page('grinder', 'Your grinder', `<input data-testid="${TID.grinderSetting}" />`);
    document.body.append(pane);
    await settle();
    const input = pane.querySelector('input')!;
    const card = pane.querySelector('section')!;
    expect(document.activeElement).toBe(input);
    expect(card.style.backgroundColor).toBe('rgb(58, 45, 31)');
    vi.advanceTimersByTime(WASH_MS);
    expect(card.style.backgroundColor).toBe('');
    expect(card.style.transition).toBe('');
  });

  it('puts no wash on the card under reduced motion', async () => {
    document.body.append(page('grinder', 'Your grinder', `<input data-testid="${TID.grinderSetting}" />`));
    revealSetting(entry(), { wash: null });
    await settle();
    expect(document.activeElement).toBe(document.querySelector('input'));
    expect(document.querySelector('section')!.style.backgroundColor).toBe('');
  });

  it('focuses the chosen one of a set of choices', async () => {
    document.body.append(
      page(
        'display',
        'Appearance',
        `<div role="radiogroup" aria-label="Tint">
          <button role="radio" aria-checked="false" data-testid="${TID.tintSwatch('crema')}">Crema</button>
          <button role="radio" aria-checked="true" data-testid="${TID.tintSwatch('matcha')}">Matcha</button>
        </div>`,
      ),
    );
    revealSetting(entry({ id: 'tint', group: 'display', card: 'Appearance', control: { testId: TID.tintSwatch('crema'), chosen: true } }), { wash: WASH });
    await settle();
    expect(document.activeElement).toBe(document.querySelector(`[data-testid="${TID.tintSwatch('matcha')}"]`));
  });

  it('waits for a control held while its card reads, and focuses it once it can be used', async () => {
    const pane = page('grinder', 'Your grinder', `<input disabled data-testid="${TID.grinderSetting}" />`);
    document.body.append(pane);
    revealSetting(entry(), { wash: WASH });
    await settle();
    expect(document.activeElement).not.toBe(pane.querySelector('input'));
    pane.querySelector('input')!.disabled = false;
    await settle();
    expect(document.activeElement).toBe(pane.querySelector('input'));
  });

  it('finds a control without a test id by its accessible name, or by its label', async () => {
    const pane = page(
      'grinder',
      'Your grinder',
      `<label for="g-setting">Current grinder setting</label><select id="g-setting"><option>14</option></select>
       <input aria-label="Steam time" /><button aria-label="More steam time">+</button>`,
    );
    document.body.append(pane);
    expect(findControl(pane, { testId: TID.grinderSetting, label: 'Current grinder setting' })).toBe(pane.querySelector('select'));
    expect(findControl(pane, { label: 'Steam time' })).toBe(pane.querySelector('input'));
    expect(findControl(pane, { label: 'Steam flow' })).toBeNull();
  });

  it('brings the card into view and focuses it when the control does not come, or is not one', async () => {
    const pane = page('drinks', 'Steam', `<input aria-label="Steam time" disabled />`);
    document.body.append(pane);
    revealSetting(entry({ id: 'steam-time', group: 'drinks', card: 'Steam', control: { label: 'Steam time' } }), { wash: WASH });
    await settle();
    vi.advanceTimersByTime(REVEAL_WAIT_MS);
    const card = pane.querySelector('section')!;
    expect(document.activeElement).toBe(card);
    expect(card.getAttribute('tabindex')).toBe('-1');
    expect(card.style.backgroundColor).toBe('rgb(58, 45, 31)');
    // The card is in the tab order only while it has the focus.
    card.blur();
    expect(card.hasAttribute('tabindex')).toBe(false);
  });

  it('does nothing once the barista has left the group, and a newer search replaces an older one', async () => {
    revealSetting(entry(), { wash: WASH });
    revealSetting(entry({ id: 'tint', group: 'display', card: 'Appearance', control: { testId: TID.tintHue } }), { wash: WASH });
    document.body.append(page('grinder', 'Your grinder', `<input data-testid="${TID.grinderSetting}" />`));
    await settle();
    expect(document.activeElement).toBe(document.body);
    vi.advanceTimersByTime(REVEAL_WAIT_MS);
    expect(document.activeElement).toBe(document.body);
  });

  it("scrolls the group's own column so the card's title and the control are in view, or the control alone", async () => {
    const pane = page('coach', 'Usage and cost', `<div style="height: 900px"></div><input data-testid="${TID.coachBudgetAmount}" />`);
    document.body.append(pane);
    let scrollTop = 0;
    Object.defineProperty(pane, 'scrollTop', { configurable: true, get: () => scrollTop, set: (value: number) => void (scrollTop = value) });
    const box = (top: number, height: number) => ({ top: top - scrollTop, bottom: top - scrollTop + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) });
    vi.spyOn(pane, 'getBoundingClientRect').mockImplementation(() => ({ ...box(0, 500), top: 0, bottom: 500 }));
    const card = pane.querySelector('section')!;
    const input = pane.querySelector('input')!;
    // The card starts 600 px down and is 1,000 px tall: with the budget at its foot, both do not fit.
    vi.spyOn(card, 'getBoundingClientRect').mockImplementation(() => box(600, 1000));
    vi.spyOn(input, 'getBoundingClientRect').mockImplementation(() => box(1500, 48));
    revealSetting(entry({ id: 'coach-budget', group: 'coach', card: 'Usage and cost', control: { testId: TID.coachBudgetAmount } }), { wash: null });
    await settle();
    // The control's foot 16 px clear of the column's.
    expect(scrollTop).toBe(1500 + 48 + 16 - 500);
  });
});
