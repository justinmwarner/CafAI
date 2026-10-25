// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { createDisplayPrefsStore } from '../../app/displayPrefs.ts';
import { createMemoryCoachSourceStore } from '../../storage/coachSource.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { servicesWithCare } from '../testing/careServices.ts';
import { createFakeSpend, createFakeUsage, type FakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { SETTINGS_GROUP_IDS, type SettingsGroupId } from './groupIds.ts';
import { GroupPage } from './GroupPage.tsx';
import { findControl } from './revealSetting.ts';
import { SETTINGS_INDEX } from './settingsIndex.ts';

beforeEach(() => {
  // The groups read Decaid's grinders with the global fetch; no test may reach a real network.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Every store a card needs, as the app has them: machine care's service,
 * where the coach runs (the API key's), usage sharing, the coach's spend,
 * the display choices, and a version with a CHANGELOG section (What's new).
 */
async function fullServices(): Promise<FakeServices> {
  const services = await servicesWithCare({ settings: { reminders: true } });
  services.coachSource = createMemoryCoachSourceStore({ kind: 'anthropic' });
  services.usage = createFakeUsage().usage;
  services.spend = createFakeSpend();
  services.appVersion = '0.1.3';
  return Object.assign(services, { displayPrefs: createDisplayPrefsStore(services.storage.settings) });
}

describe('the settings index against the pages (D236)', () => {
  it.each(SETTINGS_GROUP_IDS)('finds every setting the index puts in %s on its page, in its card', async (group: SettingsGroupId) => {
    renderWithServices(<GroupPage id={group} layout="pane" />, await fullServices());
    const pane = screen.getByTestId(TID.settingsPane(group));
    const entries = SETTINGS_INDEX.filter((entry) => entry.group === group);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      // Some cards fill in as they read (Sleep and wake from Decaid, the key once where the coach runs is known).
      await waitFor(() => expect(findControl(pane, entry.control), entry.id).not.toBeNull());
      const control = findControl(pane, entry.control)!;
      expect(control.closest('section')?.getAttribute('aria-label'), entry.id).toBe(entry.card);
      if ('chosen' in entry.control && entry.control.chosen) {
        // A set of choices: the reveal focuses the chosen one of the set.
        expect(control.closest('[role="radiogroup"], [role="group"]'), entry.id).not.toBeNull();
      }
    }
  });

  it('finds the controls the index names by their label where the test id is not rendered', async () => {
    renderWithServices(<GroupPage id="drinks" layout="pane" />, await fullServices());
    const pane = screen.getByTestId(TID.settingsPane('drinks'));
    for (const entry of SETTINGS_INDEX.filter((each) => each.group === 'drinks' && !('testId' in each.control))) {
      expect(findControl(pane, entry.control)?.getAttribute('role'), entry.id).toBe('spinbutton');
    }
  });
});
