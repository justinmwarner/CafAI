// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText, downloadText, exportFileName } from './exportFile.ts';

describe('exportFileName', () => {
  it('dates the file in local time', () => {
    expect(exportFileName(new Date(2026, 9, 3, 23, 59))).toBe('cafai-export-2026-10-03.json');
    expect(exportFileName(new Date(2026, 0, 9))).toBe('cafai-export-2026-01-09.json');
  });
});

// jsdom has no object URLs; install stand-ins per test and remove them after.
function stubObjectUrls(createObjectURL: (blob: Blob) => string) {
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true, writable: true });
}

describe('downloadText', () => {
  afterEach(() => {
    delete (URL as { createObjectURL?: unknown }).createObjectURL;
    delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
  });

  it('clicks a temporary download link for a JSON blob', () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:cafai');
    stubObjectUrls(createObjectURL);
    const clicked: HTMLAnchorElement[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });

    expect(downloadText('cafai.json', '{"a":1}')).toBe(true);

    expect(click).toHaveBeenCalledTimes(1);
    expect(clicked[0]?.download).toBe('cafai.json');
    expect(clicked[0]?.href).toBe('blob:cafai');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(createObjectURL.mock.calls[0]?.[0].type).toBe('application/json');
  });

  it('reports failure instead of throwing when blobs are unsupported', () => {
    stubObjectUrls(() => {
      throw new Error('not supported');
    });
    expect(downloadText('cafai.json', '{}')).toBe(false);
  });
});

describe('copyText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the async clipboard when present', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await expect(copyText('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to execCommand on insecure origins', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    await expect(copyText('hello')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });
});
