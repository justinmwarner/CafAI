// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KIAMBU, KIAMBU_ITERATIONS, KIAMBU_VERSIONS, SANTOS } from '../chat/testing/fixtures.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServices, type FakeServices } from '../testing/fakeServices.ts';
import { EXPORT_CARD_TID, ExportCard } from './ExportCard.tsx';

function seeded(options: { insideDecaid?: boolean } = {}): FakeServices {
  return createFakeServices({
    storage: { bags: [SANTOS, KIAMBU], versions: KIAMBU_VERSIONS, iterations: KIAMBU_ITERATIONS },
    insideDecaid: options.insideDecaid,
  });
}

/** jsdom has no object URLs and would navigate on a link's click: both stubbed, as History's tests do. */
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
  vi.unstubAllGlobals();
});

describe('ExportCard (D244)', () => {
  it('is the card "Your data": what the file holds, never the API key, and Export', () => {
    renderWithServices(<ExportCard />, seeded());
    const card = screen.getByRole('region', { name: 'Your data' });
    expect(within(card).getByRole('heading', { name: 'Your data' })).toBeInTheDocument();
    expect(card).toHaveTextContent('Your bags, versions and shots, as a file to keep or move to another device. Never your API key.');
    const button = within(card).getByTestId(EXPORT_CARD_TID.settingsExport);
    expect(button).toHaveTextContent('Export');
    expect(button).toBeEnabled();
  });

  it("exports History's file through the porter and opens History's dialog", async () => {
    const services = seeded();
    const exportAll = vi.spyOn(services.storage.porter, 'exportAll');
    const { createObjectURL, click } = stubDownloads();
    renderWithServices(<ExportCard />, services);

    await userEvent.click(screen.getByTestId(EXPORT_CARD_TID.settingsExport));

    const dialog = await screen.findByRole('dialog', { name: 'Your CafAI data' });
    expect(exportAll).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0]?.[0].type).toBe('application/json');
    expect(within(dialog).getByText(/^Saved as cafai-export-\d{4}-\d{2}-\d{2}\.json/)).toBeInTheDocument();
    expect(dialog).toHaveTextContent('It holds your bags, versions and shots, never your API key.');
    const text = within(dialog).getByRole('textbox', { name: 'Exported data' }) as HTMLTextAreaElement;
    expect(JSON.parse(text.value)).toEqual(await services.storage.porter.exportAll());

    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId(EXPORT_CARD_TID.settingsExport)).toBeEnabled();
  });

  it('skips the download inside Decaid and offers copying, as History does', async () => {
    const { click } = stubDownloads();
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderWithServices(<ExportCard />, seeded({ insideDecaid: true }));

    await userEvent.click(screen.getByTestId(EXPORT_CARD_TID.settingsExport));
    const dialog = await screen.findByRole('dialog', { name: 'Your CafAI data' });
    expect(click).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/Downloads may not work inside Decaid/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy' }));
    expect(await within(dialog).findByText('Copied.')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"cafai-export"'));
  });

  it('says under the button when the export failed, and a new try clears it', async () => {
    const services = seeded();
    const exportAll = vi.spyOn(services.storage.porter, 'exportAll').mockRejectedValueOnce(new Error('The database is closed.'));
    stubDownloads();
    renderWithServices(<ExportCard />, services);

    await userEvent.click(screen.getByTestId(EXPORT_CARD_TID.settingsExport));
    const said = await screen.findByTestId(EXPORT_CARD_TID.settingsExportSaid);
    expect(said).toHaveTextContent('Export failed: The database is closed.');
    expect(said).toHaveAttribute('role', 'alert');
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(screen.getByTestId(EXPORT_CARD_TID.settingsExport));
    expect(await screen.findByRole('dialog', { name: 'Your CafAI data' })).toBeInTheDocument();
    expect(screen.queryByTestId(EXPORT_CARD_TID.settingsExportSaid)).toBeNull();
    expect(exportAll).toHaveBeenCalledTimes(2);
  });

  it('holds Export while the data is gathered', async () => {
    const services = seeded();
    let finish: (value: Awaited<ReturnType<typeof services.storage.porter.exportAll>>) => void = () => {};
    const data = await services.storage.porter.exportAll();
    vi.spyOn(services.storage.porter, 'exportAll').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    stubDownloads();
    renderWithServices(<ExportCard />, services);

    const button = screen.getByTestId(EXPORT_CARD_TID.settingsExport);
    await userEvent.click(button);
    expect(button).toBeDisabled();
    finish(data);
    expect(await screen.findByRole('dialog', { name: 'Your CafAI data' })).toBeInTheDocument();
    expect(button).toBeEnabled();
  });
});
