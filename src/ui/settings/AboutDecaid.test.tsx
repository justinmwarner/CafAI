// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { driftLog, formatDriftReport } from '../../api/drift.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { AboutDecaid } from './AboutDecaid.tsx';

beforeEach(() => {
  driftLog.clear();
});

afterEach(() => {
  driftLog.clear();
  vi.unstubAllGlobals();
});

function renderAbout(decaidVersion: string | null, overrides: { lastPushAt?: string | null; lastError?: string | null } = {}) {
  const services = createFakeServices();
  if (overrides.lastPushAt !== undefined || overrides.lastError !== undefined) {
    services.storage.mirror = {
      ...services.storage.mirror,
      lastPushAt: overrides.lastPushAt ?? null,
      lastError: overrides.lastError ?? null,
    };
  }
  renderWithServices(<AboutDecaid decaidVersion={decaidVersion} />, services);
  return services;
}

describe('AboutDecaid version line (4.6)', () => {
  it('shows the running version against the one CafAI was verified with', () => {
    renderAbout('0.9.0');
    expect(screen.getByTestId(TID.aboutDecaid)).toHaveTextContent('Decaid 0.9.0 (CafAI was verified with 0.8.8)');
    expect(screen.queryByText(/Older than the Decaid/)).toBeNull();
  });

  it('adds the older note when the running version is behind the pin', () => {
    renderAbout('0.8.7');
    expect(screen.getByText('Decaid 0.8.7 (CafAI was verified with 0.8.8)')).toBeInTheDocument();
    expect(screen.getByText('Older than the Decaid CafAI was checked against; update Decaid if something does not work.')).toBeInTheDocument();
  });

  it('compares only the numeric part, so a build suffix does not count as older', () => {
    renderAbout('0.8.8+2850');
    expect(screen.getByText('Decaid 0.8.8+2850 (CafAI was verified with 0.8.8)')).toBeInTheDocument();
    expect(screen.queryByText(/Older than the Decaid/)).toBeNull();
  });

  it('shows a version it cannot parse without comparing it', () => {
    renderAbout('nightly');
    expect(screen.getByText('Decaid nightly (CafAI was verified with 0.8.8)')).toBeInTheDocument();
    expect(screen.queryByText(/Older than the Decaid/)).toBeNull();
  });

  it('says Decaid is not connected when there is no version, and skips the comparison', () => {
    renderAbout(null);
    expect(screen.getByText('Decaid version unknown (not connected)')).toBeInTheDocument();
    expect(screen.queryByText(/Older than the Decaid/)).toBeNull();
    expect(screen.queryByText(/CafAI was verified with/)).toBeNull();
  });
});

describe('AboutDecaid recorded drift (D96, 4.6)', () => {
  it('lists what Decaid sent that CafAI did not expect, and copies the report', async () => {
    driftLog.report({ source: 'GET /api/v1/workflow', problem: 'profile: missing' });
    driftLog.report({ source: 'ws/v1/machine/shotState', problem: 'state: unknown value "brewing"' });
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    renderAbout('0.9.0');

    expect(screen.getByText('Decaid sent 2 things CafAI did not expect')).toBeInTheDocument();
    const report = screen.getByTestId(TID.driftReport);
    expect(within(report).getByText('GET /api/v1/workflow: profile: missing')).toBeInTheDocument();
    expect(within(report).getByText('ws/v1/machine/shotState: state: unknown value "brewing"')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId(TID.copyDriftReport));
    const expected = formatDriftReport(driftLog.list(), { appVersion: '0.1.0-test', decaidVersion: '0.9.0', verifiedWith: '0.8.8' });
    expect(writeText).toHaveBeenCalledWith(expected);
    expect(await screen.findByText('Copied.')).toBeInTheDocument();
  });

  it('says "1 thing", not "1 things", for a single kind of drift', () => {
    driftLog.report({ source: 'GET /api/v1/workflow', problem: 'profile: missing' });
    renderAbout('0.9.0');
    expect(screen.getByText('Decaid sent 1 thing CafAI did not expect')).toBeInTheDocument();
  });

  it('shows nothing about drift when none is recorded', () => {
    renderAbout('0.9.0');
    expect(screen.queryByTestId(TID.driftReport)).toBeNull();
    expect(screen.queryByTestId(TID.copyDriftReport)).toBeNull();
    expect(screen.queryByText(/Decaid sent/)).toBeNull();
  });
});

describe('AboutDecaid backup health (5.15)', () => {
  it('says how long ago the backup ran', () => {
    renderAbout('0.9.0', { lastPushAt: new Date(Date.now() - 5 * 60_000).toISOString() });
    expect(screen.getByTestId(TID.backupHealth)).toHaveTextContent('Backed up to Decaid 5 min ago');
  });

  it('says the backup is paused, with the reason, even if it once succeeded', () => {
    renderAbout('0.9.0', { lastPushAt: new Date(Date.now() - 5 * 60_000).toISOString(), lastError: "Decaid's store is full" });
    expect(screen.getByTestId(TID.backupHealth)).toHaveTextContent("Backup paused: Decaid's store is full");
  });

  it('says the reason once: mirror.ts\'s lastError already reads "Could not back up to Decaid: ...", so that part is not repeated', () => {
    renderAbout('0.9.0', { lastError: 'Could not back up to Decaid: Decaid is busy. Try again in a moment.' });
    expect(screen.getByTestId(TID.backupHealth)).toHaveTextContent('Backup paused: Decaid is busy. Try again in a moment.');
    expect(screen.getByTestId(TID.backupHealth).textContent).not.toContain('Could not back up to Decaid');
  });

  it('says it has not backed up yet when neither has happened', () => {
    renderAbout('0.9.0');
    expect(screen.getByTestId(TID.backupHealth)).toHaveTextContent('Not backed up yet');
  });
});
