// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ServicesProvider } from '../../app/services.tsx';
import { dailyPick } from '../saver/daily.ts';
import { createSaverPreview } from '../saver/preview.ts';
import { localDayNumber } from '../saver/random.ts';
import { SAVERS } from '../saver/registry.ts';
import { TID } from '../testIds.ts';
import { createFakeServices, type FakeServices } from '../testing/fakeServices.ts';
import { SAVER_HELP, SAVER_HERE_ONLY, SAVER_TIMING_TID, saverHelp, ScreensaverSection, type ScreensaverSectionProps } from './ScreensaverSection.tsx';

const ALL = SAVERS.map((saver) => saver.id);

function setup(options: { insideDecaid?: boolean; services?: FakeServices } & ScreensaverSectionProps = {}) {
  const services = options.services ?? createFakeServices({ insideDecaid: options.insideDecaid ?? true });
  const preview = options.preview ?? createSaverPreview();
  render(
    <ServicesProvider services={services}>
      <ScreensaverSection savers={options.savers} webgl={options.webgl} preview={preview} />
    </ServicesProvider>,
  );
  return { services, preview };
}

function pick(): HTMLSelectElement {
  return screen.getByTestId(TID.saverPick) as HTMLSelectElement;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('ScreensaverSection', () => {
  it('starts on, a different one each day, naming today’s, with the line under the choice', () => {
    setup();
    expect(screen.getByRole('region', { name: 'Screensaver' })).toBeInTheDocument();
    expect(screen.getByTestId(TID.saverOn)).toBeChecked();
    expect(pick().value).toBe('daily');
    const labels = [...pick().options].map((option) => option.textContent);
    expect(labels).toEqual(['A different one each day', ...SAVERS.map((saver) => saver.label)]);
    const today = SAVERS.find((saver) => saver.id === dailyPick(ALL, localDayNumber(new Date())))!.label;
    expect(screen.getByText(`Today: ${today}`)).toBeInTheDocument();
    expect(screen.getByText(SAVER_HELP)).toBeInTheDocument();
  });

  it('outside Decaid says it shows only on the tablet, and that Preview shows it here', () => {
    setup({ insideDecaid: false });
    expect(screen.getByText(`${SAVER_HELP} ${SAVER_HERE_ONLY}`)).toBeInTheDocument();
  });

  it('turning it off applies at once and is saved, the pick kept', async () => {
    const { services } = setup();
    fireEvent.click(screen.getByTestId(TID.saverOn));
    expect(screen.getByTestId(TID.saverOn)).not.toBeChecked();
    expect(services.screensaver.get()).toEqual({ on: false, pick: 'daily' });
    await settle();
    expect((await services.storage.settings.get()).screensaver).toEqual({ on: false, pick: 'daily' });
  });

  it('a choice applies at once and is saved', async () => {
    const { services } = setup();
    fireEvent.change(pick(), { target: { value: 'beanfield' } });
    expect(pick().value).toBe('beanfield');
    expect(screen.queryByText(/^Today:/)).toBeNull();
    await settle();
    expect((await services.storage.settings.get()).screensaver).toEqual({ on: true, pick: 'beanfield' });
  });

  it('shows a pick this build does not know as a different one each day', () => {
    const services = createFakeServices({ insideDecaid: true });
    void services.screensaver.set({ on: true, pick: 'pipes' });
    setup({ services });
    expect(pick().value).toBe('daily');
  });

  it('Preview shows the chosen one, or today’s for a different one each day, and never wakes anything', async () => {
    const { services, preview } = setup();
    fireEvent.click(screen.getByTestId(TID.saverPreview));
    expect(preview.current()).toBe(dailyPick(ALL, localDayNumber(new Date())));
    expect(preview.request()?.seed).toBe(localDayNumber(new Date()));
    preview.hide();
    fireEvent.change(pick(), { target: { value: 'rain' } });
    fireEvent.click(screen.getByTestId(TID.saverPreview));
    expect(preview.current()).toBe('rain');
    await settle();
    expect(services.decaid.calls.filter((call) => call.method === 'setMachineState')).toEqual([]);
  });

  it('a failed save says so, and the change stays on screen for now', async () => {
    const services = createFakeServices({ insideDecaid: true });
    services.storage.settings.update = async () => {
      throw new Error('The disk is full.');
    };
    setup({ services });
    fireEvent.click(screen.getByTestId(TID.saverOn));
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save the screensaver: The disk is full.');
    expect(screen.getByTestId(TID.saverOn)).not.toBeChecked();
  });

  it('greys out a screensaver that needs WebGL where WebGL cannot start, says so, and leaves it out of the days', () => {
    const savers = SAVERS.map((saver) => (saver.id === 'lava' ? { ...saver, context: 'webgl' as const } : saver));
    setup({ savers, webgl: false });
    const lava = [...pick().options].find((option) => option.value === 'lava')!;
    expect(lava.disabled).toBe(true);
    expect(screen.getByText("Lava Latte needs WebGL, which can't start on this device.")).toBeInTheDocument();
    const today = SAVERS.find((saver) => saver.id === dailyPick(ALL.filter((id) => id !== 'lava'), localDayNumber(new Date())))!.label;
    expect(screen.getByText(`Today: ${today}`)).toBeInTheDocument();
  });

  it('offers it where WebGL starts', () => {
    const savers = SAVERS.map((saver) => (saver.id === 'lava' ? { ...saver, context: 'webgl' as const } : saver));
    setup({ savers, webgl: true });
    expect([...pick().options].find((option) => option.value === 'lava')!.disabled).toBe(false);
    expect(screen.queryByText(/needs WebGL/)).toBeNull();
  });
});

describe('ScreensaverSection: Starts after and Dims the screen to (D247)', () => {
  const startsAfter = () => screen.getByTestId(SAVER_TIMING_TID.startAfter) as HTMLSelectElement;
  const dimsTo = () => screen.getByTestId(SAVER_TIMING_TID.dimTo) as HTMLSelectElement;

  it('offers 1, 2, 5, 10 or 15 minutes and 10 % to 60 %, a minute and 30 % until someone chooses', () => {
    setup();
    expect(screen.getByRole('combobox', { name: 'Starts after' })).toBe(startsAfter());
    expect(screen.getByRole('combobox', { name: 'Dims the screen to' })).toBe(dimsTo());
    expect([...startsAfter().options].map((option) => option.textContent)).toEqual(['1 minute', '2 minutes', '5 minutes', '10 minutes', '15 minutes']);
    expect([...dimsTo().options].map((option) => option.textContent)).toEqual(['10 %', '20 %', '30 %', '40 %', '50 %', '60 %']);
    expect(startsAfter().value).toBe('1');
    expect(dimsTo().value).toBe('30');
  });

  it('shows the saved choices, and the help line says the minutes chosen', async () => {
    const services = createFakeServices({ insideDecaid: true });
    await services.screensaver.set({ startAfterMinutes: 5, dimTo: 20 });
    setup({ services });
    expect(startsAfter().value).toBe('5');
    expect(dimsTo().value).toBe('20');
    expect(screen.getByText(saverHelp(5))).toBeInTheDocument();
    expect(saverHelp(5)).toBe(
      'Shows once the machine has been asleep and the screen untouched for 5 minutes. A tap wakes the machine. The screen stays on, dimmed, for 30 minutes.',
    );
    expect(saverHelp(1)).toBe(SAVER_HELP);
  });

  it('each applies at once and is saved, the rest of the setting kept', async () => {
    const { services } = setup();
    fireEvent.change(startsAfter(), { target: { value: '10' } });
    expect(startsAfter().value).toBe('10');
    expect(screen.getByText(saverHelp(10))).toBeInTheDocument();
    fireEvent.change(dimsTo(), { target: { value: '50' } });
    expect(dimsTo().value).toBe('50');
    expect(services.screensaver.get()).toEqual({ on: true, pick: 'daily', startAfterMinutes: 10, dimTo: 50 });
    await settle();
    expect((await services.storage.settings.get()).screensaver).toEqual({ on: true, pick: 'daily', startAfterMinutes: 10, dimTo: 50 });
    // The switch and the pick keep the wait and the brightness.
    fireEvent.click(screen.getByTestId(TID.saverOn));
    fireEvent.change(pick(), { target: { value: 'rain' } });
    await settle();
    expect((await services.storage.settings.get()).screensaver).toEqual({ on: false, pick: 'rain', startAfterMinutes: 10, dimTo: 50 });
  });

  it('a failed save says so, and the choice stays on screen for now', async () => {
    const services = createFakeServices({ insideDecaid: true });
    services.storage.settings.update = async () => {
      throw new Error('The disk is full.');
    };
    setup({ services });
    fireEvent.change(dimsTo(), { target: { value: '10' } });
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save the screensaver: The disk is full.');
    expect(dimsTo().value).toBe('10');
  });
});
