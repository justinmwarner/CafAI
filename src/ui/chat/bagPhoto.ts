/**
 * A photo of the bag, made ready to send (6.8): drawn into a canvas at most
 * 1568 px on its longest side, encoded as JPEG at 0.85, and handed over as
 * base64. 1568 px keeps the print on a bag legible and the upload small:
 * current Claude models read an image up to 2576 px, at up to three times
 * the image tokens, which a label does not need, and older ones scale
 * anything over 1568 px down at their end anyway.
 *
 * Chromium 91 has what this needs: an <img> decodes the file (and turns it
 * the way the camera held it, which Chromium does by itself since 81), and
 * canvas.toBlob encodes it. Nothing newer, no createImageBitmap options.
 *
 * The photo exists only here and in the one request that reads it: nothing
 * stores, mirrors or logs it.
 */
import type { BagPhoto } from '../../llm/extractBag.ts';

export const MAX_SIDE_PX = 1568;
export const JPEG_QUALITY = 0.85;
export const NOT_A_PHOTO = 'That file is not a photo. Take or pick a photo of the bag.';
export const UNREADABLE = 'CafAI could not open that photo. Try another one.';

/** The size that fits within `max` on the longest side, the photo's shape kept; a photo that fits stays as it is. */
export function fitWithin(width: number, height: number, max = MAX_SIDE_PX): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The browser work, apart so tests can stand in for it (jsdom decodes no images and has no canvas). */
export interface PhotoTools {
  /** Open the file as something a canvas can draw; `release` lets it go. */
  decode(file: Blob): Promise<{ image: CanvasImageSource; width: number; height: number; release(): void }>;
  /** Draw it at this size and encode it as JPEG. */
  encode(image: CanvasImageSource, width: number, height: number, quality: number): Promise<Blob>;
  /** The encoded bytes as base64, without the data URL's prefix. */
  base64(blob: Blob): Promise<string>;
}

export const browserPhotoTools: PhotoTools = {
  decode(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () =>
        resolve({ image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) });
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(UNREADABLE));
      };
      image.src = url;
    });
  },
  encode(image, width, height, quality) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error(UNREADABLE));
        return;
      }
      context.drawImage(image, 0, 0, width, height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(UNREADABLE))), 'image/jpeg', quality);
    });
  },
  base64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const url = typeof reader.result === 'string' ? reader.result : '';
        resolve(url.slice(url.indexOf(',') + 1));
      };
      reader.onerror = () => reject(new Error(UNREADABLE));
      reader.readAsDataURL(blob);
    });
  },
};

/** The photo the barista took or picked, as the coach's model reads it. */
export async function prepareBagPhoto(file: Blob, tools: PhotoTools = browserPhotoTools): Promise<BagPhoto> {
  if (file.type !== '' && !file.type.startsWith('image/')) throw new Error(NOT_A_PHOTO);
  const decoded = await tools.decode(file);
  try {
    const size = fitWithin(decoded.width, decoded.height);
    const jpeg = await tools.encode(decoded.image, size.width, size.height, JPEG_QUALITY);
    return { mediaType: 'image/jpeg', data: await tools.base64(jpeg) };
  } finally {
    decoded.release();
  }
}
