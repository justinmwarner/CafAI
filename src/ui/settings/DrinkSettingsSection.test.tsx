// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Workflow, WorkflowPatch } from '../../api/types.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServices, IDLE_TELEMETRY, SAMPLE_WORKFLOW, type FakeServices } from '../testing/fakeServices.ts';
import { DrinkSettingsSection } from './DrinkSettingsSection.tsx';

/** Decaid's own PUT /workflow deep-merge, for just the three objects this screen writes. */
function mergeWorkflow(workflow: Workflow, patch: WorkflowPatch): Workflow {
  return {
    ...workflow,
    steamSettings: patch.steamSettings ? { ...workflow.steamSettings, ...patch.steamSettings } : workflow.steamSettings,
    hotWaterData: patch.hotWaterData ? { ...workflow.hotWaterData, ...patch.hotWaterData } : workflow.hotWaterData,
    rinseData: patch.rinseData ? { ...workflow.rinseData, ...patch.rinseData } : workflow.rinseData,
  };
}

function renderDrink(overrides: Partial<Workflow> = {}, model = 'DE1Pro') {
  const services: FakeServices = createFakeServices();
  let workflow: Workflow = { ...SAMPLE_WORKFLOW, ...overrides };
  services.decaid.getWorkflow = async () => {
    services.decaid.calls.push({ method: 'getWorkflow', args: [] });
    return workflow;
  };
  const updateWorkflow = vi.fn(async (patch: WorkflowPatch) => {
    services.decaid.calls.push({ method: 'updateWorkflow', args: [patch] });
    workflow = mergeWorkflow(workflow, patch);
    return workflow;
  });
  services.decaid.updateWorkflow = updateWorkflow;
  services.decaid.getMachineInfo = async () => ({ version: '1358', model, serialNumber: '1', GHC: false });
  renderWithServices(<DrinkSettingsSection />, services);
  return { services, updateWorkflow };
}

const HELP = 'The Steam, Hot water and Flush buttons use these. Changes go to Decaid at once.';

/** A setting's value: a spin button named for its drink ("Steam time"). */
const field = (name: string) => screen.getByRole('spinbutton', { name });
/** The same, once Decaid's presets are in: the help line takes the place of "Reading…". */
async function findField(name: string): Promise<HTMLElement> {
  await screen.findByText(HELP);
  return field(name);
}
const button = (name: string) => screen.queryByRole('button', { name });

describe('DrinkSettingsSection loading', () => {
  it("loads steam, hot water and flush settings from Decaid's workflow", async () => {
    renderDrink();
    expect(await findField('Steam temperature')).toHaveValue('150');
    expect(field('Steam time')).toHaveValue('50');
    expect(field('Steam flow')).toHaveValue('0.8');
    expect(field('Hot water temperature')).toHaveValue('75');
    expect(field('Hot water volume')).toHaveValue('50');
    expect(field('Hot water time')).toHaveValue('30');
    expect(field('Hot water flow')).toHaveValue('10');
    expect(field('Flush temperature')).toHaveValue('90');
    expect(field('Flush time')).toHaveValue('10');
    expect(field('Flush flow')).toHaveValue('6');
    expect(screen.getByText(HELP)).toBeInTheDocument();
  });

  it('groups the settings by drink, as the machine row names them, each under its own heading with short labels', async () => {
    renderDrink();
    await findField('Steam temperature');
    const names = (group: string) =>
      within(screen.getByRole('group', { name: group }))
        .getAllByRole('spinbutton')
        .map((input) => input.getAttribute('aria-label'));
    expect(names('Steam')).toEqual(['Steam temperature', 'Steam time', 'Steam flow']);
    expect(names('Hot water')).toEqual(['Hot water temperature', 'Hot water volume', 'Hot water time', 'Hot water flow']);
    expect(names('Flush')).toEqual(['Flush temperature', 'Flush time', 'Flush flow']);
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Steam', 'Hot water', 'Flush']);
    // The label shown says what, the heading says which drink; the label still names the field.
    const steam = within(screen.getByRole('group', { name: 'Steam' }));
    expect(steam.getByText('Temperature').closest('label')).toHaveAttribute('for', field('Steam temperature').id);
  });

  it('says the value with its unit: shown beside the number, and in words to a screen reader', async () => {
    renderDrink();
    const volume = await findField('Hot water volume');
    expect(volume).toHaveAttribute('aria-valuenow', '50');
    expect(volume).toHaveAttribute('aria-valuetext', '50 millilitres');
    expect(field('Steam temperature')).toHaveAttribute('aria-valuetext', '150 degrees Celsius');
    expect(field('Steam flow')).toHaveAttribute('aria-valuetext', '0.8 millilitres per second');
    const unit = within(screen.getByRole('group', { name: 'Hot water' })).getByText('ml');
    expect(unit).toHaveAttribute('aria-hidden', 'true');
  });

  it("shows a message when Decaid's workflow cannot be read", async () => {
    const services = createFakeServices();
    services.decaid.getWorkflow = async () => {
      throw new Error('Decaid is offline');
    };
    renderWithServices(<DrinkSettingsSection />, services);
    expect(await screen.findByText("Could not read Decaid's drink settings: Decaid is offline")).toBeInTheDocument();
  });

  it('shows a dash, never a made-up value, until Decaid answers, with nothing to step', async () => {
    const services = createFakeServices();
    let answer: (workflow: Workflow) => void = () => {};
    services.decaid.getWorkflow = () => new Promise<Workflow>((resolve) => (answer = resolve));
    renderWithServices(<DrinkSettingsSection />, services);
    expect(screen.getByRole('status')).toHaveTextContent("Reading Decaid's drink settings…");
    expect(screen.queryByText(HELP)).toBeNull();
    for (const name of ['Steam temperature', 'Hot water volume', 'Flush flow']) {
      expect(field(name)).toHaveValue('—');
      expect(field(name)).toBeDisabled();
      expect(field(name)).toHaveAttribute('aria-valuetext', 'Unknown');
    }
    // A dash between a minus and a plus would read as a third minus.
    expect(button('More hot water volume')).toBeNull();
    act(() => answer(SAMPLE_WORKFLOW));
    await waitFor(() => expect(field('Hot water volume')).toHaveValue('50'));
    expect(button('More hot water volume')).toBeEnabled();
    expect(screen.queryByText("Reading Decaid's drink settings…")).toBeNull();
    expect(screen.getByText(HELP)).toBeInTheDocument();
  });

  it('after a read that failed, the fields stay dashes and Retry reads again', async () => {
    const services = createFakeServices();
    let fail = true;
    services.decaid.getWorkflow = async () => {
      if (fail) throw new Error('Decaid is offline');
      return SAMPLE_WORKFLOW;
    };
    renderWithServices(<DrinkSettingsSection />, services);
    await screen.findByText("Could not read Decaid's drink settings: Decaid is offline");
    expect(field('Steam time')).toHaveValue('—');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(field('Steam time')).toHaveValue('50'));
    expect(screen.queryByText(/Could not read Decaid's drink settings/)).toBeNull();
  });

  it("a field Decaid sent that CafAI could not read is a dash with a note, never Decaid's default", async () => {
    const { updateWorkflow } = renderDrink({ steamSettings: { targetTemperature: 150, duration: null, flow: null } });
    await waitFor(() => expect(field('Steam flow')).toHaveValue('—'));
    expect(field('Steam flow')).toBeDisabled();
    expect(field('Steam time')).toHaveValue('—');
    const notes = screen.getAllByText("CafAI could not read Decaid's value.");
    expect(notes).toHaveLength(2);
    expect(field('Steam flow')).toHaveAttribute('aria-describedby', notes[1]!.id);
    expect(button('More steam flow')).toBeNull();
    expect(field('Steam temperature')).toHaveValue('150');
    expect(button('More steam temperature')).toBeEnabled();
    expect(updateWorkflow).not.toHaveBeenCalled();
  });
});

describe('DrinkSettingsSection without a machine', () => {
  it('shows the values, but disables every field and says why: Decaid refuses these writes without a DE1', async () => {
    const { services, updateWorkflow } = renderDrink();
    await findField('Steam temperature');
    act(() => services.telemetry.setState({ machineConnected: false }));
    expect(screen.getByRole('status')).toHaveTextContent('Connect the DE1 to change these.');
    expect(screen.queryByText(HELP)).toBeNull();
    expect(field('Steam time')).toHaveValue('50');
    expect(field('Steam time')).toBeDisabled();
    expect(button('More steam time')).toBeDisabled();
    expect(button('Less flush flow')).toBeDisabled();
    expect(updateWorkflow).not.toHaveBeenCalled();
    act(() => services.telemetry.setState({ machineConnected: true }));
    expect(screen.queryByText('Connect the DE1 to change these.')).toBeNull();
    expect(screen.getByText(HELP)).toBeInTheDocument();
    expect(button('More steam time')).toBeEnabled();
  });
});

describe('DrinkSettingsSection steam temperature range (the DE1 vs. the Bengle)', () => {
  it("clamps to the DE1's 135-160 range when the model is a DE1 (or not yet known)", async () => {
    const { updateWorkflow } = renderDrink({}, 'DE1Pro');
    const input = await findField('Steam temperature');
    await userEvent.clear(input);
    await userEvent.type(input, '999');
    await userEvent.tab();
    await waitFor(() => expect(updateWorkflow).toHaveBeenCalledTimes(1));
    expect(updateWorkflow.mock.calls[0]?.[0]).toEqual({ steamSettings: { targetTemperature: 160 } });
    expect(input).toHaveValue('160');
  });

  it("clamps to the Bengle's wider 135-165 range only once the machine answers Bengle", async () => {
    const { updateWorkflow } = renderDrink({}, 'Bengle');
    const input = await findField('Steam temperature');
    await userEvent.clear(input);
    await userEvent.type(input, '999');
    await userEvent.tab();
    await waitFor(() => expect(updateWorkflow).toHaveBeenCalledTimes(1));
    expect(updateWorkflow.mock.calls[0]?.[0]).toEqual({ steamSettings: { targetTemperature: 165 } });
  });

  it('fails safe to the narrower DE1 range when the machine info cannot be read', async () => {
    const services = createFakeServices();
    const workflow: Workflow = { ...SAMPLE_WORKFLOW };
    services.decaid.getWorkflow = async () => workflow;
    services.decaid.getMachineInfo = async () => {
      throw new Error('offline');
    };
    const updateWorkflow = vi.fn(async (patch: WorkflowPatch) => mergeWorkflow(workflow, patch));
    services.decaid.updateWorkflow = updateWorkflow;
    renderWithServices(<DrinkSettingsSection />, services);
    const input = await findField('Steam temperature');
    await userEvent.clear(input);
    await userEvent.type(input, '999');
    await userEvent.tab();
    await waitFor(() => expect(updateWorkflow).toHaveBeenCalledTimes(1));
    expect(updateWorkflow.mock.calls[0]?.[0]).toEqual({ steamSettings: { targetTemperature: 160 } });
  });
});

describe('DrinkSettingsSection steam off (D97, the spec allows 0)', () => {
  const steamOff = { steamSettings: { targetTemperature: 0, duration: 50, flow: 0.8, stopAtTemperature: 0 } };

  it('shows steam temperature 0 as "Off in Decaid" in the field, read-only, and offers no stepper for it', async () => {
    renderDrink(steamOff);
    // The field is re-queried fresh: its buttons and value change once Decaid answers.
    await waitFor(() => expect(field('Steam temperature')).toHaveValue('Off in Decaid'));
    expect(field('Steam temperature')).toBeDisabled();
    expect(field('Steam temperature')).toHaveAttribute('aria-valuetext', 'Off in Decaid');
    expect(field('Steam temperature')).not.toHaveAttribute('aria-valuenow');
    expect(button('Less steam temperature')).toBeNull();
    expect(button('More steam temperature')).toBeNull();
  });

  it('shows any steam temperature below 135 °C as off, as Decaid treats it, so Less can never turn the heater on', async () => {
    const { updateWorkflow } = renderDrink({ steamSettings: { targetTemperature: 120, duration: 50, flow: 0.8 } });
    await waitFor(() => expect(field('Steam temperature')).toHaveValue('Off in Decaid'));
    expect(button('Less steam temperature')).toBeNull();
    expect(updateWorkflow).not.toHaveBeenCalled();
  });

  it('never writes a value for steam temperature while it is off', async () => {
    const { updateWorkflow } = renderDrink(steamOff);
    await waitFor(() => expect(field('Steam temperature')).toHaveValue('Off in Decaid'));
    // Steam time still has its ordinary stepper; using it must never touch steamSettings.targetTemperature.
    await userEvent.click(button('More steam time')!);
    await waitFor(() => expect(updateWorkflow).toHaveBeenCalledTimes(1));
    expect(updateWorkflow.mock.calls[0]?.[0]).toEqual({ steamSettings: { duration: 55 } });
  });
});

describe('DrinkSettingsSection edits', () => {
  it('writes only the changed object, clamped to its range', async () => {
    const { updateWorkflow } = renderDrink();
    const input = await findField('Hot water volume');
    await userEvent.clear(input);
    await userEvent.type(input, '999');
    await userEvent.tab();
    await waitFor(() => expect(updateWorkflow).toHaveBeenCalledTimes(1));
    expect(updateWorkflow.mock.calls[0]?.[0]).toEqual({ hotWaterData: { volume: 255 } });
    expect(input).toHaveValue('255');
  });

  it('rounds an integer field typed with a decimal', async () => {
    const { updateWorkflow } = renderDrink();
    const input = await findField('Hot water volume');
    await userEvent.clear(input);
    await userEvent.type(input, '75.6');
    await userEvent.tab();
    await waitFor(() => expect(updateWorkflow).toHaveBeenCalledTimes(1));
    expect(updateWorkflow.mock.calls[0]?.[0]).toEqual({ hotWaterData: { volume: 76 } });
    expect(input).toHaveValue('76');
  });

  it('nudges a field by its step with the +/- buttons', async () => {
    renderDrink();
    const input = await findField('Steam flow');
    expect(input).toHaveValue('0.8');
    await userEvent.click(button('More steam flow')!);
    await waitFor(() => expect(input).toHaveValue('0.9'));
    await userEvent.click(button('Less steam flow')!);
    await userEvent.click(button('Less steam flow')!);
    await waitFor(() => expect(input).toHaveValue('0.7'));
  });

  it('steps with the arrow keys, from what is typed, and keeps the buttons out of the tab order', async () => {
    const { updateWorkflow } = renderDrink();
    const input = await findField('Steam time');
    expect(button('More steam time')).toHaveAttribute('tabindex', '-1');
    expect(button('Less steam time')).toHaveAttribute('tabindex', '-1');
    act(() => input.focus());
    await userEvent.keyboard('{ArrowUp}');
    await waitFor(() => expect(input).toHaveValue('55'));
    expect(updateWorkflow.mock.calls.at(-1)?.[0]).toEqual({ steamSettings: { duration: 55 } });
    await userEvent.clear(input);
    await userEvent.type(input, '57');
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(input).toHaveValue('52'));
    expect(updateWorkflow.mock.calls.at(-1)?.[0]).toEqual({ steamSettings: { duration: 52 } });
    // Tab goes from one setting's value to the next, never through the buttons.
    await userEvent.tab();
    expect(field('Steam flow')).toHaveFocus();
  });

  it('does not write when a nudge cannot change the clamped value', async () => {
    const { updateWorkflow } = renderDrink({ steamSettings: { targetTemperature: 150, duration: 50, flow: 0.1, stopAtTemperature: 0 } });
    await findField('Steam flow');
    await userEvent.click(button('Less steam flow')!);
    expect(field('Steam flow')).toHaveValue('0.1');
    expect(updateWorkflow).not.toHaveBeenCalled();
  });

  it("a stepper never moves a value the wrong way: More at Decaid's own top sends nothing, Less at steam time 0 sends nothing", async () => {
    const { updateWorkflow } = renderDrink({
      steamSettings: { targetTemperature: 150, duration: 0, flow: 2.5 },
      rinseData: { targetTemperature: 90, duration: 45, flow: 6 },
    });
    await findField('Steam flow');
    await userEvent.click(button('More steam flow')!);
    await userEvent.click(button('Less steam time')!);
    act(() => field('Steam time').focus());
    await userEvent.keyboard('{ArrowDown}');
    expect(field('Steam flow')).toHaveValue('2.5');
    expect(field('Steam time')).toHaveValue('0');
    expect(updateWorkflow).not.toHaveBeenCalled();
    // A flush of 45 s, as Decaid's own screen sets, goes up by a second.
    await userEvent.click(button('More flush time')!);
    await waitFor(() => expect(updateWorkflow).toHaveBeenCalledTimes(1));
    expect(updateWorkflow.mock.calls[0]?.[0]).toEqual({ rinseData: { duration: 46 } });
  });

  it("after a write, a field Decaid's reply did not give in a form CafAI reads shows a dash, not a default", async () => {
    const { services } = renderDrink();
    services.decaid.updateWorkflow = vi.fn(async (patch: WorkflowPatch) => ({
      ...SAMPLE_WORKFLOW,
      steamSettings: { ...SAMPLE_WORKFLOW.steamSettings, ...patch.steamSettings, flow: null },
    }));
    await findField('Steam time');
    await userEvent.click(button('More steam time')!);
    await waitFor(() => expect(field('Steam flow')).toHaveValue('—'));
    expect(field('Steam time')).toHaveValue('55');
  });

  it('typing an unparseable value reverts to what is on screen, without writing', async () => {
    const { updateWorkflow } = renderDrink();
    const input = await findField('Flush time');
    await userEvent.clear(input);
    await userEvent.type(input, 'abc');
    await userEvent.tab();
    expect(input).toHaveValue('10');
    expect(updateWorkflow).not.toHaveBeenCalled();
  });

  it("leaving a field untouched never clamps or re-sends it, even when the value is outside CafAI's range", async () => {
    // Set by another skin (or a Decaid default): 300 ml, above the 255 the DE1's byte can hold.
    const { updateWorkflow } = renderDrink({ hotWaterData: { targetTemperature: 75, duration: 30, volume: 300, flow: 10 } });
    const input = await findField('Hot water volume');
    expect(input).toHaveValue('300');
    await userEvent.click(input);
    await userEvent.tab();
    expect(input).toHaveValue('300');
    expect(updateWorkflow).not.toHaveBeenCalled();
  });

  it('a failed write says why under its field, as an alert, and puts the old value back; the next write clears it', async () => {
    const { updateWorkflow } = renderDrink();
    const input = await findField('Steam temperature');
    expect(input).toHaveValue('150');
    updateWorkflow.mockImplementationOnce(() => Promise.reject(new Error('Decaid is busy')));
    await userEvent.clear(input);
    await userEvent.type(input, '140');
    await userEvent.tab();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not save the steam temperature: Decaid is busy');
    expect(within(screen.getByRole('group', { name: 'Steam' })).getByRole('alert')).toBe(alert);
    expect(input).toHaveAttribute('aria-describedby', alert.id);
    expect(input).toHaveValue('150');
    await userEvent.click(button('More steam temperature')!);
    await waitFor(() => expect(input).toHaveValue('151'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a failed write puts back only its own field: a write of another field that landed meanwhile stays', async () => {
    const { services } = renderDrink();
    let failTime: (reason: Error) => void = () => {};
    let workflow: Workflow = SAMPLE_WORKFLOW;
    services.decaid.updateWorkflow = vi.fn((patch: WorkflowPatch) => {
      if (patch.steamSettings?.duration !== undefined) return new Promise<Workflow>((_resolve, reject) => (failTime = reject));
      workflow = mergeWorkflow(workflow, patch);
      return Promise.resolve(workflow);
    });
    await findField('Steam time');
    await userEvent.click(button('More steam time')!);
    await userEvent.click(button('More steam flow')!);
    await waitFor(() => expect(field('Steam flow')).toHaveValue('0.9'));
    await act(async () => failTime(new Error('Decaid is busy')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the steam time: Decaid is busy');
    expect(field('Steam time')).toHaveValue('50');
    expect(field('Steam flow')).toHaveValue('0.9');
  });

  it('a write still on its way after 0.4 s says "Saving…" under its field, until it lands', async () => {
    const { services } = renderDrink();
    let land: (workflow: Workflow) => void = () => {};
    services.decaid.updateWorkflow = vi.fn(
      (patch: WorkflowPatch) => new Promise<Workflow>((resolve) => (land = () => resolve(mergeWorkflow(SAMPLE_WORKFLOW, patch)))),
    );
    const input = await findField('Hot water volume');
    await userEvent.click(button('More hot water volume')!);
    expect(input).toHaveValue('60');
    expect(input).toHaveAttribute('aria-busy', 'true');
    // Not at once: a write that lands quickly never flashes the word.
    expect(screen.queryByText('Saving…')).toBeNull();
    const saving = await screen.findByText('Saving…', undefined, { timeout: 2000 });
    expect(within(screen.getByRole('group', { name: 'Hot water' })).getByText('Saving…')).toBe(saving);
    await act(async () => land(SAMPLE_WORKFLOW));
    await waitFor(() => expect(screen.queryByText('Saving…')).toBeNull());
    expect(input).toHaveValue('60');
    expect(input).not.toHaveAttribute('aria-busy');
  });
});

describe('DrinkSettingsSection while the machine runs', () => {
  for (const state of ['espresso', 'steam', 'hotWater', 'flush', 'steamRinse', 'skipStep', 'cleaning', 'descaling', 'airPurge'] as const) {
    it(`disables every field and says why while the machine is "${state}"`, async () => {
      const { services } = renderDrink();
      await findField('Steam temperature');
      expect(screen.queryByText('Not while the machine is running.')).toBeNull();

      act(() => services.telemetry.setState({ machine: { ...IDLE_TELEMETRY.machine!, state: { state, substate: 'idle' } } }));

      expect(screen.getByRole('status')).toHaveTextContent('Not while the machine is running.');
      expect(field('Steam temperature')).toBeDisabled();
      expect(button('Less steam temperature')).toBeDisabled();
      expect(button('More steam temperature')).toBeDisabled();
      expect(field('Flush flow')).toBeDisabled();
    });
  }

  it('leaves the fields enabled at rest, outside the running states', async () => {
    const { services } = renderDrink();
    await findField('Steam temperature');
    act(() => services.telemetry.setState({ machine: { ...IDLE_TELEMETRY.machine!, state: { state: 'heating', substate: 'idle' } } }));
    expect(screen.queryByText('Not while the machine is running.')).toBeNull();
    expect(field('Steam temperature')).toBeEnabled();
  });

  it('re-enables the fields once the machine goes back to idle', async () => {
    const { services } = renderDrink();
    await findField('Steam temperature');
    act(() => services.telemetry.setState({ machine: { ...IDLE_TELEMETRY.machine!, state: { state: 'steam', substate: 'idle' } } }));
    expect(field('Steam temperature')).toBeDisabled();
    act(() => services.telemetry.setState({ machine: { ...IDLE_TELEMETRY.machine!, state: { state: 'idle', substate: 'idle' } } }));
    expect(screen.queryByText('Not while the machine is running.')).toBeNull();
    expect(field('Steam temperature')).toBeEnabled();
  });

  it('a write already in flight is dropped if the machine starts running before it commits', async () => {
    const { services, updateWorkflow } = renderDrink();
    const input = await findField('Hot water volume');
    await userEvent.clear(input);
    await userEvent.type(input, '60');
    // The machine starts running in the instant between the tap and the blur commit running.
    act(() => services.telemetry.setState({ machine: { ...IDLE_TELEMETRY.machine!, state: { state: 'espresso', substate: 'idle' } } }));
    await userEvent.tab();
    expect(updateWorkflow).not.toHaveBeenCalled();
    // What was typed gives way to Decaid's own value, rather than stay on screen unsaved.
    expect(input).toHaveValue('50');
  });
});
