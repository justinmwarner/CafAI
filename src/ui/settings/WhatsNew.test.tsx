// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServices } from '../testing/fakeServices.ts';
import { WHATS_NEW_TID, WhatsNew } from './WhatsNew.tsx';

/** The real changelog's released sections, which do not change: 0.1.3's and 0.1.0's. */
function renderFor(appVersion: string) {
  const services = createFakeServices();
  services.appVersion = appVersion;
  return renderWithServices(<WhatsNew />, services);
}

describe('WhatsNew (D248)', () => {
  it("names the running version and opens its section of the changelog in a dialog", async () => {
    renderFor('0.1.3');
    const button = screen.getByTestId(WHATS_NEW_TID.whatsNew);
    expect(button).toHaveTextContent("What's new in 0.1.3");
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: "What's new in 0.1.3" });
    expect(screen.getByTestId(WHATS_NEW_TID.whatsNewDialog)).toContainElement(dialog);
    expect(within(dialog).getByText('Released 23 Oct 2026')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Usage sharing',
      'The coach',
      'The everyday skin',
      'Decaid',
    ]);
    // A bold path read whole, though the changelog wraps it over two lines.
    const path = within(dialog).getByText("Settings > About > Share usage with CafAI's developer");
    expect(path.tagName).toBe('STRONG');
    expect(within(dialog).getAllByRole('listitem').length).toBeGreaterThan(10);
    // The next version's changes and the older ones stay out.
    expect(dialog).not.toHaveTextContent('Where the coach runs survives a Decaid update');
    expect(dialog).not.toHaveTextContent('Settings > Machine care: Decent');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it("shows a section's paragraphs and code, and no day where the heading names none", async () => {
    renderFor('0.1.0');
    await userEvent.click(screen.getByTestId(WHATS_NEW_TID.whatsNew));
    const dialog = await screen.findByRole('dialog', { name: "What's new in 0.1.0" });
    expect(within(dialog).getByText(/^The first public version: a complete skin for Decaid/)).toBeInTheDocument();
    expect(within(dialog).getByText('npm run test:decaid').tagName).toBe('CODE');
    expect(within(dialog).queryByText(/^Released/)).toBeNull();
  });

  it('is not there when the running version has no section', () => {
    const { container } = renderFor('0.1.0-test');
    expect(container).toBeEmptyDOMElement();
  });
});
