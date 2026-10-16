// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Workflow, WorkflowPatch } from '../../api/types.ts';
import type { TemperatureUnit } from '../../coach/temperature.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { SAMPLE_WORKFLOW } from '../testing/fakeServices.ts';
import { createFakeServicesIn } from '../testing/temperatureServices.ts';
import { DrinkSettingsSection } from './DrinkSettingsSection.tsx';

/**
 * Settings > Steam, hot water and flush for a barista who reads °F
 * (D173), against a Decaid that keeps the three temperatures as whole °C
 * and truncates anything else, as its parseInt does (models/data/utils.dart).
 */
type Drink = 'steamSettings' | 'hotWaterData' | 'rinseData';

const keeps = (patch: WorkflowPatch[Drink] | undefined) =>
  patch && 'targetTemperature' in patch && typeof patch.targetTemperature === 'number'
    ? { ...patch, targetTemperature: Math.trunc(patch.targetTemperature) }
    : patch;

function renderIn(unit: TemperatureUnit, model = 'DE1Pro') {
  const services = createFakeServicesIn(unit);
  let workflow: Workflow = { ...SAMPLE_WORKFLOW };
  services.decaid.getWorkflow = async () => workflow;
  const updateWorkflow = vi.fn(async (patch: WorkflowPatch) => {
    const merged = { ...workflow };
    for (const drink of ['steamSettings', 'hotWaterData', 'rinseData'] as const) {
      const part = keeps(patch[drink]);
      if (part) Object.assign(merged, { [drink]: { ...workflow[drink], ...part } });
    }
    workflow = merged;
    return workflow;
  });
  services.decaid.updateWorkflow = updateWorkflow;
  services.decaid.getMachineInfo = async () => ({ version: '1358', model, serialNumber: '1', GHC: false });
  renderWithServices(<DrinkSettingsSection />, services);
  return { services, updateWorkflow, workflow: () => workflow };
}

const HELP = 'The Steam, Hot water and Flush buttons use these. Changes go to Decaid at once.';
const field = (name: string) => screen.getByRole('spinbutton', { name });
async function findField(name: string): Promise<HTMLElement> {
  await screen.findByText(HELP);
  return field(name);
}

/** Type `text` into a field and leave it, as a barista does. */
async function typeAndLeave(name: string, text: string) {
  const input = field(name);
  await userEvent.clear(input);
  await userEvent.type(input, text);
  await userEvent.tab();
}

describe('the drink steppers in °F (D173)', () => {
  it('show each temperature in whole °F, its unit and its bounds, and the rest as before', async () => {
    renderIn('fahrenheit');
    const steam = await findField('Steam temperature');
    expect(steam).toHaveValue('302');
    expect(steam).toHaveAttribute('aria-valuetext', '302 degrees Fahrenheit');
    expect(steam).toHaveAttribute('aria-valuenow', '302');
    expect(steam).toHaveAttribute('aria-valuemin', '275');
    expect(steam).toHaveAttribute('aria-valuemax', '320');
    expect(steam.parentElement).toHaveTextContent('°F');
    expect(field('Hot water temperature')).toHaveValue('167');
    expect(field('Hot water temperature')).toHaveAttribute('aria-valuemin', '34');
    expect(field('Hot water temperature')).toHaveAttribute('aria-valuemax', '212');
    expect(field('Flush temperature')).toHaveValue('194');
    // Times, volumes and flows are not temperatures.
    expect(field('Steam time')).toHaveValue('50');
    expect(field('Steam time')).toHaveAttribute('aria-valuetext', '50 seconds');
    expect(field('Hot water volume')).toHaveValue('50');
  });

  it("a Bengle's steam goes to 329 °F", async () => {
    renderIn('fahrenheit', 'Bengle');
    await screen.findByText(HELP);
    await waitFor(() => expect(field('Steam temperature')).toHaveAttribute('aria-valuemax', '329'));
  });

  it('More moves the setting one whole °C, and Decaid gives back what shows', async () => {
    const { updateWorkflow, workflow } = renderIn('fahrenheit');
    await findField('Steam temperature');
    await userEvent.click(screen.getByRole('button', { name: 'More steam temperature' }));
    expect(updateWorkflow).toHaveBeenLastCalledWith({ steamSettings: { targetTemperature: 151 } });
    await waitFor(() => expect(field('Steam temperature')).toHaveValue('304'));
    expect(workflow().steamSettings.targetTemperature).toBe(151);
    await userEvent.click(screen.getByRole('button', { name: 'Less hot water temperature' }));
    expect(updateWorkflow).toHaveBeenLastCalledWith({ hotWaterData: { targetTemperature: 74 } });
    await waitFor(() => expect(field('Hot water temperature')).toHaveValue('165'));
  });

  it('a typed °F is written as the nearest whole °C, and the field shows what Decaid keeps', async () => {
    const { updateWorkflow, workflow } = renderIn('fahrenheit');
    await findField('Steam temperature');
    await typeAndLeave('Steam temperature', '300');
    expect(updateWorkflow).toHaveBeenLastCalledWith({ steamSettings: { targetTemperature: 149 } });
    await waitFor(() => expect(field('Steam temperature')).toHaveValue('300'));
    // 276 °F is no whole °C: 136 °C, which reads 277.
    await typeAndLeave('Steam temperature', '276');
    expect(updateWorkflow).toHaveBeenLastCalledWith({ steamSettings: { targetTemperature: 136 } });
    await waitFor(() => expect(field('Steam temperature')).toHaveValue('277'));
    expect(workflow().steamSettings.targetTemperature).toBe(136);
  });

  it('a typed value past an end lands on it, and More there sends nothing', async () => {
    const { updateWorkflow } = renderIn('fahrenheit');
    await findField('Steam temperature');
    await typeAndLeave('Steam temperature', '999');
    expect(updateWorkflow).toHaveBeenLastCalledWith({ steamSettings: { targetTemperature: 160 } });
    await waitFor(() => expect(field('Steam temperature')).toHaveValue('320'));
    const before = updateWorkflow.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'More steam temperature' }));
    expect(updateWorkflow.mock.calls.length).toBe(before);
    await typeAndLeave('Hot water temperature', '0');
    expect(updateWorkflow).toHaveBeenLastCalledWith({ hotWaterData: { targetTemperature: 1 } });
    await waitFor(() => expect(field('Hot water temperature')).toHaveValue('34'));
  });

  it('round trips every bound: typed, written, read back as typed', async () => {
    const { workflow } = renderIn('fahrenheit');
    await findField('Steam temperature');
    for (const [name, drink, typed, celsius] of [
      ['Steam temperature', 'steamSettings', '275', 135],
      ['Steam temperature', 'steamSettings', '320', 160],
      ['Hot water temperature', 'hotWaterData', '34', 1],
      ['Hot water temperature', 'hotWaterData', '212', 100],
      ['Flush temperature', 'rinseData', '34', 1],
      ['Flush temperature', 'rinseData', '212', 100],
    ] as const) {
      await typeAndLeave(name, typed);
      await waitFor(() => expect(workflow()[drink].targetTemperature, `${name} ${typed}`).toBe(celsius));
      await waitFor(() => expect(field(name), `${name} ${typed}`).toHaveValue(typed));
    }
  });

  it('Up and Down from a typed °F step from the °C it stands for', async () => {
    const { updateWorkflow } = renderIn('fahrenheit');
    await findField('Steam temperature');
    const input = field('Steam temperature');
    // 290 °F stands for 143 °C (289 °F): Up is 144 °C, 291 °F.
    await userEvent.clear(input);
    await userEvent.type(input, '290');
    await userEvent.keyboard('{ArrowUp}');
    await waitFor(() => expect(field('Steam temperature')).toHaveValue('291'));
    expect(updateWorkflow).toHaveBeenLastCalledWith({ steamSettings: { targetTemperature: 144 } });
    // And Down from it, 142 °C, 288 °F.
    await userEvent.clear(input);
    await userEvent.type(input, '290');
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(field('Steam temperature')).toHaveValue('288'));
    expect(updateWorkflow).toHaveBeenLastCalledWith({ steamSettings: { targetTemperature: 142 } });
  });

  it('leaving a field untouched sends nothing, in °F as in °C', async () => {
    const { updateWorkflow } = renderIn('fahrenheit');
    const input = await findField('Steam temperature');
    await userEvent.click(input);
    await userEvent.tab();
    expect(updateWorkflow).not.toHaveBeenCalled();
  });

  it('switch the unit and the fields follow at once', async () => {
    const { services } = renderIn('fahrenheit');
    expect(await findField('Steam temperature')).toHaveValue('302');
    await act(() => services.temperatureUnit.set('celsius'));
    expect(field('Steam temperature')).toHaveValue('150');
    expect(field('Steam temperature')).toHaveAttribute('aria-valuetext', '150 degrees Celsius');
    expect(field('Steam temperature')).toHaveAttribute('aria-valuemax', '160');
  });
});
