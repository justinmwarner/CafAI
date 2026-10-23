// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { UsageService, UsageState } from '../../usage/service.ts';
import { TID } from '../testIds.ts';
import { PRIVACY_URL, UsagePrompt } from './UsagePrompt.tsx';
import { UsageContextForTests } from './useUsage.ts';

function fakeUsage(state: UsageState) {
  const choose = vi.fn();
  const usage: UsageService = {
    getState: () => state,
    subscribe: () => () => undefined,
    start: vi.fn(),
    choose,
    tag: vi.fn(),
    screen: vi.fn(),
    track: vi.fn(),
    dispose: vi.fn(),
  };
  return { usage, choose };
}

const renderWith = (usage: UsageService | null) =>
  render(
    <UsageContextForTests value={usage}>
      <UsagePrompt />
    </UsageContextForTests>,
  );

describe('UsagePrompt (D-USAGE-3)', () => {
  it('asks first, and Yes, share or No thanks answers', async () => {
    const { usage, choose } = fakeUsage({ sharing: false, prompt: 'card', rule: 'ask' });
    renderWith(usage);
    expect(screen.getByTestId(TID.usagePrompt)).toHaveTextContent('Help improve CafAI?');
    expect(screen.getByTestId(TID.usagePrompt)).toHaveTextContent('never your words, your coffee or your key');
    expect(screen.getByTestId(TID.usageYes)).toHaveTextContent('Yes, share');
    expect(screen.getByTestId(TID.usageNo)).toHaveTextContent('No thanks');
    await userEvent.click(screen.getByTestId(TID.usageYes));
    expect(choose).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByTestId(TID.usageNo));
    expect(choose).toHaveBeenCalledWith(false);
  });

  it('tells elsewhere, with OK and Turn off', () => {
    renderWith(fakeUsage({ sharing: true, prompt: 'notice', rule: 'notice' }).usage);
    expect(screen.getByTestId(TID.usagePrompt)).toHaveTextContent('Microsoft Clarity');
    expect(screen.queryByText('Help improve CafAI?')).toBeNull();
    expect(screen.getByTestId(TID.usageYes)).toHaveTextContent('OK');
    expect(screen.getByTestId(TID.usageNo)).toHaveTextContent('Turn off');
  });

  it("links to the README's privacy section, in a new tab outside Decaid", () => {
    renderWith(fakeUsage({ sharing: false, prompt: 'card', rule: 'ask' }).usage);
    const link = screen.getByRole('link', { name: 'What is shared' });
    expect(link).toHaveAttribute('href', PRIVACY_URL);
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('first shows once no coach turn runs, then stays put while one does', () => {
    const { usage } = fakeUsage({ sharing: false, prompt: 'card', rule: 'ask' });
    const at = (busy: boolean) => (
      <UsageContextForTests value={usage}>
        <UsagePrompt busy={busy} />
      </UsageContextForTests>
    );
    const { rerender } = render(at(true));
    expect(screen.queryByTestId(TID.usagePrompt)).toBeNull();
    rerender(at(false));
    expect(screen.getByTestId(TID.usagePrompt)).toBeInTheDocument();
    rerender(at(true));
    expect(screen.getByTestId(TID.usagePrompt)).toBeInTheDocument();
  });

  it('shows nothing once answered, or where the build shares nothing', () => {
    const answered = renderWith(fakeUsage({ sharing: true, prompt: null, rule: 'notice' }).usage);
    expect(answered.container).toBeEmptyDOMElement();
    answered.unmount();
    const none = renderWith(null);
    expect(none.container).toBeEmptyDOMElement();
  });
});
