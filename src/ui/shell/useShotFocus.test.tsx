// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import type { CoachUiMessage } from '../../app/types.ts';
import type { ShotSummary } from '../../coach/types.ts';
import { navigate, useRoute } from '../router.ts';
import { createFakeServices, type FakeServices } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { GUARD_MS, isTextEntry, useShotFocus } from './useShotFocus.ts';
import { OUTCOME_WAIT_MS } from './shotFocus.ts';

function Harness() {
  const route = useRoute();
  const { awaitingOutcome, guardUntil } = useShotFocus(route);
  return (
    <div>
      <output data-testid="route">{route.name}</output>
      <output data-testid="awaiting">{String(awaitingOutcome)}</output>
      <output data-testid="guard">{guardUntil === null ? 'none' : String(guardUntil)}</output>
      <textarea aria-label="Draft" />
      <input aria-label="Search" type="search" />
      <input aria-label="Agree" type="checkbox" />
      <button type="button">Tap</button>
    </div>
  );
}

const message = (id: string, parts: CoachUiMessage['parts']): CoachUiMessage => ({
  id,
  role: 'system',
  parts,
  createdAt: '2026-10-07T08:00:00.000Z',
});
const card = (id: string, shotId: string) =>
  message(id, [{ kind: 'shot', shotId, summary: { shotId } as unknown as ShotSummary }]);
const searching = (id: string) =>
  message(id, [{ kind: 'notice', tone: 'info', text: 'Looking for that shot in Decaid…', progress: { value: 0.2, label: 'Try 2 of 6' } }]);
const notice = (id: string) => message(id, [{ kind: 'notice', tone: 'warning', text: 'That shot ran "Other", not v4.' }]);

/** jsdom fires hashchange from a queued task: let it land and React catch up. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });

const text = (id: string) => screen.getByTestId(id).textContent;

function renderHarness(messages: CoachUiMessage[] = []): FakeServices {
  const services = createFakeServices({ coach: { messages } });
  renderWithServices(<Harness />, services);
  return services;
}

const start = (services: FakeServices) => act(() => services.telemetry.emitShot({ type: 'started', shotId: 'shot-2' }));
const finish = (services: FakeServices) =>
  act(() => services.telemetry.emitShot({ type: 'finished', shotId: 'shot-2', stopReason: null }));
const addMessages = (services: FakeServices, ...added: CoachUiMessage[]) =>
  act(() => services.coach.setState({ messages: [...services.coach.getState().messages, ...added] }));

beforeEach(async () => {
  window.location.hash = '#/';
  await new Promise((resolve) => setImmediate(resolve));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isTextEntry', () => {
  it('is typing in a textarea, a text-like input or an editable element, and nothing else', () => {
    const make = (html: string) => {
      const host = document.createElement('div');
      host.innerHTML = html;
      return host.firstElementChild;
    };
    for (const html of [
      '<textarea></textarea>',
      '<input>',
      '<input type="text">',
      '<input type="search">',
      '<input type="email">',
      '<input type="url">',
      '<input type="tel">',
      '<input type="password">',
      '<input type="number">',
      '<div contenteditable="true"></div>',
    ]) {
      expect(isTextEntry(make(html)), html).toBe(true);
    }
    for (const html of ['<input type="checkbox">', '<input type="range">', '<button></button>', '<select></select>', '<div></div>']) {
      expect(isTextEntry(make(html)), html).toBe(false);
    }
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry(document.body)).toBe(false);
  });
});

describe('useShotFocus', () => {
  it('a shot start switches to #/shot by itself, replacing the entry instead of adding one', async () => {
    const services = renderHarness();
    const entries = window.history.length;
    start(services);
    expect(window.location.hash).toBe('#/shot');
    expect(window.history.length).toBe(entries);
    await settle();
    expect(text('route')).toBe('shot');
  });

  it('stays put while the barista is typing in a textarea or a text field', async () => {
    const services = renderHarness();
    act(() => screen.getByLabelText('Draft').focus());
    start(services);
    expect(window.location.hash).toBe('#/');

    finish(services);
    act(() => screen.getByLabelText('Search').focus());
    start(services);
    expect(window.location.hash).toBe('#/');
  });

  it('a focused checkbox or button is not typing: the shot still takes the screen', async () => {
    const services = renderHarness();
    act(() => screen.getByLabelText('Agree').focus());
    start(services);
    expect(window.location.hash).toBe('#/shot');
  });

  it('on #/shot already, a shot neither switches nor sends the barista back afterwards', async () => {
    window.location.hash = '#/shot';
    await settle();
    const services = renderHarness();
    start(services);
    finish(services);
    addMessages(services, card('m-card', 'shot-2'));
    await settle();
    expect(window.location.hash).toBe('#/shot');
    expect(screen.getByTestId('guard')).toHaveTextContent('none');
  });

  it('goes back to the coach once the shot card is in the chat, waiting meanwhile', async () => {
    const services = renderHarness([card('m-old', 'shot-1')]);
    start(services);
    await settle();
    expect(text('awaiting')).toBe('false');

    finish(services);
    expect(text('awaiting')).toBe('true');
    // Something else changing in the chat, with only the last shot's card in it, is no outcome.
    act(() => services.coach.setState({ busy: true }));
    expect(window.location.hash).toBe('#/shot');

    addMessages(services, card('m-card', 'shot-2'));
    expect(window.location.hash).toBe('#/');
    expect(text('awaiting')).toBe('false');
    await settle();
    expect(text('route')).toBe('coach');
  });

  it("the search notice is no outcome; the notice that follows it is", async () => {
    const services = renderHarness();
    start(services);
    await settle();
    finish(services);

    addMessages(services, searching('m-search'));
    expect(window.location.hash).toBe('#/shot');
    expect(text('awaiting')).toBe('true');

    // The search ends (its notice goes) with a notice that says what became of the shot.
    act(() => services.coach.setState({ messages: [notice('m-notice')] }));
    expect(window.location.hash).toBe('#/');
  });

  it(`goes back anyway ${OUTCOME_WAIT_MS / 1000} s after the shot finished with no outcome`, async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const services = renderHarness();
    start(services);
    await settle();
    finish(services);

    act(() => vi.advanceTimersByTime(OUTCOME_WAIT_MS - 1000));
    expect(window.location.hash).toBe('#/shot');
    expect(text('awaiting')).toBe('true');
    act(() => vi.advanceTimersByTime(1000));
    expect(window.location.hash).toBe('#/');
    expect(text('awaiting')).toBe('false');
  });

  it("a move of the barista's during the shot wins: no automatic return for it", async () => {
    const services = renderHarness();
    start(services);
    await settle();
    // Away and back again: the Shot route, but by the barista's choice now.
    act(() => navigate({ name: 'coach' }));
    await settle();
    act(() => navigate({ name: 'shot' }));
    await settle();

    finish(services);
    addMessages(services, card('m-card', 'shot-2'));
    await settle();
    expect(window.location.hash).toBe('#/shot');
    expect(text('route')).toBe('shot');
  });

  it('the next shot switches by itself again', async () => {
    const services = renderHarness();
    start(services);
    await settle();
    act(() => navigate({ name: 'history' }));
    await settle();
    finish(services);
    addMessages(services, card('m-card', 'shot-2'));
    expect(window.location.hash).toBe('#/history');

    start(services);
    expect(window.location.hash).toBe('#/shot');
  });

  it(`guards the screen for ${GUARD_MS} ms after each switch it makes`, async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const services = renderHarness();
    expect(text('guard')).toBe('none');

    const switchedAt = Date.now();
    start(services);
    expect(text('guard')).toBe(String(switchedAt + GUARD_MS));
    act(() => vi.advanceTimersByTime(GUARD_MS - 1));
    expect(text('guard')).toBe(String(switchedAt + GUARD_MS));
    act(() => vi.advanceTimersByTime(1));
    expect(text('guard')).toBe('none');

    await settle();
    finish(services);
    act(() => vi.advanceTimersByTime(500));
    const backAt = Date.now();
    addMessages(services, card('m-card', 'shot-2'));
    expect(window.location.hash).toBe('#/');
    expect(text('guard')).toBe(String(backAt + GUARD_MS));
    act(() => vi.advanceTimersByTime(GUARD_MS));
    expect(text('guard')).toBe('none');
  });

  it('a navigation of the barista is never guarded', async () => {
    renderHarness();
    act(() => navigate({ name: 'shot' }));
    await settle();
    expect(text('route')).toBe('shot');
    expect(text('guard')).toBe('none');
  });
});
