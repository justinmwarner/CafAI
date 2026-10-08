// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import type { CoachState } from '../../app/types.ts';
import { makeBag, makeVersion } from '../../storage/testing/fixtures.ts';
import { TID } from '../testIds.ts';
import { createFakeServices, type FakeServices } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { CoachNote } from './CoachNote.tsx';
import { LoadedProfileContextForTests } from './LoadedProfileContext.tsx';
import type { LoadedProfileState } from './useLoadedProfile.ts';

const BAG = makeBag({ id: 'bag_1', name: 'Kiambu AA', activeVersionId: 'ver_2' });
const V2 = makeVersion({ id: 'ver_2', bagId: 'bag_1', version: 2, title: 'Kiambu AA v2' });
const COACHING: Partial<CoachState> = { activeBag: BAG, activeVersion: V2, versions: [V2], phase: 'awaiting_shot' };

const WATCHING = "I'm watching this shot. I'll read the curves once it's done.";

/**
 * The shared loaded-profile reading, set by the test (LoadedProfileContextForTests)
 * rather than read from a fake workflow: the note's rows are about the
 * reading's values, and how a workflow becomes them is LoadedProfile's tests.
 * By default the bag's version, on the machine.
 */
function reading(patch: Partial<LoadedProfileState> = {}): LoadedProfileState {
  return { title: 'Kiambu AA v2', mark: 'thisBag', stepNames: null, targetYieldG: 36, ...patch };
}

function withReading(value: LoadedProfileState, node: ReactElement): ReactElement {
  return <LoadedProfileContextForTests.Provider value={value}>{node}</LoadedProfileContextForTests.Provider>;
}

const note = () => screen.getByTestId(TID.coachNote);

/** Decaid starts a shot: the app-wide trace goes live, as the graph sees it. */
function startShot(services: FakeServices) {
  act(() => services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' }));
}

/** The note during a running shot, for this coach state and (optionally) shared reading. */
function noteDuringShot(coach: Partial<CoachState>, shared?: LoadedProfileState) {
  const services = createFakeServices({ coach });
  const ui = <CoachNote awaitingOutcome={false} />;
  renderWithServices(shared ? withReading(shared, ui) : ui, services);
  startShot(services);
  return note();
}

describe('CoachNote', () => {
  it('renders nothing when no shot is running and nothing is awaited', () => {
    const services = createFakeServices({ coach: COACHING });
    renderWithServices(withReading(reading(), <CoachNote awaitingOutcome={false} />), services);
    expect(screen.queryByTestId(TID.coachNote)).not.toBeInTheDocument();

    startShot(services);
    expect(note()).toBeInTheDocument();
    // Over, with nothing to wait for (the outcome is in the chat): gone.
    act(() => services.telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: 'targetWeight' }));
    expect(screen.queryByTestId(TID.coachNote)).not.toBeInTheDocument();
  });

  it('is a status region, its avatar hidden from screen readers', () => {
    const shown = noteDuringShot(COACHING, reading());
    expect(screen.getByRole('status')).toBe(shown);
    expect(shown.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('says it is reading the shot once the pour is over and the chat has no outcome yet', () => {
    // No shot running, nothing about the profile known: the wait alone shows the note, and wins over every other row.
    renderWithServices(<CoachNote awaitingOutcome />, createFakeServices({ coach: { ...COACHING, hasApiKey: false } }));
    const shown = note();
    expect(shown).toHaveAttribute('role', 'status');
    // The dots stand for the full stop on screen; a screen reader gets the sentence.
    const visible = within(shown).getByText('Done. Reading the shot');
    expect(visible).toHaveAttribute('aria-hidden', 'true');
    expect(visible.lastElementChild?.children).toHaveLength(3);
    expect(within(shown).getByText('Done. Reading the shot.')).not.toHaveAttribute('aria-hidden');
    expect(shown).not.toHaveTextContent(WATCHING);
    expect(shown).not.toHaveTextContent('API key');
  });

  it('asks for the API key when there is none', () => {
    expect(noteDuringShot({ ...COACHING, hasApiKey: false }, reading())).toHaveTextContent(
      "Add your API key in Settings, and I'll read your shots.",
    );
  });

  it('is not coaching a shot without a bag, or without a starting profile', () => {
    const NOT_COACHING = "I'm not coaching this one. Pick a bag and a starting profile, and I'll read your shots.";
    expect(noteDuringShot({}, reading({ title: 'Default', mark: null }))).toHaveTextContent(NOT_COACHING);
  });

  it('is not coaching a shot for a bag with no version yet', () => {
    expect(noteDuringShot({ activeBag: BAG, activeVersion: null, phase: 'choosing_template' }, reading())).toHaveTextContent(
      "I'm not coaching this one. Pick a bag and a starting profile, and I'll read your shots.",
    );
  });

  it("says the shot is not part of the dial-in when the machine runs another profile", () => {
    expect(noteDuringShot(COACHING, reading({ title: 'Default', mark: null }))).toHaveTextContent(
      'This shot runs "Default", not Kiambu AA v2, so it won\'t be part of this dial-in.',
    );
  });

  it('takes a profile title not read yet for no news', () => {
    expect(noteDuringShot(COACHING, reading({ title: null, mark: null }))).toHaveTextContent(WATCHING);
  });

  it('takes a blank profile title for no news either', () => {
    expect(noteDuringShot(COACHING, reading({ title: '  ', mark: null }))).toHaveTextContent(WATCHING);
  });

  it('warns the shot may not count while the version is loading', () => {
    expect(noteDuringShot(COACHING, reading({ mark: 'loading' }))).toHaveTextContent(
      "I'm watching, but Kiambu AA v2 isn't confirmed on the machine yet, so this shot may not count.",
    );
  });

  it('warns the shot may not count when the machine has not confirmed the version', () => {
    expect(noteDuringShot(COACHING, reading({ mark: 'notConfirmed' }))).toHaveTextContent(
      "I'm watching, but Kiambu AA v2 isn't confirmed on the machine yet, so this shot may not count.",
    );
  });

  it("is watching when the machine has the bag's version", () => {
    expect(noteDuringShot(COACHING, reading())).toHaveTextContent(WATCHING);
  });

  it('is watching outside the shell, where nothing is known about the profile on the machine', () => {
    expect(noteDuringShot(COACHING)).toHaveTextContent(WATCHING);
  });
});
