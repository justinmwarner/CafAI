// @vitest-environment jsdom
import '../testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BagPhoto } from '../../../llm/extractBag.ts';
import { TID } from '../../testIds.ts';
import { UNREADABLE, browserPhotoTools, prepareBagPhoto, type PhotoTools } from '../bagPhoto.ts';
import { fadedElements, renderThemed } from '../testing/render.tsx';
import { previewTheme } from '../testing/previewTheme.ts';
import { BEAN_OPTIONS } from '../testing/fixtures.ts';
import { BeanCard, type BeanCardProps } from './BeanCard.tsx';

const { palette } = previewTheme;

/** A 1x1 JPEG: what the camera hands over, as small as one can be. */
const FIXTURE_JPEG = Uint8Array.from(
  atob(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  ),
  (c) => c.charCodeAt(0),
);
const photoFile = () => new File([FIXTURE_JPEG], 'bag.jpg', { type: 'image/jpeg' });

/** jsdom decodes no images and has no canvas: the photo goes through as it came, sized as a 12 MP camera's. */
const passThrough: PhotoTools = {
  decode: async (file) => ({ image: file as unknown as CanvasImageSource, width: 4032, height: 3024, release: () => {} }),
  encode: async (image) => image as unknown as Blob,
  base64: browserPhotoTools.base64,
};

function renderCard(props: Partial<BeanCardProps> = {}) {
  const handlers = { onPick: vi.fn(), onSomethingElse: vi.fn(), onPhoto: vi.fn() };
  renderThemed(<BeanCard options={BEAN_OPTIONS} choice={null} {...handlers} {...props} />);
  return handlers;
}

const rows = () => within(screen.getByTestId(TID.beanCard)).queryAllByRole('listitem');

describe('BeanCard (6.1)', () => {
  it("asks which coffee it is: a row per batch with its name, roaster and roast date, then a photo or something else", () => {
    renderCard();
    const card = screen.getByTestId(TID.beanCard);
    expect(within(card).getByRole('heading', { name: 'Which coffee is it?' })).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
    expect(within(rows()[0]!).getByText('Red Brick')).toBeInTheDocument();
    expect(within(rows()[0]!).getByText('Square Mile Coffee Roasters · Roasted 24 Sep 2026')).toBeInTheDocument();
    expect(within(rows()[1]!).getByText('Heart Coffee Roasters · Roasted 3 Sep 2026')).toBeInTheDocument();
    expect(screen.getAllByTestId(TID.beanOption).map((button) => button.textContent)).toEqual(['Use this', 'Use this']);
    expect(screen.getByTestId(TID.bagPhoto)).toHaveTextContent('Photo of the bag');
    expect(screen.getByTestId(TID.beanSomethingElse)).toHaveTextContent('Something else');
  });

  it('names the coffee in each Use this, for a screen reader that lists the buttons alone', () => {
    renderCard();
    expect(screen.getAllByRole('button', { name: /^Use this/ }).map((button) => button.getAttribute('aria-label'))).toEqual([
      'Use this: Red Brick',
      'Use this: Ethiopia Chelchele',
    ]);
    expect(screen.getByRole('button', { name: 'Use this: Ethiopia Chelchele' })).toHaveAttribute('data-testid', TID.beanOption);
  });

  it('lists the batches as plain rows inside the one card: no outlined card within it', () => {
    renderCard();
    const card = screen.getByTestId(TID.beanCard);
    expect(card.querySelectorAll('.MuiPaper-root')).toHaveLength(0);
    expect(rows()).toHaveLength(2);
    for (const row of rows()) expect(row).not.toHaveClass('MuiPaper-outlined');
  });

  it("says it is looking in Decaid's beans while they are read, with a photo and something else already there", () => {
    renderCard({ options: [], loading: true });
    expect(within(screen.getByTestId(TID.beanCard)).getByRole('status')).toHaveTextContent("Looking in Decaid's beans…");
    expect(rows()).toEqual([]);
    expect(screen.getByTestId(TID.bagPhoto)).toBeEnabled();
    expect(screen.getByTestId(TID.beanSomethingElse)).toBeEnabled();
  });

  it('says nothing of looking once answered', () => {
    renderCard({ options: [], loading: true, choice: { kind: 'other' } });
    expect(screen.queryByText("Looking in Decaid's beans…")).toBeNull();
  });

  it('reports the batch tapped, and Something else', async () => {
    const handlers = renderCard();
    await userEvent.click(within(rows()[1]!).getByTestId(TID.beanOption));
    expect(handlers.onPick).toHaveBeenCalledWith('batch-chel');
    await userEvent.click(screen.getByTestId(TID.beanSomethingElse));
    expect(handlers.onSomethingElse).toHaveBeenCalledTimes(1);
  });

  it('offers only a photo and something else without a batch to pick', () => {
    renderCard({ options: [] });
    expect(rows()).toEqual([]);
    expect(screen.queryByTestId(TID.beanOption)).toBeNull();
    expect(screen.getByTestId(TID.bagPhoto)).toBeEnabled();
    expect(screen.getByTestId(TID.beanSomethingElse)).toBeEnabled();
  });

  it('keeps the card once answered: the pick marked, the rest set aside in the muted ink, never faded', () => {
    renderCard({ choice: { kind: 'batch', batchId: 'batch-red' } });
    const [picked, other] = rows();
    expect(picked).toHaveAttribute('aria-current', 'true');
    expect(within(picked!).getByText('Picked')).toBeInTheDocument();
    expect(within(picked!).queryByTestId(TID.beanOption)).toBeNull();
    expect(within(other!).getByTestId(TID.beanOption)).toBeDisabled();
    expect(other).toHaveStyle({ color: palette.text.secondary });
    expect(fadedElements(other!)).toEqual([]);
    expect(screen.getByTestId(TID.bagPhoto)).toBeDisabled();
    expect(screen.getByTestId(TID.beanSomethingElse)).toBeDisabled();
  });

  it('marks a photo or something else as the answer', () => {
    renderCard({ choice: { kind: 'photo' } });
    expect(screen.queryByTestId(TID.bagPhoto)).toBeNull();
    expect(within(screen.getByTestId(TID.beanCard)).getByText('Photo of the bag')).toBeInTheDocument();
    expect(screen.getByTestId(TID.beanSomethingElse)).toBeDisabled();
    for (const button of screen.getAllByTestId(TID.beanOption)) expect(button).toBeDisabled();
  });

  it('says why it was set aside when the bag was described in the chat', () => {
    renderCard({ expired: true, setAsideReason: 'typed' });
    expect(screen.getByText('Set aside: you described the bag in the chat.')).toBeInTheDocument();
    for (const button of screen.getAllByTestId(TID.beanOption)) expect(button).toBeDisabled();
    expect(screen.getByTestId(TID.bagPhoto)).toBeDisabled();
  });

  it('blocks taps while the coach is busy', () => {
    renderCard({ disabled: true });
    for (const button of [...screen.getAllByTestId(TID.beanOption), screen.getByTestId(TID.bagPhoto), screen.getByTestId(TID.beanSomethingElse)]) {
      expect(button).toBeDisabled();
    }
  });
});

describe('BeanCard: the photo of the bag (6.8)', () => {
  it("opens the camera through a plain file input, never getUserMedia", async () => {
    renderCard();
    const input = screen.getByTestId(TID.bagPhotoInput) as HTMLInputElement;
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', 'image/*');
    expect(input).toHaveAttribute('capture', 'environment');
    const opened = vi.spyOn(input, 'click');
    await userEvent.click(screen.getByTestId(TID.bagPhoto));
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('makes the chosen photo ready and hands it on, once', async () => {
    const handlers = renderCard({ preparePhoto: (file) => prepareBagPhoto(file, passThrough) });
    const input = screen.getByTestId(TID.bagPhotoInput) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [photoFile()] } });
    await waitFor(() => expect(handlers.onPhoto).toHaveBeenCalledTimes(1));
    const photo = handlers.onPhoto.mock.calls[0]![0] as BagPhoto;
    expect(photo.mediaType).toBe('image/jpeg');
    expect(Uint8Array.from(atob(photo.data), (c) => c.charCodeAt(0))).toEqual(FIXTURE_JPEG);
    // Cleared, so the same photo can be chosen again after a failed read.
    expect(input.value).toBe('');
  });

  it('says when the photo cannot be opened, and keeps the card open', async () => {
    const handlers = renderCard({ preparePhoto: async () => Promise.reject(new Error('CafAI could not open that photo. Try another one.')) });
    fireEvent.change(screen.getByTestId(TID.bagPhotoInput), { target: { files: [photoFile()] } });
    expect(await screen.findByText('CafAI could not open that photo. Try another one.')).toBeInTheDocument();
    expect(handlers.onPhoto).not.toHaveBeenCalled();
    expect(screen.getByTestId(TID.bagPhoto)).toBeEnabled();
  });

  it("says the photo could not be opened, in bagPhoto.ts's words, when the failure has none of its own", async () => {
    renderCard({ preparePhoto: async () => Promise.reject(new Error('')) });
    fireEvent.change(screen.getByTestId(TID.bagPhotoInput), { target: { files: [photoFile()] } });
    expect(await screen.findByText(UNREADABLE)).toBeInTheDocument();
  });
});
