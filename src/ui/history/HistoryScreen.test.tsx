// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withTds } from '../../coach/extraction.ts';
import { createFakeServices, type FakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { KIAMBU, KIAMBU_ITERATIONS, KIAMBU_VERSIONS, SANTOS } from '../chat/testing/fixtures.ts';
import { previewTheme } from '../chat/testing/previewTheme.ts';
import { fadedElements, renderWithServices } from '../chat/testing/render.tsx';
import { HistoryScreen } from './HistoryScreen.tsx';

function seeded(options: { insideDecaid?: boolean } = {}): FakeServices {
  return createFakeServices({
    storage: { bags: [SANTOS, KIAMBU], versions: KIAMBU_VERSIONS, iterations: KIAMBU_ITERATIONS },
    insideDecaid: options.insideDecaid,
  });
}

function renderHistory(bagId: string | null, services = seeded()) {
  const onSelectBag = vi.fn();
  const result = renderWithServices(<HistoryScreen bagId={bagId} onSelectBag={onSelectBag} />, services);
  return { ...result, onSelectBag };
}

afterEach(() => {
  delete (URL as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
});

describe('HistoryScreen bag list', () => {
  it('lists the bags, most recent first, with their shot counts', async () => {
    renderHistory(null);
    const kiambu = await screen.findByTestId(TID.historyBag(KIAMBU.id));
    const santos = screen.getByTestId(TID.historyBag(SANTOS.id));
    expect(kiambu.compareDocumentPosition(santos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(kiambu).toHaveTextContent('Square Mile · Kenya, Kiambu · light · washed');
    expect(kiambu).toHaveTextContent('3 shots');
    expect(santos).toHaveTextContent('0 shots');
  });

  it('opens a bag', async () => {
    const { onSelectBag } = renderHistory(null);
    await userEvent.click(await screen.findByTestId(TID.historyBag(KIAMBU.id)));
    expect(onSelectBag).toHaveBeenCalledWith(KIAMBU.id);
  });

  it('says when there are no bags yet', async () => {
    renderHistory(null, createFakeServices());
    expect(await screen.findByText(/No bags yet/)).toBeInTheDocument();
  });

  it('re-reads storage when the coach commits a change', async () => {
    const services = seeded();
    renderHistory(null, services);
    await screen.findByTestId(TID.historyBag(KIAMBU.id));
    const fresh = { ...SANTOS, id: 'bag-new', name: 'Ethiopia Guji', updatedAt: '2026-10-04T08:00:00.000Z' };
    await services.storage.bags.put(fresh);
    act(() => services.coach.setState({ bags: [fresh] }));
    expect(await screen.findByTestId(TID.historyBag('bag-new'))).toHaveTextContent('Ethiopia Guji');
  });
});

describe('HistoryScreen bag detail', () => {
  it('shows every version with its status, template and change', async () => {
    renderHistory(KIAMBU.id);
    const v1 = await screen.findByTestId(TID.historyVersion(1));
    const v2 = screen.getByTestId(TID.historyVersion(2));
    const v3 = screen.getByTestId(TID.historyVersion(3));
    const v4 = screen.getByTestId(TID.historyVersion(4));
    expect(screen.getByRole('heading', { name: 'Kiambu AA' })).toBeInTheDocument();
    expect(v1).toHaveTextContent('Starting point: Blooming Espresso');
    expect(v1).toHaveTextContent('Superseded');
    expect(v2).toHaveTextContent('Raise brew temperature by 1 °C');
    expect(within(v2).getByText('92.0 °C')).toHaveStyle({ textDecoration: 'line-through' });
    expect(v3).toHaveTextContent('Active');
    expect(v3).toHaveTextContent('Yield:');
    expect(v4).toHaveTextContent('Undone');
    // Newest first.
    expect(v4.compareDocumentPosition(v1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows an undone version in the muted ink, its Undone chip still in warning, never faded', async () => {
    const { palette } = previewTheme;
    renderHistory(KIAMBU.id);
    const undone = await screen.findByTestId(TID.historyVersion(4));
    expect(fadedElements(undone)).toEqual([]);
    expect(undone).toHaveStyle({ color: palette.text.secondary });
    const chip = within(undone).getByText('Undone').closest<HTMLElement>('.MuiChip-root')!;
    expect(chip).toHaveStyle({ color: palette.warning.main, borderColor: palette.warning.main });
    // The versions in use keep the ink.
    expect(screen.getByTestId(TID.historyVersion(3))).toHaveStyle({ color: palette.text.primary });
    expect(screen.getByTestId(TID.historyVersion(1))).toHaveStyle({ color: palette.text.primary });
  });

  it('shows each iteration under its version: shot, feedback, proposal, outcome', async () => {
    renderHistory(KIAMBU.id);
    const v1 = await screen.findByTestId(TID.historyVersion(1));
    const first = within(v1).getByTestId(TID.historyIteration('it-1'));
    expect(first).toHaveTextContent('27.8 s · 18.0 g → 36.4 g · 1:2.0 · peak 8.9 bar');
    expect(first).toHaveTextContent('Taste: Sour / sharp');
    expect(first).toHaveTextContent('Proposed: Raise brew temperature by 1 °C');
    expect(first).toHaveTextContent('Change applied');

    const third = within(screen.getByTestId(TID.historyVersion(3))).getByTestId(TID.historyIteration('it-3'));
    expect(third).toHaveTextContent('Taste: “Sweet but a little hollow”');
    expect(third).toHaveTextContent('Pressure dipped after the peak');
    expect(third).toHaveTextContent('Change declined');
    expect(within(screen.getByTestId(TID.historyVersion(4))).getByText('No shots on this version.')).toBeInTheDocument();
  });

  it("links a shot the Visualizer plugin uploaded to its page there, and only those (6.4)", async () => {
    const url = 'https://visualizer.coffee/shots/viz-1';
    const iterations = KIAMBU_ITERATIONS.map((record) => (record.id === 'it-2' ? { ...record, visualizerUrl: url } : record));
    renderHistory(KIAMBU.id, createFakeServices({ storage: { bags: [KIAMBU], versions: KIAMBU_VERSIONS, iterations } }));
    const second = within(await screen.findByTestId(TID.historyVersion(2))).getByTestId(TID.historyIteration('it-2'));
    expect(within(second).getByTestId(TID.visualizerLink)).toHaveAttribute('href', url);
    expect(screen.getAllByTestId(TID.visualizerLink)).toHaveLength(1);
  });

  it("ends a shot's line with the barista's TDS and its EY, and with the TDS alone when there is no EY (D166)", async () => {
    const iterations = KIAMBU_ITERATIONS.map((record) => {
      if (record.id === 'it-1') return { ...record, summary: withTds(record.summary!, 9.25) };
      if (record.id === 'it-2') return { ...record, summary: withTds({ ...record.summary!, yieldG: null }, 8.9) };
      return record;
    });
    renderHistory(KIAMBU.id, createFakeServices({ storage: { bags: [KIAMBU], versions: KIAMBU_VERSIONS, iterations } }));
    const first = within(await screen.findByTestId(TID.historyVersion(1))).getByTestId(TID.historyIteration('it-1'));
    // 9.25 % x 36.4 g / 18.0 g = 18.7 %.
    expect(first).toHaveTextContent('27.8 s · 18.0 g → 36.4 g · 1:2.0 · peak 8.9 bar · TDS 9.25 % · EY 18.7 %');
    const second = within(screen.getByTestId(TID.historyVersion(2))).getByTestId(TID.historyIteration('it-2'));
    expect(second).toHaveTextContent('TDS 8.90 %');
    expect(second).not.toHaveTextContent('EY');
    const third = within(screen.getByTestId(TID.historyVersion(3))).getByTestId(TID.historyIteration('it-3'));
    expect(third).not.toHaveTextContent('TDS');
  });

  it('goes back to the list', async () => {
    const { onSelectBag } = renderHistory(KIAMBU.id);
    await userEvent.click(await screen.findByRole('button', { name: 'All bags' }));
    expect(onSelectBag).toHaveBeenCalledWith(null);
  });

  it('copes with a bag that no longer exists', async () => {
    renderHistory('bag-gone');
    expect(await screen.findByText('That bag was not found.')).toBeInTheDocument();
  });
});

describe('HistoryScreen export and import', () => {
  it('exports through the porter, downloads a dated JSON file and shows it for copying', async () => {
    const services = seeded();
    const exportAll = vi.spyOn(services.storage.porter, 'exportAll');
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:x');
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderHistory(null, services);

    await userEvent.click(screen.getByTestId(TID.exportData));

    const dialog = await screen.findByRole('dialog');
    expect(exportAll).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0]?.[0].type).toBe('application/json');
    expect(within(dialog).getByText(/^Saved as cafai-export-\d{4}-\d{2}-\d{2}\.json/)).toBeInTheDocument();
    const text = within(dialog).getByRole('textbox', { name: 'Exported data' });
    expect(JSON.parse((text as HTMLTextAreaElement).value)).toMatchObject({ format: 'cafai-export', bags: [SANTOS, KIAMBU] });
  });

  it('skips the download inside Decaid and offers copying', async () => {
    const services = seeded({ insideDecaid: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderHistory(null, services);

    await userEvent.click(screen.getByTestId(TID.exportData));
    const dialog = await screen.findByRole('dialog');
    expect(click).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/Downloads may not work inside Decaid/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy' }));
    expect(await within(dialog).findByText('Copied.')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"cafai-export"'));
    vi.unstubAllGlobals();
  });

  it('imports a file in merge mode and reports the count', async () => {
    const services = seeded();
    const importAll = vi.spyOn(services.storage.porter, 'importAll').mockResolvedValue({ imported: 7 });
    renderHistory(null, services);
    const data = { format: 'cafai-export', schemaVersion: 1, bags: [] };
    const file = new File([JSON.stringify(data)], 'cafai.json', { type: 'application/json' });

    const input = screen.getByTestId(TID.importData);
    expect(input).toHaveAttribute('accept', expect.stringContaining('application/json'));
    await userEvent.upload(input, file);

    expect(await screen.findByText('Imported 7 records.')).toBeInTheDocument();
    expect(importAll).toHaveBeenCalledWith(data, 'merge');
    expect(services.coach.calls.map((c) => c.method)).toContain('refresh');
  });

  it('says when an import brings nothing new, on whatever device it runs', async () => {
    const services = seeded();
    vi.spyOn(services.storage.porter, 'importAll').mockResolvedValue({ imported: 0 });
    renderHistory(null, services);
    await userEvent.upload(screen.getByTestId(TID.importData), new File(['{}'], 'x.json', { type: 'application/json' }));
    expect(await screen.findByText('Nothing new to import: this device already has everything in that file.')).toBeInTheDocument();
  });

  it('rejects a file that is not JSON without calling the porter', async () => {
    const services = seeded();
    const importAll = vi.spyOn(services.storage.porter, 'importAll');
    renderHistory(null, services);
    await userEvent.upload(screen.getByTestId(TID.importData), new File(['not json'], 'x.json', { type: 'application/json' }));
    expect(await screen.findByText('That file is not a CafAI export (it is not JSON).')).toBeInTheDocument();
    expect(importAll).not.toHaveBeenCalled();
  });

  it('shows the porter’s reason when an import is refused', async () => {
    const services = seeded();
    vi.spyOn(services.storage.porter, 'importAll').mockRejectedValue(new Error('This is not a CafAI export file.'));
    renderHistory(null, services);
    await userEvent.upload(screen.getByTestId(TID.importData), new File(['{}'], 'x.json', { type: 'application/json' }));
    expect(await screen.findByText('Import failed: This is not a CafAI export file.')).toBeInTheDocument();
  });

  it('keeps the list readable while waiting for storage', async () => {
    const services = seeded();
    renderHistory(null, services);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
  });
});
