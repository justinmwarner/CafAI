// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DisplayPrefsSaved } from '../../app/displayPrefs.ts';
import { withTds } from '../../coach/extraction.ts';
import type { IterationRecord } from '../../storage/types.ts';
import { formatDateTime } from '../chat/format.ts';
import { KIAMBU, KIAMBU_ITERATIONS, KIAMBU_VERSIONS, SANTOS } from '../chat/testing/fixtures.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServicesShowing } from '../testing/displayServices.ts';
import { TID } from '../testIds.ts';
import { HistoryScreen } from './HistoryScreen.tsx';

/**
 * History as the barista chose to read it: the clock its times are in
 * (D245) and whether a shot's line carries the TDS and the EY (D246).
 * HistoryScreen.test.tsx has the rest.
 */
function renderHistory(bagId: string | null, prefs: DisplayPrefsSaved, iterations: IterationRecord[] = KIAMBU_ITERATIONS) {
  const services = createFakeServicesShowing(prefs, { storage: { bags: [SANTOS, KIAMBU], versions: KIAMBU_VERSIONS, iterations } });
  renderWithServices(<HistoryScreen bagId={bagId} onSelectBag={vi.fn()} />, services);
  return services;
}

/** The first shot with a refractometer's 9.25 %, so its line ends with the TDS and the EY while they show. */
const WITH_TDS = KIAMBU_ITERATIONS.map((record) => (record.id === 'it-1' ? { ...record, summary: withTds(record.summary!, 9.25) } : record));

describe('HistoryScreen and the TDS switch (D246)', () => {
  it("ends a shot's line with its TDS and EY while the switch is on", async () => {
    renderHistory(KIAMBU.id, { showTds: true }, WITH_TDS);
    const first = within(await screen.findByTestId(TID.historyVersion(1))).getByTestId(TID.historyIteration('it-1'));
    expect(first).toHaveTextContent('peak 8.9 bar · TDS 9.25 % · EY 18.7 %');
  });

  it('leaves them out while it is off, the reading kept in storage, and puts them back when it is on again', async () => {
    const services = renderHistory(KIAMBU.id, { showTds: false }, WITH_TDS);
    const row = () => within(screen.getByTestId(TID.historyVersion(1))).getByTestId(TID.historyIteration('it-1'));
    await screen.findByTestId(TID.historyVersion(1));
    expect(row()).toHaveTextContent('27.8 s · 18.0 g → 36.4 g · 1:2.0 · peak 8.9 bar');
    expect(row()).not.toHaveTextContent('TDS');
    expect(row()).not.toHaveTextContent('EY');
    expect((await services.storage.iterations.listByBag(KIAMBU.id)).find((record) => record.id === 'it-1')?.summary?.tdsPct).toBe(9.25);
    await act(async () => {
      await services.displayPrefs.setShowTds(true);
    });
    expect(row()).toHaveTextContent('TDS 9.25 % · EY 18.7 %');
  });
});

describe('HistoryScreen on the 12-hour clock (D245)', () => {
  it('dates the bags in the list that way', async () => {
    renderHistory(null, { clock: '12h' });
    const kiambu = await screen.findByTestId(TID.historyBag(KIAMBU.id));
    expect(kiambu).toHaveTextContent(formatDateTime(KIAMBU.updatedAt, '12h'));
    expect(formatDateTime(KIAMBU.updatedAt, '12h')).toMatch(/, \d{1,2}:\d\d [ap]m$/);
  });

  it('dates the versions and the shots that way, and follows a change of clock at once', async () => {
    const services = renderHistory(KIAMBU.id, { clock: '12h' });
    const v1 = await screen.findByTestId(TID.historyVersion(1));
    const version = KIAMBU_VERSIONS.find((entry) => entry.version === 1)!;
    const shot = KIAMBU_ITERATIONS.find((record) => record.id === 'it-1')!;
    expect(v1).toHaveTextContent(formatDateTime(version.createdAt, '12h'));
    const row = () => within(v1).getByTestId(TID.historyIteration('it-1'));
    expect(row()).toHaveTextContent(`${formatDateTime(shot.createdAt, '12h')} · 27.8 s`);
    expect(row().textContent).toMatch(/^\d{1,2} \w{3} \d{4}, \d{1,2}:\d\d [ap]m · /);
    await act(async () => {
      await services.displayPrefs.setClock('24h');
    });
    expect(row()).toHaveTextContent(`${formatDateTime(shot.createdAt, '24h')} · 27.8 s`);
    expect(row().textContent).toMatch(/^\d{1,2} \w{3} \d{4}, \d\d:\d\d · /);
  });
});

describe('HistoryScreen import and the display choices (D245, D246)', () => {
  it('reads the clock and the TDS switch again after an import, which may bring them to a device that never chose', async () => {
    const services = renderHistory(null, {});
    vi.spyOn(services.storage.porter, 'importAll').mockResolvedValue({ imported: 1, care: 0 });
    const reload = vi.spyOn(services.displayPrefs, 'reload');
    await screen.findByTestId(TID.historyBag(KIAMBU.id));
    await userEvent.upload(screen.getByTestId(TID.importData), new File(['{}'], 'x.json', { type: 'application/json' }));
    expect(await screen.findByText('Imported 1 record.')).toBeInTheDocument();
    expect(reload).toHaveBeenCalled();
  });
});
