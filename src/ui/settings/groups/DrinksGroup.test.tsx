// @vitest-environment jsdom
import '../../chat/testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Workflow, WorkflowPatch } from '../../../api/types.ts';
import type { Services } from '../../../app/types.ts';
import { applySettingsPatch, normalizeSettings } from '../../../storage/settings.ts';
import type { DrinkScreensSettings } from '../../../storage/types.ts';
import { renderWithServices } from '../../chat/testing/render.tsx';
import type { DrinkKind } from '../../drinks/kinds.ts';
import { createFakeServices, IDLE_TELEMETRY, SAMPLE_WORKFLOW, type FakeServices } from '../../testing/fakeServices.ts';
import { TID } from '../../testIds.ts';
import { STAYS } from '../DrinkCard.tsx';
import { DRINKS_HELP, DrinksGroup } from './DrinksGroup.tsx';

/**
 * Settings > Drinks (D235): a card for each drink, what the machine runs it
 * with (Decaid's preset) and then "On screen" (CafAI's own), under one line
 * over the three cards.
 */

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
  renderWithServices(<DrinksGroup />, services);
  return { services, updateWorkflow };
}

const MODEL = 'claude-opus-5-5';

/**
 * The group over CafAI's own settings rules (src/storage/settings.ts), which
 * change one field of one drink's screen at a time, as the app saves them.
 */
function renderScreens(drinkScreens?: DrinkScreensSettings) {
  let stored = normalizeSettings({ model: MODEL, drinkScreens }, MODEL);
  const services = createFakeServices({ storage: { settings: stored } });
  services.storage.settings.get = async () => stored;
  services.storage.settings.update = async (patch) => (stored = applySettingsPatch(stored, patch, MODEL));
  renderWithServices(<DrinksGroup />, services);
  return { services, saved: () => stored.drinkScreens, user: userEvent.setup() };
}

/** The three cards in the machine row's order: each drink's kind, name, the row's icon and the machine's settings. */
const CARDS: readonly { kind: DrinkKind; name: string; icon: string; fields: readonly string[] }[] = [
  { kind: 'steam', name: 'Steam', icon: 'AirRoundedIcon', fields: ['Steam temperature', 'Steam time', 'Steam flow'] },
  {
    kind: 'hotWater',
    name: 'Hot water',
    icon: 'WaterDropRoundedIcon',
    fields: ['Hot water temperature', 'Hot water volume', 'Hot water time', 'Hot water flow'],
  },
  { kind: 'flush', name: 'Flush', icon: 'ShowerRoundedIcon', fields: ['Flush temperature', 'Flush time', 'Flush flow'] },
];
const KINDS = ['steam', 'hotWater', 'flush'] as const;
const NAMES = ['Steam', 'Hot water', 'Flush'];

/** A setting's value: a spin button named for its drink ("Steam time"). */
const field = (name: string) => screen.getByRole('spinbutton', { name });
/** The same, once Decaid's presets are in: the help line takes the place of "Reading…". */
async function findField(name: string): Promise<HTMLElement> {
  await screen.findByText(DRINKS_HELP);
  return field(name);
}
const button = (name: string) => screen.queryByRole('button', { name });
/** Decaid's presets are in: the line over the cards says what they are for. */
const presetsIn = () => screen.findByText(DRINKS_HELP);
/** A drink's card: a region named by its title. */
const card = (name: string) => within(screen.getByRole('region', { name }));
const animation = (kind: DrinkKind) => screen.getByTestId(TID.drinkScene(kind));
const goBack = (kind: DrinkKind) => screen.getByTestId(TID.drinkGoBackSwitch(kind));
/** After, the drinks' stepper named for its drink ("Steam go back after"); null while Go back by itself is off. */
const after = (drink: string) => screen.queryByRole('spinbutton', { name: `${drink} go back after` });
/** Each element comes after the one before it in the document. */
const inOrder = (elements: readonly Element[]) =>
  elements.slice(1).every((element, index) => (elements[index]!.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);

describe('DrinksGroup loading', () => {
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
    expect(screen.getByText(DRINKS_HELP)).toBeInTheDocument();
  });

  it('says what the cards are for in one line over the three of them, and in its place why the machine settings are held', async () => {
    const { services } = renderDrink();
    const help = await screen.findByText(DRINKS_HELP);
    const drinks = screen.getByTestId(TID.drinkSettings);
    const cards = screen.getByTestId(TID.drinkScreens);
    expect(screen.getAllByText(DRINKS_HELP)).toHaveLength(1);
    expect(drinks).toContainElement(help);
    expect(drinks).toContainElement(cards);
    for (const name of NAMES) expect(cards).toContainElement(screen.getByRole('region', { name }));
    // Over the cards, in none of them.
    expect(cards).not.toContainElement(help);
    expect(inOrder([help, cards])).toBe(true);
    act(() => services.telemetry.setState({ machineConnected: false }));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Connect the DE1 to change these.');
    expect(cards).not.toContainElement(status);
    expect(inOrder([status, cards])).toBe(true);
  });

  it('puts the settings in a card for each drink, as the machine row names them, each under its own heading with short labels', async () => {
    renderDrink();
    await findField('Steam temperature');
    const names = (drink: string) =>
      card(drink)
        .getAllByRole('spinbutton')
        .map((input) => input.getAttribute('aria-label'));
    // The drink's own settings, then On screen's After.
    expect(names('Steam')).toEqual(['Steam temperature', 'Steam time', 'Steam flow', 'Steam go back after']);
    expect(names('Hot water')).toEqual([
      'Hot water temperature',
      'Hot water volume',
      'Hot water time',
      'Hot water flow',
      'Hot water go back after',
    ]);
    expect(names('Flush')).toEqual(['Flush temperature', 'Flush time', 'Flush flow', 'Flush go back after']);
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['Steam', 'Hot water', 'Flush']);
    // The label shown says what, the heading says which drink; the label still names the field.
    expect(card('Steam').getByText('Temperature').closest('label')).toHaveAttribute('for', field('Steam temperature').id);
  });

  it('says the value with its unit: shown beside the number, and in words to a screen reader', async () => {
    renderDrink();
    const volume = await findField('Hot water volume');
    expect(volume).toHaveAttribute('aria-valuenow', '50');
    expect(volume).toHaveAttribute('aria-valuetext', '50 millilitres');
    // The field's range, so a screen reader can say where in it the value sits.
    expect(field('Steam temperature')).toHaveAttribute('aria-valuemin', '135');
    expect(field('Steam temperature')).toHaveAttribute('aria-valuemax', '160');
    expect(field('Steam temperature')).toHaveAttribute('aria-valuetext', '150 degrees Celsius');
    expect(field('Steam flow')).toHaveAttribute('aria-valuetext', '0.8 millilitres per second');
    const unit = card('Hot water').getByText('ml');
    expect(unit).toHaveAttribute('aria-hidden', 'true');
  });

  it("shows a message when Decaid's workflow cannot be read", async () => {
    const services = createFakeServices();
    services.decaid.getWorkflow = async () => {
      throw new Error('Decaid is offline');
    };
    renderWithServices(<DrinksGroup />, services);
    const message = await screen.findByText("Could not read Decaid's drink settings: Decaid is offline");
    expect(message).toBeInTheDocument();
    // Once, over the three cards.
    expect(screen.getByTestId(TID.drinkSettings)).toContainElement(message);
    expect(screen.getByTestId(TID.drinkScreens)).not.toContainElement(message);
  });

  it('shows a dash, never a made-up value, until Decaid answers, with nothing to step', async () => {
    const services = createFakeServices();
    let answer: (workflow: Workflow) => void = () => {};
    services.decaid.getWorkflow = () => new Promise<Workflow>((resolve) => (answer = resolve));
    renderWithServices(<DrinksGroup />, services);
    expect(screen.getByRole('status')).toHaveTextContent("Reading Decaid's drink settings…");
    expect(screen.queryByText(DRINKS_HELP)).toBeNull();
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
    expect(screen.getByText(DRINKS_HELP)).toBeInTheDocument();
  });

  it('after a read that failed, the fields stay dashes and Retry reads again', async () => {
    const services = createFakeServices();
    let fail = true;
    services.decaid.getWorkflow = async () => {
      if (fail) throw new Error('Decaid is offline');
      return SAMPLE_WORKFLOW;
    };
    renderWithServices(<DrinksGroup />, services);
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

describe('DrinksGroup without a machine', () => {
  it('shows the values, but disables every field and says why: Decaid refuses these writes without a DE1', async () => {
    const { services, updateWorkflow } = renderDrink();
    await findField('Steam temperature');
    act(() => services.telemetry.setState({ machineConnected: false }));
    expect(screen.getByRole('status')).toHaveTextContent('Connect the DE1 to change these.');
    expect(screen.queryByText(DRINKS_HELP)).toBeNull();
    expect(field('Steam time')).toHaveValue('50');
    expect(field('Steam time')).toBeDisabled();
    expect(button('More steam time')).toBeDisabled();
    expect(button('Less flush flow')).toBeDisabled();
    expect(updateWorkflow).not.toHaveBeenCalled();
    act(() => services.telemetry.setState({ machineConnected: true }));
    expect(screen.queryByText('Connect the DE1 to change these.')).toBeNull();
    expect(screen.getByText(DRINKS_HELP)).toBeInTheDocument();
    expect(button('More steam time')).toBeEnabled();
  });
});

describe('DrinksGroup steam temperature range (the DE1 vs. the Bengle)', () => {
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
    renderWithServices(<DrinksGroup />, services);
    const input = await findField('Steam temperature');
    await userEvent.clear(input);
    await userEvent.type(input, '999');
    await userEvent.tab();
    await waitFor(() => expect(updateWorkflow).toHaveBeenCalledTimes(1));
    expect(updateWorkflow.mock.calls[0]?.[0]).toEqual({ steamSettings: { targetTemperature: 160 } });
  });
});

describe('DrinksGroup steam off (D97, the spec allows 0)', () => {
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

describe('DrinksGroup edits', () => {
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
    expect(card('Steam').getByRole('alert')).toBe(alert);
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

  it('two quick taps: a slow first save that fails after the second landed puts nothing back', async () => {
    const { services } = renderDrink();
    let failFirst: (reason: Error) => void = () => {};
    let workflow: Workflow = SAMPLE_WORKFLOW;
    let sent = 0;
    services.decaid.updateWorkflow = vi.fn((patch: WorkflowPatch) => {
      sent += 1;
      if (sent === 1) return new Promise<Workflow>((_resolve, reject) => (failFirst = reject));
      workflow = mergeWorkflow(workflow, patch);
      return Promise.resolve(workflow);
    });
    const input = await findField('Steam time');
    await userEvent.click(button('More steam time')!);
    await userEvent.click(button('More steam time')!);
    // The second save landed (steps of 5 s): Decaid holds 60.
    await waitFor(() => expect(services.decaid.updateWorkflow).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(input).toHaveValue('60'));
    await act(async () => failFirst(new Error('Decaid is busy')));
    expect(input).toHaveValue('60');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('two quick taps that both fail put back the value Decaid held before the first', async () => {
    const { services } = renderDrink();
    const fails: Array<(reason: Error) => void> = [];
    services.decaid.updateWorkflow = vi.fn(() => new Promise<Workflow>((_resolve, reject) => fails.push(reject)));
    const input = await findField('Steam time');
    await userEvent.click(button('More steam time')!);
    await userEvent.click(button('More steam time')!);
    expect(input).toHaveValue('60');
    await act(async () => fails[1]!(new Error('Decaid is busy')));
    await act(async () => fails[0]!(new Error('Decaid is busy')));
    expect(input).toHaveValue('50');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save the steam time: Decaid is busy');
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
    expect(card('Hot water').getByText('Saving…')).toBe(saving);
    await act(async () => land(SAMPLE_WORKFLOW));
    await waitFor(() => expect(screen.queryByText('Saving…')).toBeNull());
    expect(input).toHaveValue('60');
    expect(input).not.toHaveAttribute('aria-busy');
  });
});

describe('DrinksGroup while the machine runs', () => {
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

  it('a typed value not yet sent is never sent if the machine starts running before the field is left', async () => {
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

describe('DrinksGroup On screen (D217, D222)', () => {
  it('has a card for each drink, its On screen on the default scene and going back after 10 s', async () => {
    renderScreens();
    expect(await presetsIn()).toBeInTheDocument();
    for (const name of NAMES) expect(screen.getByRole('region', { name })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['Steam', 'Hot water', 'Flush']);
    // Each card's own subheading, a level under its title.
    for (const name of NAMES) expect(card(name).getByRole('heading', { level: 3 })).toHaveTextContent('On screen');
    expect(animation('steam')).toHaveDisplayValue('Wand and spray');
    expect(animation('hotWater')).toHaveDisplayValue('Pour');
    expect(animation('flush')).toHaveDisplayValue('Shower');
    for (const kind of KINDS) expect(goBack(kind)).toBeChecked();
    for (const drink of NAMES) {
      expect(after(drink)).toHaveValue('10');
      expect(after(drink)).toHaveAttribute('aria-valuetext', '10 seconds');
      expect(after(drink)).toBeEnabled();
    }
    expect(screen.queryByText(STAYS)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('each card holds its machine settings first, then "On screen": Animation, Go back by itself and After', async () => {
    renderScreens();
    await presetsIn();
    for (const { kind, name, icon, fields } of CARDS) {
      const inCard = card(name);
      const order = [
        // The machine row's icon before the title.
        inCard.getByTestId(icon),
        inCard.getByRole('heading', { level: 2, name }),
        ...fields.map((label) => inCard.getByRole('spinbutton', { name: label })),
        inCard.getByRole('heading', { level: 3, name: 'On screen' }),
        inCard.getByTestId(TID.drinkScene(kind)),
        inCard.getByTestId(TID.drinkGoBackSwitch(kind)),
        inCard.getByRole('spinbutton', { name: `${name} go back after` }),
      ];
      expect(inOrder(order), name).toBe(true);
    }
  });

  it("offers each drink's scenes by name, the default first, and names every control for its drink", async () => {
    renderScreens();
    await presetsIn();
    const names = (kind: DrinkKind) => within(animation(kind)).getAllByRole('option').map((option) => option.textContent);
    expect(names('steam')).toEqual(['Wand and spray', 'Whirlpool', 'Rosetta', 'Simple']);
    expect(names('hotWater')).toEqual(['Pour', 'From above', 'Simple']);
    expect(names('flush')).toEqual(['Shower', 'Screen', 'Simple']);
    // The label shown says what, the heading says which drink; each control's name says both.
    const steam = card('Steam');
    expect(steam.getByRole('combobox', { name: 'Steam animation' })).toBe(animation('steam'));
    expect(steam.getByText('Animation').closest('label')).toHaveAttribute('for', animation('steam').id);
    expect(steam.getByRole('switch', { name: 'Go back by itself after Steam' })).toBe(goBack('steam'));
    expect(steam.getByText('After').closest('label')).toHaveAttribute('for', after('Steam')!.id);
    expect(card('Hot water').getByRole('switch', { name: 'Go back by itself after Hot water' })).toBe(goBack('hotWater'));
    expect(card('Flush').getByRole('combobox', { name: 'Flush animation' })).toBe(animation('flush'));
  });

  it('shows what was chosen on this device, and a scene this build does not know as the default', async () => {
    renderScreens({ steam: { scene: 'tornado' }, hotWater: { scene: 'above', goBackSeconds: 45 }, flush: { scene: 'simple', goBack: false } });
    await presetsIn();
    expect(animation('steam')).toHaveDisplayValue('Wand and spray');
    expect(animation('hotWater')).toHaveDisplayValue('From above');
    expect(after('Hot water')).toHaveValue('45');
    expect(animation('flush')).toHaveDisplayValue('Simple');
    expect(goBack('flush')).not.toBeChecked();
    expect(after('Flush')).toBeNull();
    expect(card('Flush').getByText(STAYS)).toBeInTheDocument();
  });

  it("a scene picked applies at once and is saved with CafAI's settings", async () => {
    const { services, saved, user } = renderScreens();
    await presetsIn();
    await user.selectOptions(animation('steam'), 'Whirlpool');
    expect(animation('steam')).toHaveValue('whirlpool');
    // The drink's view reads the store, so its next run draws it.
    expect(services.drinkScreens.get().steam.scene).toBe('whirlpool');
    await waitFor(() => expect(saved()).toEqual({ steam: { scene: 'whirlpool' } }));
  });

  it('Go back by itself off puts the line in place of After; on again brings After back with its time', async () => {
    const { services, saved, user } = renderScreens({ flush: { goBackSeconds: 25 } });
    await presetsIn();
    await user.click(goBack('flush'));
    expect(goBack('flush')).not.toBeChecked();
    expect(services.drinkScreens.get().flush.goBack).toBe(false);
    expect(after('Flush')).toBeNull();
    expect(card('Flush').getByText(STAYS)).toBeInTheDocument();
    await waitFor(() => expect(saved()).toEqual({ flush: { goBack: false, goBackSeconds: 25 } }));
    // A tap on its label toggles it too.
    await user.click(card('Flush').getByText('Go back by itself'));
    expect(goBack('flush')).toBeChecked();
    expect(after('Flush')).toHaveValue('25');
    expect(screen.queryByText(STAYS)).toBeNull();
    await waitFor(() => expect(saved()).toEqual({ flush: { goBack: true, goBackSeconds: 25 } }));
    expect(goBack('steam')).toBeChecked();
  });

  it('After moves 5 s a tap within 5 to 60 s and takes any whole second typed', async () => {
    const { saved, user } = renderScreens({ flush: { goBackSeconds: 5 } });
    await presetsIn();
    await user.click(screen.getByRole('button', { name: 'More steam go back after' }));
    expect(after('Steam')).toHaveValue('15');
    await waitFor(() => expect(saved()?.steam).toEqual({ goBackSeconds: 15 }));

    const hotWater = after('Hot water')!;
    await user.clear(hotWater);
    await user.type(hotWater, '22');
    await user.tab();
    await waitFor(() => expect(saved()?.hotWater).toEqual({ goBackSeconds: 22 }));
    await user.clear(hotWater);
    await user.type(hotWater, '90');
    await user.tab();
    expect(hotWater).toHaveValue('60');
    await waitFor(() => expect(saved()?.hotWater).toEqual({ goBackSeconds: 60 }));

    // At the floor Less sends nothing.
    await user.click(screen.getByRole('button', { name: 'Less flush go back after' }));
    expect(after('Flush')).toHaveValue('5');
    expect(saved()?.flush).toEqual({ goBackSeconds: 5 });
  });

  it("stays live while the machine's settings are held: without a machine, and while it runs", async () => {
    const { services, saved, user } = renderScreens();
    await presetsIn();
    const live = () => {
      for (const kind of KINDS) {
        expect(animation(kind)).toBeEnabled();
        expect(goBack(kind)).toBeEnabled();
      }
      for (const drink of NAMES) {
        expect(after(drink)).toBeEnabled();
        expect(button(`More ${drink.toLowerCase()} go back after`)).toBeEnabled();
      }
    };
    act(() => services.telemetry.setState({ machineConnected: false }));
    expect(screen.getByRole('status')).toHaveTextContent('Connect the DE1 to change these.');
    expect(field('Steam time')).toBeDisabled();
    live();
    act(() => services.telemetry.setState({ machineConnected: true, machine: { ...IDLE_TELEMETRY.machine!, state: { state: 'steam', substate: 'idle' } } }));
    expect(screen.getByRole('status')).toHaveTextContent('Not while the machine is running.');
    expect(field('Steam time')).toBeDisabled();
    live();
    // A change made now shows and saves as ever.
    await user.click(goBack('steam'));
    expect(goBack('steam')).not.toBeChecked();
    await waitFor(() => expect(saved()).toEqual({ steam: { goBack: false } }));
  });

  it("a failed save says why in its drink's card and keeps the change on screen; the drink's next change that saves takes it along and clears it", async () => {
    const { services, saved, user } = renderScreens();
    await presetsIn();
    const update = services.storage.settings.update;
    services.storage.settings.update = async () => {
      throw new Error('Storage is full.');
    };
    await user.selectOptions(animation('steam'), 'Rosetta');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not save the drink screens: Storage is full.');
    expect(screen.getByTestId(TID.drinkScreensError)).toBe(alert);
    expect(card('Steam').getByRole('alert')).toBe(alert);
    expect(animation('steam')).toHaveValue('rosetta');
    expect(services.drinkScreens.get().steam.scene).toBe('rosetta');

    services.storage.settings.update = update;
    // Another drink's save clears nothing: Steam's change is still unsaved.
    await user.click(goBack('hotWater'));
    await waitFor(() => expect(saved()).toEqual({ hotWater: { goBack: false } }));
    expect(card('Steam').getByRole('alert')).toBe(alert);
    await user.click(goBack('steam'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(saved()).toEqual({ hotWater: { goBack: false }, steam: { scene: 'rosetta', goBack: false } });
  });

  it("a failed save stays in its own drink's card, one card each, until a change of that drink saves", async () => {
    const { services, saved, user } = renderScreens();
    await presetsIn();
    const update = services.storage.settings.update;
    services.storage.settings.update = async () => {
      throw new Error('Storage is full.');
    };
    await user.click(goBack('flush'));
    const alert = await card('Flush').findByTestId(TID.drinkScreensError);
    expect(alert).toHaveTextContent('Could not save the drink screens: Storage is full.');
    expect(card('Steam').queryByRole('alert')).toBeNull();
    expect(card('Hot water').queryByRole('alert')).toBeNull();
    // Hot water's save fails next: each card says its own.
    await user.selectOptions(animation('hotWater'), 'From above');
    await waitFor(() => expect(card('Hot water').getByTestId(TID.drinkScreensError)).toBeInTheDocument());
    expect(card('Flush').getByTestId(TID.drinkScreensError)).toBe(alert);
    // Steam's change saves and clears neither; the changes that failed stay on screen.
    services.storage.settings.update = update;
    await user.click(screen.getByRole('button', { name: 'More steam go back after' }));
    await waitFor(() => expect(saved()?.steam).toBeDefined());
    expect(screen.getAllByTestId(TID.drinkScreensError)).toHaveLength(2);
    expect(goBack('flush')).not.toBeChecked();
    expect(animation('hotWater')).toHaveValue('above');
    // Hot water's next change takes its failed one along: only its card clears.
    await user.click(goBack('hotWater'));
    await waitFor(() => expect(card('Hot water').queryByTestId(TID.drinkScreensError)).toBeNull());
    expect(saved()?.hotWater).toEqual({ scene: 'above', goBack: false });
    expect(card('Flush').getByTestId(TID.drinkScreensError)).toBe(alert);
  });

  it('without the store, as in a preview, each card keeps its machine settings and has no On screen', async () => {
    const services = createFakeServices();
    delete (services as Services).drinkScreens;
    renderWithServices(<DrinksGroup />, services);
    // The line says nothing of a screen the cards do not have.
    await screen.findByText('Changes go to Decaid at once.');
    expect(screen.queryByText(DRINKS_HELP)).toBeNull();
    for (const { kind, name, fields } of CARDS) {
      const inCard = card(name);
      expect(inCard.getAllByRole('spinbutton').map((input) => input.getAttribute('aria-label'))).toEqual(fields);
      expect(inCard.queryByRole('heading', { name: 'On screen' })).toBeNull();
      expect(screen.queryByTestId(TID.drinkScene(kind))).toBeNull();
      expect(screen.queryByTestId(TID.drinkGoBackSwitch(kind))).toBeNull();
    }
    expect(field('Steam temperature')).toHaveValue('150');
    expect(screen.queryByText(STAYS)).toBeNull();
  });
});
