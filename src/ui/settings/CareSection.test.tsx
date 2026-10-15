// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { TID } from '../testIds.ts';
import { CARE_LINE, CareSection } from './CareSection.tsx';

afterEach(() => cleanup());

describe('Settings > Machine care', () => {
  it('says what the guide is, and links to it', () => {
    renderWithServices(<CareSection />);
    const section = screen.getByRole('region', { name: 'Machine care' });
    expect(within(section).getByText(CARE_LINE)).toBeInTheDocument();
    const open = within(section).getByRole('link', { name: 'Cleaning guide' });
    expect(open).toHaveAttribute('href', '#/care');
    expect(open).toBe(screen.getByTestId(TID.careOpen));
  });
});
