// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { TID } from '../testIds.ts';
import { embedUrl, watchUrl } from './careGuide.ts';
import { CareVideo, LOADS_FROM_YOUTUBE, OPENS_IN_BROWSER, type Playing } from './CareVideo.tsx';
import { MomentButton } from './MomentButton.tsx';

afterEach(() => cleanup());

const NEW_TAB = { target: '_blank' as const, rel: 'noopener noreferrer' };

function video(props: Partial<Parameters<typeof CareVideo>[0]> = {}) {
  const onPlayFromStart = vi.fn();
  renderWithServices(
    <CareVideo inPlace compact={false} playing={null} onPlayFromStart={onPlayFromStart} linkProps={NEW_TAB} {...props} />,
  );
  return { onPlayFromStart };
}

describe('CareVideo', () => {
  it("before a tap: CafAI's own poster, nothing framed, and Watch on YouTube", async () => {
    const { onPlayFromStart } = video();
    expect(screen.queryByTestId(TID.carePlayer)).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByText(LOADS_FROM_YOUTUBE)).toBeInTheDocument();
    const watch = screen.getByTestId(TID.careWatch);
    expect(watch).toHaveAttribute('href', watchUrl());
    expect(watch).toHaveAttribute('target', '_blank');
    await userEvent.click(screen.getByRole('button', { name: "Play Decent's video: How often/to clean DE1" }));
    expect(onPlayFromStart).toHaveBeenCalledTimes(1);
  });

  it('on a narrow screen, one short row until a tap', async () => {
    const { onPlayFromStart } = video({ compact: true });
    expect(screen.getByTestId(TID.carePoster)).toHaveTextContent("Decent's video · 22 min");
    expect(screen.queryByTestId(TID.careWatch)).toBeNull();
    await userEvent.click(screen.getByTestId(TID.carePoster));
    expect(onPlayFromStart).toHaveBeenCalledTimes(1);
  });

  it('playing: the player at the moment, and what plays', () => {
    const playing: Playing = { start: 108, key: 'flush-group', label: 'Flush the group head', take: 1 };
    video({ playing });
    const player = screen.getByTestId(TID.carePlayer);
    expect(player.tagName).toBe('IFRAME');
    expect(player).toHaveAttribute('src', embedUrl(108));
    expect(player).toHaveAttribute('title', "Decent's video: How often/to clean DE1");
    expect(player).toHaveAttribute('allow', expect.stringContaining('autoplay'));
    expect(player).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    expect(screen.getByText(/Playing from/)).toHaveTextContent('Playing from 1:48: Flush the group head');
  });

  it('from the poster: playing from the start', () => {
    video({ playing: { start: 0, key: 'poster', label: null, take: 1 } });
    expect(screen.getByText('Playing from the start')).toBeInTheDocument();
  });

  it('where it cannot play in place: no poster, no player, and the card says Decaid opens it', () => {
    video({ inPlace: false, linkProps: {} });
    expect(screen.queryByTestId(TID.carePoster)).toBeNull();
    expect(screen.queryByTestId(TID.carePlayer)).toBeNull();
    expect(screen.getByText(OPENS_IN_BROWSER)).toBeInTheDocument();
    expect(screen.getByTestId(TID.careWatch)).not.toHaveAttribute('target');
  });
});

describe('MomentButton', () => {
  it('in place: a button named for its time and what it shows, pressed while it plays', async () => {
    const onPlay = vi.fn();
    renderWithServices(<MomentButton seconds={108} what="Flush the group head" link={false} playing onPlay={onPlay} testId="m" />);
    const button = screen.getByRole('button', { name: 'Play from 1:48: Flush the group head' });
    expect(button).toHaveTextContent('1:48');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(button);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('as a link: YouTube at that time', () => {
    renderWithServices(<MomentButton seconds={1016} what="Soak the group head's parts" link linkProps={{}} testId="m" />);
    const link = screen.getByRole('link', { name: "Watch from 16:56 on YouTube: Soak the group head's parts" });
    expect(link).toHaveAttribute('href', watchUrl(1016));
    expect(link).not.toHaveAttribute('target');
  });
});
