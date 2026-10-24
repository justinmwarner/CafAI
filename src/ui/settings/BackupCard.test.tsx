// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, within } from '@testing-library/react';
import { DecaidKvMirror } from '../../storage/mirror.ts';
import { createMemoryKv } from '../../storage/testing/memoryKv.ts';
import type { KvMirror } from '../../storage/types.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { BACKUP_CARD_TITLE, BACKUP_SENTENCE, BackupCard } from './BackupCard.tsx';

afterEach(() => {
  vi.useRealTimers();
});

type MirrorStatus = Partial<Pick<KvMirror, 'lastPushAt' | 'lastError' | 'backupKnown'>>;

function renderBackup(status: MirrorStatus = {}) {
  const services = createFakeServices();
  services.storage.mirror = { ...services.storage.mirror, ...status };
  renderWithServices(<BackupCard />, services);
  return services;
}

/** The card over a mirror whose status the test moves, telling its subscribers as mirror.ts does; returns the mover. */
function renderWithLiveMirror(status: MirrorStatus) {
  const services = createFakeServices();
  const listeners = new Set<() => void>();
  const mirror = {
    ...services.storage.mirror,
    ...status,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  services.storage.mirror = mirror;
  renderWithServices(<BackupCard />, services);
  return (patch: MirrorStatus) =>
    act(() => {
      Object.assign(mirror, patch);
      for (const listener of [...listeners]) listener();
    });
}

const backupLine = () => screen.getByTestId(TID.backupHealth);

describe('Settings > Data and privacy > Backup in Decaid (5.15)', () => {
  it('says how the backup stands, then what the copy in Decaid holds, never the API key', () => {
    renderBackup({ lastPushAt: new Date(Date.now() - 5 * 60_000).toISOString() });
    const card = screen.getByRole('region', { name: BACKUP_CARD_TITLE });
    expect(within(card).getByTestId(TID.backupHealth)).toHaveTextContent('Backed up to Decaid 5 min ago');
    expect(within(card).getByText(BACKUP_SENTENCE)).toBeInTheDocument();
    expect(BACKUP_SENTENCE).toBe(
      'CafAI copies your bags, versions, shots and settings to Decaid, so a new device or a Decaid update gets them back. Never the API key.',
    );
  });

  it('says hours, then days, for an older backup (Decaid keeps its time across quiet spells)', () => {
    renderBackup({ lastPushAt: new Date(Date.now() - 5 * 3_600_000).toISOString() });
    expect(backupLine()).toHaveTextContent('Backed up to Decaid 5 h ago');
    cleanup();
    renderBackup({ lastPushAt: new Date(Date.now() - 3 * 86_400_000).toISOString() });
    expect(backupLine()).toHaveTextContent('Backed up to Decaid 3 days ago');
  });

  it('says the backup is paused, with the reason, even if it once succeeded', () => {
    renderBackup({ lastPushAt: new Date(Date.now() - 5 * 60_000).toISOString(), lastError: "Decaid's store is full" });
    expect(backupLine()).toHaveTextContent("Backup paused: Decaid's store is full");
  });

  it('says the reason once: mirror.ts\'s lastError already reads "Could not back up to Decaid: ...", so that part is not repeated', () => {
    renderBackup({ lastError: 'Could not back up to Decaid: Decaid is busy. Try again in a moment.' });
    expect(backupLine()).toHaveTextContent('Backup paused: Decaid is busy. Try again in a moment.');
    expect(backupLine().textContent).not.toContain('Could not back up to Decaid');
  });

  it('says it has not backed up yet when Decaid holds no backup and this page pushed none', () => {
    renderBackup();
    expect(backupLine()).toHaveTextContent('Not backed up yet');
  });

  it('follows the mirror while the card is open: a push that lands, then one that fails', () => {
    const move = renderWithLiveMirror({ lastPushAt: null, lastError: null, backupKnown: true });
    expect(backupLine()).toHaveTextContent('Not backed up yet');
    move({ lastPushAt: new Date().toISOString() });
    expect(backupLine()).toHaveTextContent('Backed up to Decaid 0 min ago');
    move({ lastError: 'Could not back up to Decaid: Decaid is busy. Try again in a moment.' });
    expect(backupLine()).toHaveTextContent('Backup paused: Decaid is busy. Try again in a moment.');
  });

  it('counts the minutes up while the card stays open', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-10T09:00:00.000Z'));
    renderBackup({ lastPushAt: '2026-10-10T08:55:00.000Z' });
    expect(backupLine()).toHaveTextContent('Backed up to Decaid 5 min ago');
    act(() => vi.advanceTimersByTime(60_000));
    expect(backupLine()).toHaveTextContent('Backed up to Decaid 6 min ago');
  });

  it('leaves the line out until the mirror knows how the backup stands, rather than say it is not backed up', () => {
    const move = renderWithLiveMirror({ lastPushAt: null, lastError: null, backupKnown: false });
    expect(screen.queryByTestId(TID.backupHealth)).toBeNull();
    expect(screen.getByText(BACKUP_SENTENCE)).toBeInTheDocument();
    move({ backupKnown: true });
    expect(backupLine()).toHaveTextContent('Not backed up yet');
  });

  it("on a fresh page, says when Decaid's copy was last completed, from Decaid's own record, never \"Not backed up yet\"", async () => {
    const updatedAt = new Date(Date.now() - 12 * 60_000).toISOString();
    const kv = createMemoryKv({ cafai: { meta: { schemaVersion: 1, appVersion: '0.1.0', updatedAt, pages: { bags: 1, versions: 1, iterations: 1 }, skipped: [] } } });
    const mirror = new DecaidKvMirror({
      kv,
      source: { read: () => Promise.reject(new Error('The card never pushes.')), apiKey: async () => null },
      appVersion: '0.1.0-test',
      defaultModel: 'claude-opus-5-5',
    });
    const services = createFakeServices();
    services.storage.mirror = mirror;
    renderWithServices(<BackupCard />, services);
    expect(await screen.findByTestId(TID.backupHealth)).toHaveTextContent('Backed up to Decaid 12 min ago');
    expect(screen.queryByText('Not backed up yet')).toBeNull();
    mirror.dispose();
  });
});
