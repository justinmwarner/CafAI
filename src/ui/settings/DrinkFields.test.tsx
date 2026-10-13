// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithServices } from '../chat/testing/render.tsx';
import { SAMPLE_WORKFLOW } from '../testing/fakeServices.ts';
import { DrinkFieldsGrid, drinksFor, PRESET_KEY } from './DrinkFields.tsx';

const steam = drinksFor(null).find((drink) => drink.key === PRESET_KEY.steam)!;

function renderGrid(layout: 'responsive' | 'rows' | 'columns', disabled = false) {
  const onCommit = vi.fn();
  renderWithServices(
    <DrinkFieldsGrid
      drink={steam}
      data={SAMPLE_WORKFLOW.steamSettings}
      loaded
      disabled={disabled}
      pending={{}}
      failed={{}}
      onCommit={onCommit}
      layout={layout}
    />,
  );
  return { onCommit };
}

describe('DrinkFieldsGrid', () => {
  it('maps each drink to its preset', () => {
    expect(PRESET_KEY).toEqual({ steam: 'steamSettings', hotWater: 'hotWaterData', flush: 'rinseData' });
  });

  for (const layout of ['responsive', 'rows', 'columns'] as const) {
    it(`draws the drink's steppers in ${layout}, each named for its drink`, async () => {
      const { onCommit } = renderGrid(layout);
      expect(screen.getByRole('spinbutton', { name: 'Steam temperature' })).toHaveValue('150');
      expect(screen.getByRole('spinbutton', { name: 'Steam time' })).toHaveValue('50');
      expect(screen.getByRole('spinbutton', { name: 'Steam flow' })).toHaveValue('0.8');
      await userEvent.click(screen.getByRole('button', { name: 'More steam time' }));
      expect(onCommit).toHaveBeenCalledWith(steam, steam.fields[1], 55);
    });
  }

  it('holds every stepper when disabled, its value still showing', () => {
    renderGrid('columns', true);
    expect(screen.getByRole('spinbutton', { name: 'Steam time' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'Steam time' })).toHaveValue('50');
    expect(screen.getByRole('button', { name: 'More steam time' })).toBeDisabled();
  });
});
