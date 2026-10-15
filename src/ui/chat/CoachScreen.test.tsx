// @vitest-environment jsdom
import './testing/setup.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CoachState, CoachUiMessage } from '../../app/types.ts';
import type { LiveSample, ShotStateEvent } from '../../api/types.ts';
import { createFakeServices, IDLE_TELEMETRY, type FakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { CoachScreen } from './CoachScreen.tsx';
import { BAG_FROM_PHOTO, BEAN_OPTIONS, KIAMBU, SANTOS, coachStateFor } from './testing/fixtures.ts';
import { renderWithServices } from './testing/render.tsx';

function renderCoach(coach: Partial<CoachState>): FakeServices {
  const services = createFakeServices({ coach });
  renderWithServices(<CoachScreen />, services);
  return services;
}

const methods = (services: FakeServices) => services.coach.calls.map((c) => c.method);

function shotStateEvent(state: ShotStateEvent['state']): ShotStateEvent {
  return {
    event: 'state',
    timestamp: '2026-10-03T08:00:00.000000',
    shotId: 'shot-1',
    state,
    machineState: null,
    machineSubstate: null,
    profileFrame: null,
    scaleConnected: true,
    scaleLost: false,
    machineHasAutonomousSAW: false,
    decision: null,
  };
}

/** jsdom's own window size (a tablet), restored after each test. */
const JSDOM_VIEWPORT = { width: window.innerWidth, height: window.innerHeight };

/** Makes the window another size for a test, as a phone or a rotation would. */
function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  window.dispatchEvent(new Event('resize'));
}

/** A pouring frame, minimal enough for the shot trace to record it. */
function sample(tS: number): LiveSample {
  return {
    tS,
    machine: { ...IDLE_TELEMETRY.machine!, state: { state: 'espresso', substate: 'pouring' }, pressure: 9, flow: 2 },
    scale: { timestamp: '', weight: tS * 1.5, weightFlow: 1.5, battery: null, timerValue: null },
  };
}

function said(id: string, role: CoachUiMessage['role'], text: string): CoachUiMessage {
  return { id, role, parts: [{ kind: 'text', text }], createdAt: '2026-10-03T09:00:00.000Z' };
}

/** A transient progress notice, which the engine removes once the work is done. */
function progress(id: string): CoachUiMessage {
  return {
    id,
    role: 'system',
    parts: [{ kind: 'notice', tone: 'info', text: 'Looking for that shot in Decaid…', progress: { value: null, label: null } }],
    createdAt: '2026-10-03T09:00:00.000Z',
  };
}

/** The thread's rows (x-chat's articles), oldest first. */
function rows(): HTMLElement[] {
  return within(screen.getByTestId(TID.chat)).getAllByRole('article');
}

/** The stats card is in the chat once, as its newest row. */
function expectCardLast() {
  const all = rows();
  expect(screen.getAllByTestId(TID.statsCard)).toHaveLength(1);
  expect(within(all[all.length - 1]!).getByTestId(TID.statsCard)).toBeInTheDocument();
}

const SANTOS_CHAT: CoachUiMessage[] = [said('s-1', 'assistant', 'Santos v1 is on the machine. Pull a shot when you are ready.')];

describe('CoachScreen', () => {
  afterEach(() => {
    window.location.hash = '';
    // Unmounted first, so the resize re-renders nothing outside act().
    cleanup();
    setViewport(JSDOM_VIEWPORT.width, JSDOM_VIEWPORT.height);
  });

  it('waits for the engine to load', () => {
    renderCoach({ ready: false });
    expect(screen.getByText('Loading your bags…')).toBeInTheDocument();
    expect(screen.queryByTestId(TID.chat)).toBeNull();
  });

  it('asks for an API key before anything else', () => {
    renderCoach({ ...coachStateFor('diff'), hasApiKey: false });
    expect(screen.getByText('Add your Anthropic API key to start coaching')).toBeInTheDocument();
    // A phone's browser keeps its own key: the copy names no tablet. A copy in Decaid is the user's choice (D99).
    expect(
      screen.getByText(
        'The key stays on this device unless you choose in Settings to keep a copy in Decaid. You pay Anthropic directly for what the coach uses.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '#/settings');
    expect(screen.queryByTestId(TID.chat)).toBeNull();
    expect(screen.queryByTestId(TID.newBag)).toBeNull();
    // CafAI is an everyday skin before the coach can start: the machine stays on screen.
    expect(screen.getByTestId(TID.statsCard)).toBeInTheDocument();
  });

  it("says the bags came from Decaid's backup only when they did and the key did not (5.5)", () => {
    // True after a Decaid update or cleared storage, and on a phone's first visit alike: nothing here says which.
    const again = "Your bags came from Decaid's backup. Paste your API key to go on.";
    renderCoach({ ...coachStateFor('diff'), hasApiKey: false, restoredFromBackup: true });
    expect(screen.getByText(again)).toBeInTheDocument();
    expect(screen.queryByText(/storage was cleared|key again/)).toBeNull();
    expect(screen.getByText('Add your Anthropic API key to start coaching')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '#/settings');
    cleanup();

    renderCoach({ ...coachStateFor('diff'), hasApiKey: false });
    expect(screen.queryByText(again)).toBeNull();
    cleanup();

    renderCoach({ ...coachStateFor('diff'), hasApiKey: true, restoredFromBackup: true });
    expect(screen.queryByText(again)).toBeNull();
    expect(screen.getByTestId(TID.chat)).toBeInTheDocument();
  });

  it('offers one large New bag button when there are no bags', async () => {
    const services = renderCoach({ ready: true, hasApiKey: true, bags: [], phase: 'no_bag' });
    expect(screen.getByText('Dial in your first bag')).toBeInTheDocument();
    expect(screen.queryByTestId(TID.bagPicker)).toBeNull();
    expect(screen.getAllByTestId(TID.newBag)).toHaveLength(1);
    expect(screen.getByTestId(TID.statsCard)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(TID.newBag));
    expect(methods(services)).toEqual(['newBag']);
  });

  it('lets an existing bag be picked when none is active', async () => {
    const services = renderCoach({ ready: true, hasApiKey: true, bags: [KIAMBU, SANTOS], activeBag: null, phase: 'no_bag' });
    expect(screen.getByText('Pick a bag above, or start a new one')).toBeInTheDocument();
    expect(screen.getAllByTestId(TID.newBag)).toHaveLength(1);
    await userEvent.selectOptions(screen.getByTestId(TID.bagPicker), SANTOS.id);
    expect(services.coach.calls).toEqual([{ method: 'selectBag', args: [SANTOS.id] }]);
  });

  it('shows the bag, its active version and the chat', async () => {
    const services = renderCoach(coachStateFor('options'));
    const picker = screen.getByTestId(TID.bagPicker);
    expect(picker).toHaveValue(KIAMBU.id);
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Kiambu AA', 'Brazil Santos']);
    expect(screen.getByTestId(TID.activeVersion)).toHaveTextContent('Kiambu AA v1');
    expect(screen.getByTestId(TID.chat)).toBeInTheDocument();
    expect(screen.getByTestId(TID.composerInput)).toHaveAttribute('placeholder', 'Tap an answer, or say how it tasted');

    await userEvent.selectOptions(picker, SANTOS.id);
    expect(services.coach.calls).toEqual([{ method: 'selectBag', args: [SANTOS.id] }]);
  });

  it('shows the version quietly beside the bag, with its starting profile', () => {
    renderCoach(coachStateFor('options'));
    const version = screen.getByTestId(TID.activeVersion);
    // The whole title is still in the text for screen readers; the bag's name repeats the picker, so only "v1" shows.
    expect(version).toHaveTextContent('Kiambu AA v1 · Blooming Espresso');
    expect(within(version).getByText('v1')).toBeVisible();
  });

  it('keeps the space before the dot, so the version reads "v1 · Blooming Espresso" like the other separators', () => {
    renderCoach(coachStateFor('options'));
    const rest = [...screen.getByTestId(TID.activeVersion).children].find((child) => child.textContent === ' · Blooming Espresso');
    // A flex item drops its leading space unless white space is kept (jsdom lays nothing out to show it).
    expect(rest).toHaveStyle({ whiteSpace: 'pre' });
  });

  it('names the bag picker for screen readers without a visible label', () => {
    renderCoach(coachStateFor('options'));
    expect(screen.getByRole('combobox', { name: 'Bag' })).toBe(screen.getByTestId(TID.bagPicker));
  });

  const placeholder = () => screen.getByTestId(TID.composerInput).getAttribute('placeholder');

  it('invites the taste in the composer only while the open question is about the taste', () => {
    renderCoach(coachStateFor('options-multi'));
    expect(placeholder()).toBe('Tap an answer, or type your own');
  });

  it('invites the taste for an open question stored before CafAI marked taste questions', () => {
    const state = coachStateFor('options-multi');
    const messages = state.messages!.map((m) => ({
      ...m,
      parts: m.parts.map((p) => (p.kind === 'options' ? { ...p, taste: undefined } : p)),
    }));
    renderCoach({ ...state, messages });
    expect(placeholder()).toBe('Tap an answer, or say how it tasted');
  });

  it('tells same-named bags apart in the picker by when they were started', () => {
    const twin = { ...SANTOS, id: 'bag-twin', name: 'Kiambu AA', createdAt: '2026-09-20T07:00:00.000Z' };
    renderCoach({ ...coachStateFor('options'), bags: [KIAMBU, twin] });
    const labels = within(screen.getByTestId(TID.bagPicker))
      .getAllByRole('option')
      .map((o) => o.textContent ?? '');
    expect(labels).toHaveLength(2);
    expect(labels.every((label) => label.startsWith('Kiambu AA · '))).toBe(true);
    expect(new Set(labels).size).toBe(2);
  });

  it('says when no profile is loaded yet', () => {
    renderCoach(coachStateFor('templates'));
    expect(screen.getByTestId(TID.activeVersion)).toHaveTextContent('No profile yet');
  });

  it('starts a new bag from the header', async () => {
    const services = renderCoach(coachStateFor('shot'));
    await userEvent.click(screen.getByTestId(TID.newBag));
    expect(methods(services)).toEqual(['newBag']);
  });

  it('shows Undo in the header only when the change can be undone', async () => {
    const services = renderCoach(coachStateFor('shot'));
    expect(screen.queryByTestId(TID.undoButton)).toBeNull();
    act(() => services.coach.setState({ canUndo: true }));
    await userEvent.click(screen.getByTestId(TID.undoButton));
    expect(methods(services)).toEqual(['undo']);
  });

  it('keeps Undo and New bag as labelled buttons in the header on a tablet', () => {
    renderCoach({ ...coachStateFor('shot'), canUndo: true });
    for (const [testId, label] of [
      [TID.undoButton, 'Undo'],
      [TID.newBag, 'New bag'],
    ] as const) {
      const button = screen.getByTestId(testId);
      expect(button).toHaveClass('MuiButton-root');
      expect(button).toHaveTextContent(label);
    }
  });

  it('makes Undo and New bag 48 px icon buttons on a phone, named for screen readers, so the bag header keeps to one row', async () => {
    setViewport(390, 844);
    const services = renderCoach({ ...coachStateFor('shot'), canUndo: true });
    const header = screen.getByRole('banner', { name: 'Bag' });
    for (const [testId, label] of [
      [TID.undoButton, 'Undo'],
      [TID.newBag, 'New bag'],
    ] as const) {
      const button = screen.getByTestId(testId);
      expect(button).toBe(within(header).getByRole('button', { name: label }));
      expect(button).toHaveClass('MuiIconButton-root');
      expect(button).not.toHaveClass('MuiButton-root');
      // The icon alone: no visible label beside it.
      expect(button).toHaveTextContent('');
      expect(button.querySelector('svg')).not.toBeNull();
    }
    expect(header).toHaveStyle({ flexWrap: 'nowrap' });

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await userEvent.click(screen.getByRole('button', { name: 'New bag' }));
    expect(methods(services)).toEqual(['undo', 'newBag']);

    // Rotated or resized back to a tablet: the labelled buttons again.
    act(() => setViewport(1024, 768));
    expect(screen.getByTestId(TID.newBag)).toHaveClass('MuiButton-root');
    expect(screen.getByTestId(TID.newBag)).toHaveTextContent('New bag');
  });

  it('shows errors with Retry and dismiss', async () => {
    const services = renderCoach(coachStateFor('diff'));
    expect(screen.queryByTestId(TID.errorBanner)).toBeNull();
    act(() => services.coach.setState({ error: 'The coach could not be reached.' }));
    expect(screen.getByTestId(TID.errorBanner)).toHaveTextContent('The coach could not be reached.');
    await userEvent.click(screen.getByTestId(TID.retryButton));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(methods(services)).toEqual(['retry', 'dismissError']);
  });

  it('sends what the barista types', async () => {
    const services = renderCoach(coachStateFor('intake'));
    await userEvent.type(screen.getByTestId(TID.composerInput), 'Kiambu AA, washed, light{Enter}');
    await waitFor(() => expect(services.coach.calls).toEqual([{ method: 'sendText', args: ['Kiambu AA, washed, light'] }]));
  });

  it('passes card taps to the controller', async () => {
    const services = renderCoach(coachStateFor('templates'));
    await userEvent.click(screen.getByTestId(TID.templatePick('blooming-espresso')));
    act(() => services.coach.setState(coachStateFor('diff')));
    await userEvent.click(screen.getByTestId(TID.diffConfirm));
    expect(services.coach.calls).toEqual([
      { method: 'pickTemplate', args: ['tu-templates', 'blooming-espresso'] },
      { method: 'confirmChange', args: ['tu-adjust'] },
    ]);
  });

  it("passes the bean card's answers and the photo's confirmed details to the controller (6.1, 6.8)", async () => {
    const at = '2026-10-03T09:00:00.000Z';
    const bean: CoachUiMessage = { id: 'm-bean', role: 'assistant', parts: [{ kind: 'beanPicker', options: BEAN_OPTIONS, choice: null }], createdAt: at };
    const services = createFakeServices({ coach: { ...coachStateFor('intake'), messages: [bean] } });
    const asked: Array<[string, unknown[]]> = [];
    services.coach.pickBean = async (...args) => void asked.push(['pickBean', args]);
    services.coach.skipBeanPick = async () => void asked.push(['skipBeanPick', []]);
    services.coach.confirmBag = async (...args) => void asked.push(['confirmBag', args]);
    renderWithServices(<CoachScreen />, services);
    await userEvent.click(screen.getAllByTestId(TID.beanOption)[0]!);
    await userEvent.click(screen.getByTestId(TID.beanSomethingElse));
    act(() =>
      services.coach.setState({
        messages: [bean, { id: 'm-confirm', role: 'assistant', parts: [{ kind: 'bagConfirm', details: BAG_FROM_PHOTO, confirmed: false }], createdAt: at }],
      }),
    );
    await userEvent.click(within(screen.getByTestId(TID.bagConfirm)).getByRole('button', { name: 'Confirm' }));
    expect(asked).toEqual([
      ['pickBean', ['batch-red']],
      ['skipBeanPick', []],
      ['confirmBag', [BAG_FROM_PHOTO]],
    ]);
  });

  it('passes a verdict to the controller (D126)', async () => {
    const services = renderCoach(coachStateFor('options'));
    await userEvent.click(screen.getByRole('radio', { name: 'Much better' }));
    expect(services.coach.calls).toEqual([{ method: 'rateShot', args: ['shot-1', 'muchBetter'] }]);
  });

  it('passes a TDS saved on a shot card to the controller (D-TDS-1)', async () => {
    const services = renderCoach(coachStateFor('options'));
    await userEvent.click(screen.getByRole('button', { name: 'Add TDS' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'TDS' }), '9,3{Enter}');
    expect(services.coach.calls).toEqual([{ method: 'setShotTds', args: ['shot-1', 9.3] }]);
  });

  it('shows Graph on the finished shot card, and opens the shot route from it', async () => {
    const services = createFakeServices({ coach: coachStateFor('shot') });
    renderWithServices(<CoachScreen />, services);
    act(() => {
      services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' });
      services.telemetry.emitSample(sample(0));
      services.telemetry.emitSample(sample(1));
      services.telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: null });
    });
    const card = screen.getByTestId(TID.shotCard);
    await userEvent.click(within(card).getByTestId(TID.openShotGraph));
    expect(window.location.hash).toBe('#/shot');
  });

  it('keeps the bag on screen while a shot is pulled', () => {
    const services = createFakeServices({ coach: coachStateFor('applied') });
    renderWithServices(<CoachScreen />, services);
    expect(screen.getByTestId(TID.bagPicker)).toBeEnabled();
    act(() => services.telemetry.setState({ shotState: shotStateEvent('pouring') }));
    expect(screen.getByTestId(TID.newBag)).toBeDisabled();
    expect(screen.getByTestId(TID.bagPicker)).toBeDisabled();
    act(() => services.telemetry.setState({ shotState: shotStateEvent('finished') }));
    expect(screen.getByTestId(TID.bagPicker)).toBeEnabled();
  });

  it('disables the header actions while the coach is busy', () => {
    renderCoach({ ...coachStateFor('applied'), busy: true });
    expect(screen.getByTestId(TID.newBag)).toBeDisabled();
    expect(screen.getByTestId(TID.bagPicker)).toBeDisabled();
    for (const undo of [...screen.getAllByTestId(TID.undoButton), ...screen.queryAllByTestId(TID.diffUndo)]) expect(undo).toBeDisabled();
  });

  describe('the stats card', () => {
    it('is posted after the newest message when the chat first shows', () => {
      renderCoach(coachStateFor('options'));
      expectCardLast();
      const all = rows();
      expect(within(all[all.length - 2]!).getByTestId(TID.optionChip('Sour / sharp'))).toBeInTheDocument();
    });

    it('comes before nothing but the thinking row while the coach works', () => {
      renderCoach({ ...coachStateFor('intake'), busy: true });
      const all = rows();
      expect(within(all[all.length - 2]!).getByTestId(TID.statsCard)).toBeInTheDocument();
      expect(all[all.length - 1]).toHaveTextContent('Thinking…');
    });

    it('waits for the chat: under the key card while there is no key, posted when the chat first shows', () => {
      const services = renderCoach({ ...coachStateFor('options'), hasApiKey: false });
      // Before the coach can start, the setup screen carries the machine's card itself.
      expect(screen.queryByTestId(TID.chat)).toBeNull();
      expect(screen.getByTestId(TID.statsCard)).toBeInTheDocument();
      act(() => services.coach.setState({ hasApiKey: true }));
      expectCardLast();
    });

    it('goes once a message is sent, and Stats brings it back at the end, with no coach call', async () => {
      const state = coachStateFor('intake');
      const services = renderCoach(state);
      expectCardLast();
      await userEvent.type(screen.getByTestId(TID.composerInput), 'Kiambu AA, washed{Enter}');
      await waitFor(() => expect(methods(services)).toEqual(['sendText']));
      // The engine puts the barista's words in the chat.
      act(() => services.coach.setState({ messages: [...state.messages!, said('u-1', 'user', 'Kiambu AA, washed')] }));
      expect(screen.queryByTestId(TID.statsCard)).toBeNull();

      await userEvent.click(screen.getByTestId(TID.statsPrompt));
      expectCardLast();
      expect(within(rows()[rows().length - 2]!).getByText('Kiambu AA, washed')).toBeInTheDocument();
      expect(methods(services)).toEqual(['sendText']);
    });

    it('goes for good when anything new lands, even if that goes again', () => {
      const state = coachStateFor('applied');
      const services = renderCoach(state);
      expectCardLast();
      act(() => services.coach.setState({ messages: [...state.messages!, progress('p-1')] }));
      expect(screen.queryByTestId(TID.statsCard)).toBeNull();
      // The engine removes the progress notice once the work is done: the card stays gone.
      act(() => services.coach.setState({ messages: state.messages! }));
      expect(screen.queryByTestId(TID.statsCard)).toBeNull();
    });

    it('stays where it is while the newest message only changes inside', () => {
      const state = coachStateFor('options');
      const services = renderCoach(state);
      // A verdict updates the shot card in place: nothing new landed.
      const rated = state.messages!.map((m) => ({
        ...m,
        parts: m.parts.map((p) => (p.kind === 'shot' ? { ...p, rating: { verdict: 'better' as const, score: 5 } } : p)),
      }));
      act(() => services.coach.setState({ messages: rated }));
      expectCardLast();
    });

    it('goes when another bag opens, and does not come back with the first bag', async () => {
      const services = renderCoach(coachStateFor('options'));
      expectCardLast();
      act(() => services.coach.setState({ activeBag: SANTOS, messages: SANTOS_CHAT }));
      expect(screen.queryByTestId(TID.statsCard)).toBeNull();
      act(() => services.coach.setState(coachStateFor('options')));
      expect(screen.queryByTestId(TID.statsCard)).toBeNull();
      // Stats posts it in the chat on screen.
      await userEvent.click(screen.getByTestId(TID.statsPrompt));
      expectCardLast();
    });

    it('is still there after a visit to another screen if nothing new landed', () => {
      const services = createFakeServices({ coach: coachStateFor('options') });
      renderWithServices(<CoachScreen />, services).unmount();
      renderWithServices(<CoachScreen />, services);
      expectCardLast();
    });

    it('is gone after a visit to another screen if something landed meanwhile', () => {
      const state = coachStateFor('options');
      const services = createFakeServices({ coach: state });
      renderWithServices(<CoachScreen />, services).unmount();
      act(() => services.coach.setState({ messages: [...state.messages!, said('a-9', 'assistant', 'Ready when you are.')] }));
      renderWithServices(<CoachScreen />, services);
      expect(screen.queryByTestId(TID.statsCard)).toBeNull();
      expect(screen.getByTestId(TID.statsPrompt)).toBeInTheDocument();
    });

    it('is posted once a session, and again after a reload', () => {
      const services = renderCoach(coachStateFor('options'));
      act(() => services.coach.setState({ activeBag: SANTOS, messages: SANTOS_CHAT }));
      cleanup();
      // The chat shows again in the same session: no second post.
      renderWithServices(<CoachScreen />, services);
      expect(screen.queryByTestId(TID.statsCard)).toBeNull();
      cleanup();
      // A reload builds the services anew.
      renderWithServices(<CoachScreen />, createFakeServices({ coach: { ...coachStateFor('options'), activeBag: SANTOS, messages: SANTOS_CHAT } }));
      expectCardLast();
    });

    it('shows in an empty chat until the first message', () => {
      const services = renderCoach({ ...coachStateFor('intake'), messages: [] });
      expectCardLast();
      act(() => services.coach.setState({ messages: [said('a-1', 'assistant', 'Tell me about the coffee.')] }));
      expect(screen.queryByTestId(TID.statsCard)).toBeNull();
    });

    it('never reaches the coach, the stored conversation or the export', async () => {
      const state = coachStateFor('options');
      const services = renderCoach(state);
      act(() => services.coach.setState({ messages: [...state.messages!, said('u-1', 'user', 'Sour / sharp')] }));
      await userEvent.click(screen.getByTestId(TID.statsPrompt));
      expectCardLast();
      expect(services.coach.calls).toEqual([]);
      expect(services.coach.getState().messages.map((m) => m.id)).not.toContain('cafai-stats');
      expect(JSON.stringify(services.coach.getState().messages)).not.toContain('cafai-stats');
      expect(JSON.stringify(await services.storage.porter.exportAll())).not.toContain('cafai-stats');
    });

    it('has its Stats prompt above the composer on a tablet and on a phone', () => {
      renderCoach(coachStateFor('options'));
      expect(screen.getByTestId(TID.statsPrompt)).toHaveTextContent('Stats');
      act(() => setViewport(390, 844));
      expect(screen.getByTestId(TID.statsPrompt)).toHaveTextContent('Stats');
    });
  });
});
