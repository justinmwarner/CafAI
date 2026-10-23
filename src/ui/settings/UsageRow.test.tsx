// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { UsageService } from '../../usage/service.ts';
import { TID } from '../testIds.ts';
import { UsageContextForTests } from '../usage/useUsage.ts';
import { UsageRow } from './UsageRow.tsx';

describe('UsageRow (D-USAGE-3)', () => {
  it('shows the device sharing and turns it off', async () => {
    const choose = vi.fn();
    // One object, as the service keeps it between changes: useSyncExternalStore loops on a new one each read.
    const state = { sharing: true, prompt: 'notice', rule: 'notice' } as const;
    const usage: UsageService = {
      getState: () => state,
      subscribe: () => () => undefined,
      start: vi.fn(),
      choose,
      tag: vi.fn(),
      screen: vi.fn(),
      track: vi.fn(),
    };
    render(
      <UsageContextForTests value={usage}>
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
