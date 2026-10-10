// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
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

describe('DrinkSettingsSection loading', () => {
  it("loads steam, hot water and flush settings from Decaid's workflow", async () => {
    renderDrink();
    expect(await screen.findByLabelText('Steam temperature (°C)')).toHaveValue('150');
    expect(screen.getByLabelText('Steam time (s)')).toHaveValue('50');
    expect(screen.getByLabelText('Steam flow (ml/s)')).toHaveValue('0.8');
    expect(screen.getByLabelText('Hot water temperature (°C)')).toHaveValue('75');
    expect(screen.getByLabelText('Hot water volume (ml)')).toHaveValue('50');
    expect(screen.getByLabelText('Hot water time (s)')).toHaveValue('30');
    expect(screen.getByLabelText('Hot water flow (ml/s)')).toHaveValue('10');
    expect(screen.getByLabelText('Flush time (s)')).toHaveValue('10');
    expect(screen.getByLabelText('Flush temperature (°C)')).toHaveValue('90');
    expect(screen.getByLabelText('Flush flow (ml/s)')).toHaveValue('6');
  });

  it("shows a message when Decaid's workflow cannot be read", async () => {
    const services = createFakeServices();
    services.decaid.getWorkflow = async () => {
      throw new Error('Decaid is offline');
    };
    renderWithServices(<DrinkSettingsSection />, services);
    expect(await screen.findByText("Could not read Decaid's drink settings: Decaid is offline")).toBeInTheDocument();
  });
});

describe('DrinkSettingsSection steam temperature range (the DE1 vs. the Bengle)', () => {
  it("clamps to the DE1's 135-160 range when the model is a DE1 (or not yet known)", async () => {
    const { updateWorkflow } = renderDrink({}, 'DE1Pro');
    const field = await screen.findByLabelText('Steam temperature (°C)');
    await userEvent.clear(field);
    await userEvent.type(field, '999');
    await userEvent.tab();
    await waitFor(() => expect(updateWorkflow).toHaveBeenCalledTimes(1));
    expect(updateWorkflow.mock.calls[0]?.[0]).toEqual({ steamSettings: { targetTemperature: 160 } });
    expect(field).toHaveValue('160');
  });

  it("clamps to the Bengle's wider 135-165 range only once the machine answers Bengle", async () => {
    const { updateWorkflow } = renderDrink({}, 'Bengle');
    const field = await screen.findByLabelText('Steam temperature (°C)');
    await userEvent.clear(field);
    await userEvent.type(field, '999');
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
    const field = await screen.findByLabelText('Steam temperature (°C)');
    await userEvent.clear(field);
    await userEvent.type(field, '999');
    await userEvent.tab();
    await waitFor(() => expect(updateWorkflow).toHaveBeenCalledTimes(1));
    expect(updateWorkflow.mock.calls[0]?.[0]).toEqual({ steamSettings: { targetTemperature: 160 } });
  });
});

describe('DrinkSettingsSection steam off (D97, the spec allows 0)', () => {
  const steamOff = { steamSettings: { targetTemperature: 0, duration: 50, flow: 0.8, stopAtTemperature: 0 } };

  it('shows steam temperature 0 as Off, read-only, with a note, and offers no stepper for it', async () => {
    renderDrink(steamOff);
    // The steppers and the read-only "Off" field swap places in the tree (the row's first
    // child changes type), so the field must be re-queried fresh rather than reused from an
    // earlier (loading-placeholder) render.
    await waitFor(() => expect(screen.getByLabelText('Steam temperature (°C)')).toHaveValue('Off'));
    expect(screen.getByLabelText('Steam temperature (°C)')).toBeDisabled();
    expect(screen.getByText('Steam is off in Decaid')).toBeInTheDocument();
    expect(screen.queryByLabelText('Less steam temperature')).toBeNull();
    expect(screen.queryByLabelText('More steam temperature')).toBeNull();
  });

  it('never writes a value for steam temperature while it is off', async () => {
    const { updateWorkflow } = renderDrink(steamOff);
    await screen.findByLabelText('Steam temperature (°C)');
    // Steam time still has its ordinary stepper; using it must never touch steamSettings.targetTemperature.
    const more = screen.getByLabelText('More steam time');
    await userEvent.click(more);
    await waitFor(() => expect(updateWorkflow).toHaveBeenCalledTimes(1));
    expect(updateWorkflow.mock.calls[0]?.[0]).toEqual({ steamSettings: { duration: 55 } });
  });
});

describe('DrinkSettingsSection edits', () => {
  it('writes only the changed object, clamped to its range', async () => {
    const { updateWorkflow } = renderDrink();
    const field = await screen.findByLabelText('Hot water volume (ml)');
    await userEvent.clear(field);
    await userEvent.type(field, '999');
    await userEvent.tab();
    await waitFor(() => expect(updateWorkflow).toHaveBeenCalledTimes(1));
    expect(updateWorkflow.mock.calls[0]?.[0]).toEqual({ hotWaterData: { volume: 255 } });
    expect(field).toHaveValue('255');
  });

  it('rounds an integer field typed with a decimal', async () => {
    const { updateWorkflow } = renderDrink();
    const field = await screen.findByLabelText('Hot water volume (ml)');
    await userEvent.clear(field);
    await userEvent.type(field, '75.6');
    await userEvent.tab();
    await waitFor(() => expect(updateWorkflow).toHaveBeenCalledTimes(1));
    expect(updateWorkflow.mock.calls[0]?.[0]).toEqual({ hotWaterData: { volume: 76 } });
    expect(field).toHaveValue('76');
  });

  it('nudges a field by its step with the +/- buttons', async () => {
    renderDrink();
    const more = await screen.findByLabelText('More steam flow');
    const less = screen.getByLabelText('Less steam flow');
    const field = screen.getByLabelText('Steam flow (ml/s)');
    expect(field).toHaveValue('0.8');
    await userEvent.click(more);
    await waitFor(() => expect(field).toHaveValue('0.9'));
    await userEvent.click(less);
    await userEvent.click(less);
    await waitFor(() => expect(field).toHaveValue('0.7'));
  });

  it('does not write when a nudge cannot change the clamped value', async () => {
    const { updateWorkflow } = renderDrink({ steamSettings: { targetTemperature: 150, duration: 50, flow: 0.1, stopAtTemperature: 0 } });
    const less = await screen.findByLabelText('Less steam flow');
    await userEvent.click(less);
    expect(screen.getByLabelText('Steam flow (ml/s)')).toHaveValue('0.1');
    expect(updateWorkflow).not.toHaveBeenCalled();
  });

  it('typing an unparseable value reverts to what is on screen, without writing', async () => {
    const { updateWorkflow } = renderDrink();
    const field = await screen.findByLabelText('Flush time (s)');
    await userEvent.clear(field);
    await userEvent.type(field, 'abc');
    await userEvent.tab();
    expect(field).toHaveValue('10');
    expect(updateWorkflow).not.toHaveBeenCalled();
  });

  it('leaving a field untouched never clamps or re-sends it, even when the value is outside CafAI\'s range', async () => {
    // Set by another skin (or a Decaid default): 300 ml, above the 255 the DE1's byte can hold.
    const { updateWorkflow } = renderDrink({ hotWaterData: { targetTemperature: 75, duration: 30, volume: 300, flow: 10 } });
    const field = await screen.findByLabelText('Hot water volume (ml)');
    expect(field).toHaveValue('300');
    await userEvent.click(field);
    await userEvent.tab();
    expect(field).toHaveValue('300');
    expect(updateWorkflow).not.toHaveBeenCalled();
  });

  it('a failed write shows its sentence and reverts the field', async () => {
    const { updateWorkflow } = renderDrink();
    const field = await screen.findByLabelText('Steam temperature (°C)');
    expect(field).toHaveValue('150');
    updateWorkflow.mockImplementationOnce(() => Promise.reject(new Error('Decaid is busy')));
    await userEvent.clear(field);
    await userEvent.type(field, '140');
    await userEvent.tab();
    expect(await screen.findByText('Could not save the steam temperature: Decaid is busy')).toBeInTheDocument();
    expect(field).toHaveValue('150');
  });
});

describe('DrinkSettingsSection while the machine runs', () => {
  for (const state of ['espresso', 'steam', 'hotWater', 'flush', 'steamRinse', 'skipStep', 'cleaning', 'descaling', 'airPurge'] as const) {
    it(`disables every field and says why while the machine is "${state}"`, async () => {
      const { services } = renderDrink();
      await screen.findByLabelText('Steam temperature (°C)');
      expect(screen.queryByText('Not while the machine is running')).toBeNull();

      act(() => services.telemetry.setState({ machine: { ...IDLE_TELEMETRY.machine!, state: { state, substate: 'idle' } } }));

      expect(screen.getByText('Not while the machine is running')).toBeInTheDocument();
      expect(screen.getByLabelText('Steam temperature (°C)')).toBeDisabled();
      expect(screen.getByLabelText('Less steam temperature')).toBeDisabled();
      expect(screen.getByLabelText('More steam temperature')).toBeDisabled();
      expect(screen.getByLabelText('Flush flow (ml/s)')).toBeDisabled();
    });
  }

  it('leaves the fields enabled at rest, outside the running states', async () => {
    const { services } = renderDrink();
    await screen.findByLabelText('Steam temperature (°C)');
    act(() => services.telemetry.setState({ machine: { ...IDLE_TELEMETRY.machine!, state: { state: 'heating', substate: 'idle' } } }));
    expect(screen.queryByText('Not while the machine is running')).toBeNull();
    expect(screen.getByLabelText('Steam temperature (°C)')).toBeEnabled();
  });

  it('re-enables the fields once the machine goes back to idle', async () => {
    const { services } = renderDrink();
    await screen.findByLabelText('Steam temperature (°C)');
    act(() => services.telemetry.setState({ machine: { ...IDLE_TELEMETRY.machine!, state: { state: 'steam', substate: 'idle' } } }));
    expect(screen.getByLabelText('Steam temperature (°C)')).toBeDisabled();
    act(() => services.telemetry.setState({ machine: { ...IDLE_TELEMETRY.machine!, state: { state: 'idle', substate: 'idle' } } }));
    expect(screen.queryByText('Not while the machine is running')).toBeNull();
    expect(screen.getByLabelText('Steam temperature (°C)')).toBeEnabled();
  });

  it('a write already in flight is dropped if the machine starts running before it commits', async () => {
    const { services, updateWorkflow } = renderDrink();
    const field = await screen.findByLabelText('Hot water volume (ml)');
    await userEvent.clear(field);
    await userEvent.type(field, '60');
    // The machine starts running in the instant between the tap and the blur commit running.
    act(() => services.telemetry.setState({ machine: { ...IDLE_TELEMETRY.machine!, state: { state: 'espresso', substate: 'idle' } } }));
    await userEvent.tab();
    expect(updateWorkflow).not.toHaveBeenCalled();
  });
});
