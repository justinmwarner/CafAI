// @vitest-environment jsdom
import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeServices } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { TID } from '../testIds.ts';
import { embedUrl, watchUrl } from './careGuide.ts';
import { CareScreen, WIDE_FROM } from './CareScreen.tsx';
import type { RoutineId } from './routines.ts';

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

/** The screen's own width, as useOwnLayout reads it (jsdom lays nothing out). */
function ownWidth(width: number) {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => width);
}

function care(options: { routine?: RoutineId; width?: number; insideDecaid?: boolean; platform?: string | null } = {}) {
  ownWidth(options.width ?? 962);
  const onRoutine = vi.fn();
  const onBack = vi.fn();
  const services = createFakeServices({ insideDecaid: options.insideDecaid, platform: options.platform });
  const view = renderWithServices(<CareScreen routine={options.routine ?? 'daily'} onRoutine={onRoutine} onBack={onBack} />, services);
  return { ...view, onRoutine, onBack };
}

describe('CareScreen', () => {
  it('opens on the routine it is given, with the routines and the title', () => {
    care({ routine: 'weekly' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Machine care');
    expect(screen.getByRole('tab', { name: 'Weekly' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Weekly' })).toHaveTextContent('Steam Rinza through the wand');
  });

  it('a segment asks the app for that routine', async () => {
    const { onRoutine } = care();
    await userEvent.click(screen.getByTestId(TID.careSegment('monthly')));
    expect(onRoutine).toHaveBeenCalledWith('monthly');
  });

  it('the back arrow goes to Settings', async () => {
    const { onBack } = care();
    await userEvent.click(screen.getByRole('button', { name: 'Back to Settings' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('nothing from YouTube until a tap; a moment then plays in place, marked', async () => {
    care();
    expect(document.querySelector('iframe')).toBeNull();
    await userEvent.click(screen.getByTestId(TID.careMoment('flush-group')));
    expect(screen.getByTestId(TID.carePlayer)).toHaveAttribute('src', embedUrl(108));
    expect(screen.getByTestId(TID.careMoment('flush-group'))).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId(TID.careVideo)).toHaveTextContent('Playing from 1:48: Flush the group head');
  });

  it('another moment moves the player; the same one starts it again', async () => {
    care();
    await userEvent.click(screen.getByTestId(TID.careMoment('flush-group')));
    const first = screen.getByTestId(TID.carePlayer);
    await userEvent.click(screen.getByTestId(TID.careMoment('daily')));
    expect(screen.getByTestId(TID.carePlayer)).toHaveAttribute('src', embedUrl(20));
    expect(screen.getByTestId(TID.careMoment('flush-group'))).toHaveAttribute('aria-pressed', 'false');
    const second = screen.getByTestId(TID.carePlayer);
    await userEvent.click(screen.getByTestId(TID.careMoment('daily')));
    expect(screen.getByTestId(TID.carePlayer)).not.toBe(second);
    expect(second).not.toBe(first);
  });

  it('the poster plays from the start', async () => {
    care();
    await userEvent.click(screen.getByTestId(TID.carePoster));
    expect(screen.getByTestId(TID.carePlayer)).toHaveAttribute('src', embedUrl(0));
  });

  it('the player keeps playing when the routine changes', async () => {
    const { rerenderWith, onRoutine, onBack } = care();
    await userEvent.click(screen.getByTestId(TID.careMoment('flush-group')));
    const player = screen.getByTestId(TID.carePlayer);
    rerenderWith(<CareScreen routine="weekly" onRoutine={onRoutine} onBack={onBack} />);
    expect(screen.getByTestId(TID.carePlayer)).toBe(player);
  });

  it('wide: the steps numbered, the poster in full', () => {
    care({ width: WIDE_FROM });
    expect(screen.getByTestId(TID.careStep('flush-group'))).toHaveTextContent(/^2/);
    expect(screen.getByTestId(TID.carePoster)).toHaveTextContent("Play Decent's video");
  });

  it('narrow: no numbers, the short row, and the player kept when the width crosses the line', async () => {
    let width = WIDE_FROM - 1;
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    const services = createFakeServices();
    renderWithServices(<CareScreen routine="daily" onRoutine={vi.fn()} onBack={vi.fn()} />, services);
    expect(screen.getByTestId(TID.careStep('flush-group'))).not.toHaveTextContent(/^2/);
    expect(screen.getByTestId(TID.carePoster)).toHaveTextContent("Decent's video · 22 min");
    await userEvent.click(screen.getByTestId(TID.careMoment('flush-group')));
    const player = screen.getByTestId(TID.carePlayer);
    width = WIDE_FROM + 200;
    act(() => void window.dispatchEvent(new Event('resize')));
    expect(screen.getByTestId(TID.careStep('flush-group'))).toHaveTextContent(/^2/);
    expect(screen.getByTestId(TID.carePlayer)).toBe(player);
  });

  it('inside Decaid off Android: links, no poster, nothing framed', () => {
    care({ routine: 'monthly', insideDecaid: true, platform: 'windows' });
    expect(screen.queryByTestId(TID.carePoster)).toBeNull();
    const moment = screen.getByTestId(TID.careMoment('group-parts'));
    expect(moment).toHaveAttribute('href', watchUrl(1016));
    expect(moment).not.toHaveAttribute('target');
    expect(screen.getByTestId(TID.careWatch)).toHaveAttribute('href', watchUrl());
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('inside Decaid on Android: in place, and its links open in the system browser', () => {
    care({ routine: 'asNeeded', insideDecaid: true, platform: 'android' });
    expect(screen.getByTestId(TID.carePoster)).toBeInTheDocument();
    expect(screen.getByTestId(TID.careWatch)).not.toHaveAttribute('target');
    expect(screen.getByTestId(TID.careLink('descale'))).not.toHaveAttribute('target');
  });

  it("in a browser, links open a new tab", () => {
    care({ routine: 'asNeeded' });
    expect(screen.getByTestId(TID.careWatch)).toHaveAttribute('target', '_blank');
    expect(screen.getByTestId(TID.careLink('steam-tip'))).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
