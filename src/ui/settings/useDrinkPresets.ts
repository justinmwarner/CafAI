/**
 * Decaid's drink presets (the workflow's steamSettings, hotWaterData and
 * rinseData) for one screen: read once on mount (and by Retry) with
 * GET /api/v1/workflow, written one field at a time with
 * PUT /api/v1/workflow, never while the machine runs or no machine is
 * connected (D114: the machine is using them then; Decaid refuses them
 * without a DE1, as it puts them on the machine at once). Settings > Drinks
 * and each drink's view use it. A write carries only
 * the field that changed, never the profile.
 *
 * A blur, a stepper tap or an arrow key only ever writes a value the user
 * actually chose: leaving a field untouched never clamps or re-sends
 * whatever Decaid already had, even when that value sits outside CafAI's own
 * range (another skin's), and a stepper at the end of the range sends
 * nothing. A write still on its way after 0.4 s says "Saving…" under its
 * field (Decaid's queue can hold one for 30 s), and one that fails says why
 * there, with the old value back.
 */
import { useEffect, useRef, useState } from 'react';
import type { WorkflowPatch } from '../../api/types.ts';
import { useServices, useTelemetry } from '../../app/services.tsx';
import { fieldId, withField, type Drink, type Presets } from './DrinkFields.tsx';
import { blocksDrinkSettings, type DrinkFieldSpec } from './drinkSettings.ts';
import { keepDrinkPresets } from './statusReads.ts';

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/** Why every field is held now, or null when they can be changed. */
export type DrinkSettingsReason = 'notConnected' | 'running' | 'reading' | null;

export interface DrinkPresetsState {
  /** The machine's model, which decides steam temperature's ceiling (DE1 160, Bengle 165); null until known. */
  model: string | null;
  /** Decaid's three presets as last read or written; null until Decaid answers. */
  presets: Presets | null;
  loaded: boolean;
  /** Why reading the presets failed, until a Retry reads them. */
  loadError: string | null;
  retry(): void;
  /** Writes still on their way and why a field's last write failed, by fieldId. */
  pending: Readonly<Record<string, number>>;
  failed: Readonly<Record<string, string>>;
  /** Every field held: no machine, the machine running (D114), or the presets not in yet. */
  disabled: boolean;
  /** One reason at a time: without a machine, what it runs says nothing. */
  reason: DrinkSettingsReason;
  /** Sends a value the barista chose, unless the machine has started, or gone, since the tap. */
  commit(drink: Drink, spec: DrinkFieldSpec, value: number): void;
}

export function useDrinkPresets(): DrinkPresetsState {
  const { decaid } = useServices();
  const connected = useTelemetry((state) => state.machineConnected);
  const runningState = useTelemetry((state) => state.machine?.state.state ?? null);
  const blocked = blocksDrinkSettings(runningState);

  const [model, setModel] = useState<string | null>(null);
  const [presets, setPresets] = useState<Presets | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Bumped by Retry: reads the workflow again. */
  const [reads, setReads] = useState(0);
  /** Writes still on their way to Decaid, and why a field's last write failed, by fieldId. */
  const [pending, setPending] = useState<Readonly<Record<string, number>>>({});
  const [failed, setFailed] = useState<Readonly<Record<string, string>>>({});
  /**
   * By fieldId: the number of the field's newest save, its saves on their way,
   * and its value as Decaid last held it, which a failed newest save goes back to.
   */
  const saves = useRef<Record<string, { newest: number; inFlight: number; settled: unknown }>>({});

  useEffect(() => {
    let live = true;
    setLoadError(null);
    decaid
      .getWorkflow()
      .then((workflow) => {
        if (!live) return;
        setPresets({ steamSettings: workflow.steamSettings, hotWaterData: workflow.hotWaterData, rinseData: workflow.rinseData });
      })
      .catch((caught: unknown) => {
        if (live) setLoadError(`Could not read Decaid's drink settings: ${errorText(caught)}`);
      });
    return () => {
      live = false;
    };
  }, [decaid, reads]);

  useEffect(() => {
    let live = true;
    // Steam's enabled range depends on the machine (DE1 160, Bengle 165); fails safe to the
    // narrower DE1 range (steamTemperatureField's own default) while this is unknown.
    decaid
      .getMachineInfo()
      .then((info) => {
        if (live) setModel(info.model);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [decaid]);

  // Settings' list says the drinks as this screen last read or wrote them (statusReads.ts, D236).
  useEffect(() => {
    if (presets) keepDrinkPresets(decaid, presets);
  }, [decaid, presets]);

  const loaded = presets !== null;
  const disabled = blocked || !connected || !loaded;
  /** Re-checked at the write, not just at render: the machine may have started, or gone, between the tap and the call. */
  const writable = () => connected && !blocksDrinkSettings(runningState);

  const write = async (current: Presets, drink: Drink, spec: DrinkFieldSpec, value: number) => {
    const previous = (current[drink.key] as Record<string, unknown>)[spec.key];
    if (previous === value) return;
    const id = fieldId(drink.key, spec.key);
    const save = (saves.current[id] ??= { newest: 0, inFlight: 0, settled: previous });
    // With none on its way, the value before this tap is the one Decaid holds.
    if (save.inFlight === 0) save.settled = previous;
    const number = ++save.newest;
    save.inFlight += 1;
    setPresets((now) => now && withField(now, drink.key, spec.key, value));
    setFailed(({ [id]: _cleared, ...rest }) => rest);
    setPending((now) => ({ ...now, [id]: (now[id] ?? 0) + 1 }));
    try {
      const patch = { [drink.key]: { [spec.key]: value } } as WorkflowPatch;
      const updated = await decaid.updateWorkflow(patch);
      save.settled = value;
      // Decaid's word on the whole drink, so a field its reply does not give in a readable form shows a dash.
      setPresets((now) => now && ({ ...now, [drink.key]: updated[drink.key] } as Presets));
    } catch (caught) {
      // A newer save of this field was sent: its own answer decides what the field shows.
      if (number === save.newest) {
        // Only this field goes back, to what Decaid last held: a write of another field that landed meanwhile stays.
        setPresets((now) => now && withField(now, drink.key, spec.key, save.settled));
        setFailed((now) => ({ ...now, [id]: `Could not save the ${spec.label.toLowerCase()}: ${errorText(caught)}` }));
      }
    } finally {
      save.inFlight -= 1;
      setPending(({ [id]: count = 0, ...rest }) => (count > 1 ? { ...rest, [id]: count - 1 } : rest));
    }
  };
  const commit = (drink: Drink, spec: DrinkFieldSpec, value: number) => {
    if (presets && writable()) void write(presets, drink, spec, value);
  };

  // One reason at a time: without a machine, what it runs says nothing.
  const reason = !connected ? 'notConnected' : blocked ? 'running' : !loaded && loadError === null ? 'reading' : null;

  return {
    model,
    presets,
    loaded,
    loadError,
    retry: () => setReads((count) => count + 1),
    pending,
    failed,
    disabled,
    reason,
    commit,
  };
}
