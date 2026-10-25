// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KIAMBU, SANTOS } from '../chat/testing/fixtures.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServices } from '../testing/fakeServices.ts';
import { useExportData } from './ExportData.tsx';

/** A button of the hook's, as History's header and the Export card each draw theirs. */
function Harness() {
  const { working, start, dialog } = useExportData();
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <>
      <button type="button" disabled={working} onClick={() => void start().then(setFailed)}>
        Export
      </button>
      {failed ? <p>{failed}</p> : null}
      {dialog}
    </>
  );
}

function stubDownloads() {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:x');
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  return { createObjectURL, click };
}

afterEach(() => {
  delete (URL as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
  // An own execCommand a test put on the document; jsdom's own stays on its prototype.
  delete (document as { execCommand?: unknown }).execCommand;
  vi.unstubAllGlobals();
});

describe('useExportData (D244)', () => {
  it('resolves with nothing to say once the dialog is open, and the dialog closes on Done', async () => {
    stubDownloads();
    renderWithServices(<Harness />, createFakeServices({ storage: { bags: [SANTOS, KIAMBU] } }));
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    const dialog = await screen.findByRole('dialog', { name: 'Your CafAI data' });
    expect(JSON.parse((within(dialog).getByRole('textbox', { name: 'Exported data' }) as HTMLTextAreaElement).value)).toMatchObject({
      format: 'cafai-export',
      bags: [SANTOS, KIAMBU],
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('resolves with what went wrong, and opens no dialog', async () => {
    const services = createFakeServices();
    vi.spyOn(services.storage.porter, 'exportAll').mockRejectedValue(new Error('Quota exceeded'));
    renderWithServices(<Harness />, services);
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(await screen.findByText('Export failed: Quota exceeded')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
  });

  it("offers the download again from the dialog inside Decaid, and says so once it went", async () => {
    const { click } = stubDownloads();
    renderWithServices(<Harness />, createFakeServices({ insideDecaid: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    const dialog = await screen.findByRole('dialog', { name: 'Your CafAI data' });
    expect(click).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download file' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByText(/^Saved as cafai-export-\d{4}-\d{2}-\d{2}\.json/)).toBeInTheDocument();
  });

  it('says how to copy by hand when copying fails', async () => {
    stubDownloads();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('Denied'))) } });
    // The select-and-copy fallback is refused too.
    Object.defineProperty(document, 'execCommand', { value: vi.fn(() => false), configurable: true });
    renderWithServices(<Harness />, createFakeServices());
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    const dialog = await screen.findByRole('dialog', { name: 'Your CafAI data' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy' }));
    expect(await within(dialog).findByText('Copying failed. Tap the text, select all, then copy.')).toBeInTheDocument();
  });
});
