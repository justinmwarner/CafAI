/**
 * Render a component the way the app does: services, theme. Tests only.
 */
import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { ServicesProvider } from '../../app/services.tsx';
import type { Services } from '../../app/types.ts';
import { theme } from '../theme.ts';
import { createFakeServices, type FakeServices } from './fakeServices.ts';

export function renderWithServices<S extends Services = FakeServices>(
  ui: ReactElement,
  services: S = createFakeServices() as unknown as S,
) {
  const wrap = (node: ReactElement) => (
    <ServicesProvider services={services}>
      <ThemeProvider theme={theme}>{node}</ThemeProvider>
    </ServicesProvider>
  );
  const result = render(wrap(ui));
  return { ...result, services, rerenderWith: (next: ReactElement) => result.rerender(wrap(next)) };
}
