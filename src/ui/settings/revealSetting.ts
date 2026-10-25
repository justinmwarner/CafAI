/**
 * Bringing a setting the search found into view (D236). The search opens
 * the setting's group (a tablet's pane, a phone's page) and asks here; once
 * the page shows the setting's control and the control can be used (a card
 * can still be reading its settings, Sleep and wake from Decaid), this:
 *
 * - scrolls the group's own column, never the page (reveal.ts), so the
 *   card's title and the control are in view, or the control alone where
 *   both do not fit, and keeps them there while the page above them still
 *   grows, until the barista touches, scrolls or types (as careReveal.ts);
 * - focuses the control, or the chosen one of a set of choices (the tint
 *   chosen, the mode chosen), or the card itself where there is no control
 *   to focus (Usage and cost, a stepper held while no machine is connected);
 * - washes the card in the accent-wash for 1.2 s, fading in and out in
 *   200 ms, and not at all under reduced motion (the caller says).
 *
 * It waits for the page by its mutations, and gives up after 2.5 s: then it
 * shows the card if there is one, else leaves the group open as it is. A
 * newer search replaces one still waiting.
 */
import { TID } from '../testIds.ts';
import { revealInColumn } from './reveal.ts';
import type { SettingControl, SettingsIndexEntry } from './settingsIndex.ts';

/** The card's wash, start to end; it fades in and out over WASH_FADE_MS of it. */
export const WASH_MS = 1200;
const WASH_FADE_MS = 200;
/** How long a search waits for its group's page and the control. */
export const REVEAL_WAIT_MS = 2500;
/** How long it holds the setting in view while the page above still grows. */
const HOLD_MS = 2000;
/** Clear of the column's edges, as revealInColumn's own default. */
const MARGIN = 16;

/** The barista taking over: from then on the column is theirs. */
const TAKE_OVER = ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const;

export interface RevealOptions {
  /** The card's wash (the theme's accent-wash), or null for none: reduced motion. */
  wash: string | null;
}

/** An element the barista acts on, which a disabled state holds. */
const CONTROL = 'input, select, textarea, button, a[href], [role="radio"], [role="switch"], [role="checkbox"], [role="spinbutton"], [role="button"]';

function isControl(element: Element): boolean {
  return element.matches(CONTROL);
}

/** A control held for now: it cannot take the focus until its card lets it. */
function isHeld(element: Element): boolean {
  return isControl(element) && (element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true');
}

function byLabel(root: HTMLElement, label: string): HTMLElement | null {
  const named = Array.from(root.querySelectorAll<HTMLElement>('[aria-label]')).find((element) => element.getAttribute('aria-label') === label);
  if (named) return named;
  for (const element of Array.from(root.querySelectorAll('label'))) {
    if (element.textContent?.trim() !== label) continue;
    const target = element.htmlFor ? root.ownerDocument.getElementById(element.htmlFor) : element.querySelector('input, select, textarea');
    if (target instanceof HTMLElement && root.contains(target)) return target;
  }
  return null;
}

/** A setting's control on its group's page: by its test id, else by its accessible name or its label. */
export function findControl(root: HTMLElement, control: SettingControl): HTMLElement | null {
  if ('testId' in control) {
    const found = root.querySelector<HTMLElement>(`[data-testid="${control.testId}"]`);
    if (found) return found;
  }
  return control.label ? byLabel(root, control.label) : null;
}

/** A card on the page by its title, the name its region is given (Section.tsx). */
function cardIn(root: HTMLElement, title: string): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>('section')).find((section) => section.getAttribute('aria-label') === title) ?? null;
}

/** What to bring into view for a control: its set of choices, its field with its label, its labelled switch, or itself. */
function blockOf(control: HTMLElement, card: HTMLElement | null): HTMLElement {
  for (const selector of ['[role="radiogroup"], [role="group"]', '.MuiFormControl-root', '.MuiFormControlLabel-root', '.MuiInputBase-root']) {
    const block = control.closest<HTMLElement>(selector);
    if (block && (card === null || card.contains(block))) return block;
  }
  return control;
}

/** The nearest column that scrolls itself, inside the group's page (the page itself on a tablet). */
function columnOf(element: HTMLElement, root: HTMLElement): HTMLElement {
  for (let parent = element.parentElement; parent && root.contains(parent); parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return parent;
  }
  return root;
}

/** The card's title down to the block when the two fit in the column, else the block alone. */
function revealSpan(column: HTMLElement, card: HTMLElement | null, block: HTMLElement): void {
  const view = column.getBoundingClientRect();
  const box = block.getBoundingClientRect();
  const top = card ? Math.min(card.getBoundingClientRect().top, box.top) : box.top;
  const fits = card !== null && box.bottom - top <= view.height - 2 * MARGIN;
  revealInColumn(column, fits ? card : block, block, MARGIN);
}

/**
 * Keep the span in view while the column or its content changes size (a card
 * above still reading; a phone's tabs coming back as the search field loses
 * the focus): for HOLD_MS, or until the barista takes over.
 */
function holdInView(column: HTMLElement, card: HTMLElement | null, block: HTMLElement): void {
  if (typeof ResizeObserver !== 'function') return;
  const observer = new ResizeObserver(() => {
    if (block.isConnected) revealSpan(column, card, block);
    else release();
  });
  const timer = window.setTimeout(release, HOLD_MS);
  function release() {
    observer.disconnect();
    window.clearTimeout(timer);
    for (const type of TAKE_OVER) column.removeEventListener(type, release);
  }
  observer.observe(column);
  for (const child of Array.from(column.children)) observer.observe(child);
  for (const type of TAKE_OVER) column.addEventListener(type, release, { passive: true });
}

/** What takes the focus: the chosen one of a set of choices, the control, or nothing (the card takes it). */
function focusOf(control: HTMLElement, spec: SettingControl): HTMLElement | null {
  if ('chosen' in spec && spec.chosen) {
    const set = control.closest('[role="radiogroup"], [role="group"]');
    const chosen = set?.querySelector<HTMLElement>('[aria-checked="true"], [aria-pressed="true"], input:checked');
    if (chosen && !isHeld(chosen)) return chosen;
  }
  return isControl(control) && !isHeld(control) ? control : null;
}

/** The card takes the focus for as long as it keeps it: in the tab order only then. */
function focusCard(card: HTMLElement): void {
  if (!card.hasAttribute('tabindex')) {
    card.setAttribute('tabindex', '-1');
    card.addEventListener('blur', () => card.removeAttribute('tabindex'), { once: true });
  }
  card.focus({ preventScroll: true });
}

const washing = new WeakMap<HTMLElement, number[]>();

/** The accent-wash over the card for WASH_MS, fading in and out; the card's own colours after. */
function washCard(card: HTMLElement, colour: string): void {
  for (const timer of washing.get(card) ?? []) window.clearTimeout(timer);
  card.style.transition = `background-color ${WASH_FADE_MS}ms ease-out`;
  card.style.backgroundColor = colour;
  washing.set(card, [
    window.setTimeout(() => {
      card.style.backgroundColor = '';
    }, WASH_MS - WASH_FADE_MS),
    window.setTimeout(() => {
      card.style.transition = '';
      washing.delete(card);
    }, WASH_MS),
  ]);
}

function show(root: HTMLElement, entry: SettingsIndexEntry, control: HTMLElement | null, wash: string | null): void {
  const card = control?.closest<HTMLElement>('section') ?? cardIn(root, entry.card);
  const block = control ? blockOf(control, card) : card;
  if (block === null) return;
  const column = columnOf(block, root);
  revealSpan(column, card, block);
  holdInView(column, card, block);
  const focus = control ? focusOf(control, entry.control) : null;
  if (focus) focus.focus({ preventScroll: true });
  else if (card) focusCard(card);
  if (card && wash) washCard(card, wash);
}

let waiting: (() => void) | null = null;

/**
 * Bring `entry` into view on its group's page once the page shows it (see
 * above). Returns a cancel; a newer call cancels an older one still waiting.
 */
export function revealSetting(entry: SettingsIndexEntry, { wash }: RevealOptions): () => void {
  waiting?.();
  let done = false;
  const observer = new MutationObserver(() => attempt(false));
  const timer = window.setTimeout(() => attempt(true), REVEAL_WAIT_MS);
  function stop() {
    done = true;
    observer.disconnect();
    window.clearTimeout(timer);
    if (waiting === stop) waiting = null;
  }
  function attempt(last: boolean) {
    if (done) return;
    const root = document.querySelector<HTMLElement>(`[data-testid="${TID.settingsPane(entry.group)}"]`);
    if (root === null) {
      if (last) stop();
      return;
    }
    const control = findControl(root, entry.control);
    if (!last && (control === null || isHeld(control))) return;
    stop();
    show(root, entry, control, wash);
  }
  waiting = stop;
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled'] });
  attempt(false);
  return stop;
}
