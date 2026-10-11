// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { browserPhotoTools, fitWithin, JPEG_QUALITY, MAX_SIDE_PX, NOT_A_PHOTO, prepareBagPhoto, type PhotoTools } from './bagPhoto.ts';

describe('fitWithin', () => {
  it('scales a photo down to at most 1568 px on its longest side, keeping its shape', () => {
    expect(MAX_SIDE_PX).toBe(1568);
    expect(fitWithin(4032, 3024)).toEqual({ width: 1568, height: 1176 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1176, height: 1568 });
    expect(fitWithin(4000, 1000)).toEqual({ width: 1568, height: 392 });
  });

  it('leaves a photo that already fits as it is', () => {
    expect(fitWithin(1568, 1000)).toEqual({ width: 1568, height: 1000 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

/** Tools that decode any file as a photo of the given size and record what they were asked. */
function fakeTools(width: number, height: number, failEncode = false) {
  const asked: Array<{ width: number; height: number; quality: number }> = [];
  let released = 0;
  const tools: PhotoTools = {
    decode: async () => ({ image: {} as CanvasImageSource, width, height, release: () => void (released += 1) }),
    async encode(_image, w, h, quality) {
      asked.push({ width: w, height: h, quality });
      if (failEncode) throw new Error('CafAI could not read that photo. Try another one.');
      return new Blob(['jpeg bytes'], { type: 'image/jpeg' });
    },
    base64: async () => 'anBlZyBieXRlcw==',
  };
  return { tools, asked, released: () => released };
}

describe('prepareBagPhoto', () => {
  const file = (type = 'image/jpeg') => new File([new Uint8Array([0xff, 0xd8, 0xff])], 'bag.jpg', { type });

  it('draws the photo at the size that fits, as JPEG at 0.85, and gives it as base64 for the request', async () => {
    const { tools, asked, released } = fakeTools(4032, 3024);
    await expect(prepareBagPhoto(file(), tools)).resolves.toEqual({ mediaType: 'image/jpeg', data: 'anBlZyBieXRlcw==' });
    expect(asked).toEqual([{ width: 1568, height: 1176, quality: JPEG_QUALITY }]);
    expect(JPEG_QUALITY).toBe(0.85);
    expect(released()).toBe(1);
  });

  it('lets the decoded photo go even when it cannot be encoded', async () => {
    const { tools, released } = fakeTools(800, 600, true);
    await expect(prepareBagPhoto(file(), tools)).rejects.toThrow('CafAI could not read that photo. Try another one.');
    expect(released()).toBe(1);
  });

  it('refuses a file that is not a picture, without opening it', async () => {
    const { tools } = fakeTools(800, 600);
    const decode = vi.spyOn(tools, 'decode');
    await expect(prepareBagPhoto(file('text/plain'), tools)).rejects.toThrow(NOT_A_PHOTO);
    expect(decode).not.toHaveBeenCalled();
  });
});

describe('browserPhotoTools', () => {
  it('turns the encoded photo into base64 without the data URL prefix', async () => {
    await expect(browserPhotoTools.base64(new Blob(['ABC'], { type: 'image/jpeg' }))).resolves.toBe('QUJD');
  });
});
