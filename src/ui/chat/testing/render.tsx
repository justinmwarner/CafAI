/**
 * RTL helpers for the chat, history and settings screens: renders inside the
 * theme (and a ServicesProvider holding in-memory fakes) through RTL's
 * `wrapper`, so `rerender` keeps the same tree instead of remounting it.
 * Not shipped.
 */
import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { ServicesProvider } from '../../../app/services.tsx';
import { createFakeServices, type FakeServices } from '../../testing/fakeServices.ts';
import { previewTheme } from './previewTheme.ts';

export function renderWithServices(ui: ReactElement, services: FakeServices = createFakeServices()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ThemeProvider theme={previewTheme}>
      <ServicesProvider services={services}>{children}</ServicesProvider>
    </ThemeProvider>
  );
  return { ...render(ui, { wrapper }), services };
}

export function renderThemed(ui: ReactElement) {
  const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider theme={previewTheme}>{children}</ThemeProvider>;
  return render(ui, { wrapper });
}
