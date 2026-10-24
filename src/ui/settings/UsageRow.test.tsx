// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { UsageService } from '../../usage/service.ts';
import { TID } from '../testIds.ts';
import { UsageContextForTests } from '../usage/useUsage.ts';
import { SHARE_USAGE_TITLE, ShareUsageSection, UsageRow } from './UsageRow.tsx';

function fakeUsage(choose = vi.fn()): UsageService {
  // One object, as the service keeps it between changes: useSyncExternalStore loops on a new one each read.
  const state = { sharing: true, prompt: 'notice', rule: 'notice' } as const;
  return {
    getState: () => state,
    subscribe: () => () => undefined,
    start: vi.fn(),
    choose,
    tag: vi.fn(),
    screen: vi.fn(),
    track: vi.fn(),
    dispose: vi.fn(),
  };
}

describe('UsageRow (D212)', () => {
  it('shows the device sharing and turns it off', async () => {
    const choose = vi.fn();
    render(
      <UsageContextForTests value={fakeUsage(choose)}>
        <UsageRow />
      </UsageContextForTests>,
    );
    const toggle = screen.getByTestId(TID.usageSwitch);
    expect(toggle).toBeChecked();
    expect(screen.getByText("Share usage with CafAI's developer")).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(choose).toHaveBeenCalledWith(false);
  });

  it('is not there where the build shares nothing', () => {
    const { container } = render(
      <UsageContextForTests value={null}>
        <UsageRow />
      </UsageContextForTests>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Settings > Data and privacy > Share usage (D212)', () => {
  it('holds the switch in a card of its own', () => {
    render(
      <UsageContextForTests value={fakeUsage()}>
        <ShareUsageSection />
      </UsageContextForTests>,
    );
    const card = screen.getByRole('region', { name: SHARE_USAGE_TITLE });
    expect(within(card).getByTestId(TID.usageSwitch)).toBeInTheDocument();
    expect(within(card).getByText('Screens, taps and coach steps go to Microsoft Clarity, with all text hidden.')).toBeInTheDocument();
  });

  it('leaves the card out with the switch where the build shares nothing', () => {
    const { container } = render(
      <UsageContextForTests value={null}>
        <ShareUsageSection />
      </UsageContextForTests>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
