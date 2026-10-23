/**
 * Usage sharing (D-USAGE-1 to D-USAGE-6): the rule this device is under, its
 * answer, Clarity's loading and consent, and the events, tags and screens
 * that go to Clarity while the device shares. Nothing loads before start(),
 * which the app calls once it has rendered.
 */
import { mirrorScreen } from './address.ts';
import { readChoice, WORDING, writeChoice, type UsageChoice } from './choice.ts';
import { loadClarity, type ClarityCall } from './clarity.ts';
import { guardFields } from './fields.ts';
import { consentRule, readRegionSignals, type ConsentRule, type RegionSignals } from './region.ts';
import type { UsageEvent, UsageTag, UsageTracker } from './types.ts';

export interface UsageState {
  /** Whether usage goes to Clarity (once started). */
  sharing: boolean;
  /** What waits at the foot of the chat: the card (ask first), the notice, or nothing once answered. */
  prompt: 'card' | 'notice' | null;
  rule: ConsentRule;
}

export interface UsageService extends UsageTracker {
  getState(): UsageState;
  subscribe(listener: () => void): () => void;
  /** Load Clarity if the device shares; once, after the app's first render. */
  start(): void;
  /** The card's or the notice's answer, or the switch: true shares, false stops. Kept on the device. */
  choose(share: boolean): void;
  /** A tag for the session, sent when it changes. */
  tag(key: UsageTag, value: string): void;
  /** The screen now open, by its name in the address. */
  screen(name: string): void;
  /** Stop watching the page's fields (the services' dispose). Clarity itself goes with the page. */
  dispose(): void;
}

export interface UsageDeps {
  win: Window;
  projectId: string;
  /** The device's own storage (localStorage), or null where it is blocked. */
  storage: Pick<globalThis.Storage, 'getItem' | 'setItem'> | null;
  now(): Date;
  /** Clarity's loader (the real one by default). */
  load?: (win: Window, projectId: string) => ClarityCall;
  /** What the device says about where it is (read from it by default). */
  signals?: RegionSignals;
}

/** Events counted before start() on a device that shares wait for Clarity, at most this many. */
const EARLY_CAP = 50;

function stateFor(choice: UsageChoice | null, rule: ConsentRule): UsageState {
  if (choice) return { sharing: choice.choice === 'yes', prompt: null, rule };
  return rule === 'ask' ? { sharing: false, prompt: 'card', rule } : { sharing: true, prompt: 'notice', rule };
}

export function createUsageService(deps: UsageDeps): UsageService {
  const { win, projectId, storage, now } = deps;
  const load = deps.load ?? loadClarity;
  const rule = consentRule(deps.signals ?? readRegionSignals(win));
  let choice = readChoice(storage);
  let state = stateFor(choice, rule);
  let started = false;
  let clarity: ClarityCall | null = null;
  /** Stopped in this page: turned on again, Clarity starts over. */
  let stopped = false;
  const early: UsageEvent[] = [];
  const tags = new Map<UsageTag, string>([['rule', rule]]);
  const sent = new Map<UsageTag, string>();
  let screenName: string | null = null;
  /** The form fields' guard while the device shares (D-USAGE-5), or null. */
  let unguard: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const live = () => clarity !== null && !stopped;

  function sendTags(): void {
    if (!clarity || stopped) return;
    for (const [key, value] of tags) {
      if (sent.get(key) === value) continue;
      clarity('set', key, value);
      sent.set(key, value);
    }
  }

  function begin(): void {
    // Before Clarity loads, so the guard's observer comes before Clarity's and runs first.
    if (!unguard) unguard = guardFields(win.document);
    if (!clarity) clarity = load(win, projectId);
    else if (stopped) clarity('start');
    stopped = false;
    // Analytics consent only where CafAI asked and heard yes; elsewhere it claims none, and keeps ads off (D-USAGE-3).
    if (choice?.choice === 'yes' && choice.rule === 'ask') clarity('consentv2', { analytics_Storage: 'granted', ad_Storage: 'denied' });
    else clarity('consentv2', { ad_Storage: 'denied' });
    sendTags();
    if (screenName !== null) mirrorScreen(win, screenName);
    for (const event of early.splice(0)) clarity('event', event);
  }

  function end(): void {
    early.length = 0;
    mirrorScreen(win, null);
    unguard?.();
    unguard = null;
    if (!clarity || stopped) return;
    clarity('consent', false);
    clarity('stop');
    stopped = true;
    sent.clear();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (started) return;
      started = true;
      if (state.sharing) begin();
      else mirrorScreen(win, null);
    },
    choose(share) {
      const was = state.sharing;
      choice = { choice: share ? 'yes' : 'no', at: now().toISOString(), wording: WORDING, rule };
      writeChoice(storage, choice);
      state = stateFor(choice, rule);
      if (started && share && !was) begin();
      if (!share && was) end();
      for (const listener of listeners) listener();
    },
    track(event) {
      if (!state.sharing) return;
      if (live()) clarity!('event', event);
      else if (!started && early.length < EARLY_CAP) early.push(event);
    },
    tag(key, value) {
      tags.set(key, value);
      if (state.sharing) sendTags();
    },
    screen(name) {
      screenName = name;
      if (state.sharing && live()) mirrorScreen(win, name);
    },
    dispose() {
      unguard?.();
      unguard = null;
      listeners.clear();
    },
  };
}
