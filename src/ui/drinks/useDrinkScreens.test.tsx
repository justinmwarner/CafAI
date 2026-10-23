// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { createFakeServices } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import type { DrinkKind } from './kinds.ts';
import { useDrinkScreen } from './useDrinkScreens.ts';

function Show({ kind }: { kind: DrinkKind }) {
  const { scene, goBack, goBackSeconds } = useDrinkScreen(kind);
  return <output data-testid="screen">{`${scene} ${goBack ? 'back' : 'stay'} ${goBackSeconds}`}</output>;
}

describe('a drink’s screen, as its view reads it', () => {
  it('is the drink’s default scene, going back after 10 s, until someone chooses', () => {
    renderWithServices(<Show kind="hotWater" />);
    expect(screen.getByTestId('screen')).toHaveTextContent('pour back 10');
  });

  it('follows a change at once, and reads a scene the drink does not have as its default', async () => {
    const settings = { model: 'claude-opus-5-5', grinderName: null, grinderSetting: null, activeBagId: null, drinkScreens: { steam: { scene: 'pour' } } };
    const services = createFakeServices({ storage: { settings } });
    renderWithServices(<Show kind="steam" />, services);
    expect(screen.getByTestId('screen')).toHaveTextContent('spray back 10');
    await act(() => services.drinkScreens.set('steam', { scene: 'whirlpool', goBack: false }));
    expect(screen.getByTestId('screen')).toHaveTextContent('whirlpool stay 10');
  });

  it('is every drink’s default outside the app’s services, as in a preview', () => {
    render(<Show kind="flush" />);
    expect(screen.getByTestId('screen')).toHaveTextContent('shower back 10');
  });
});
