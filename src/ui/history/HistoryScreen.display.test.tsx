// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import type { DisplayPrefsSaved } from '../../app/displayPrefs.ts';
import { formatDateTime } from '../chat/format.ts';
import { KIAMBU, KIAMBU_ITERATIONS, KIAMBU_VERSIONS, SANTOS } from '../chat/testing/fixtures.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServicesShowing } from '../testing/displayServices.ts';
import { TID } from '../testIds.ts';
import { HistoryScreen } from './HistoryScreen.tsx';

/**
 * History as the barista chose to read it: the clock its times are in
 * (D245). HistoryScreen.test.tsx has the rest.
 */
function renderHistory(bagId: string | null, prefs: DisplayPrefsSaved) {
  const services = createFakeServicesShowing(prefs, { storage: { bags: [SANTOS, KIAMBU], versions: KIAMBU_VERSIONS, iterations: KIAMBU_ITERATIONS } });
  renderWithServices(<HistoryScreen bagId={bagId} onSelectBag={vi.fn()} />, services);
  return services;
}

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
