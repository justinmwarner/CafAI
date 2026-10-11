/**
 * Settings > Steam, hot water and flush (6.6): the three drink presets
 * Decaid keeps on the workflow. Each field reads GET /api/v1/workflow and
 * writes its own object with PUT /api/v1/workflow (never the profile),
 * clamped by drinkSettings.ts. Disabled while a shot, steam, hot water or
 * flush is running, since Decaid is already using these values then, and
 * while no machine is connected, since Decaid refuses these writes without
 * one (it puts them on the DE1 at once).
 *
 * Only Decaid's own values are shown: until Decaid answers, after a read
 * that failed (with Retry), and for a field Decaid sent that CafAI could not
 * read, the field is a dash, never a made-up value. A blur or a stepper tap
 * only ever writes a value the user actually chose: leaving a field
 * untouched never clamps or re-sends whatever Decaid already had, even when
 * that value sits outside CafAI's own range (another skin's), and a stepper
 * at the end of the range sends nothing. Steam below 135 °C is off in
 * Decaid; CafAI shows that read-only rather than clamp it up to "on".
 */
import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import type { HotWaterData, RinseData, SteamSettings, WorkflowPatch } from '../../api/types.ts';
import { useServices, useTelemetry } from '../../app/services.tsx';
import { DASH } from '../machine/format.ts';
import { TID } from '../testIds.ts';
import {
  blocksDrinkSettings,
  clampDrinkField,
  HOT_WATER_FIELDS,
  isDrinkOff,
  nudgeDrinkField,
  RINSE_FIELDS,
  steamFields,
  type DrinkFieldSpec,
} from './drinkSettings.ts';
import { Section } from './Section.tsx';

const NOT_WHILE_RUNNING = 'Not while the machine is running';
const NOT_CONNECTED = 'Connect the DE1 to change these.';
const READING = "Reading Decaid's drink settings…";
const UNREADABLE = "CafAI could not read Decaid's value";

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

const fieldSx = { '& .MuiInputBase-root': { minHeight: 48 } } as const;
const mutedSx = { color: 'text.secondary' } as const;

/** A field's value in one of the three presets: a number, or null when it is not known. */
function fieldValue(data: object | null, key: string): number | null {
  if (data === null) return null;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function Note({ text }: { text: string | null }) {
  return text ? (
    <Typography variant="body2" sx={mutedSx}>
      {text}
    </Typography>
  ) : null;
}

/**
 * A number field with a step, clamped into its field's range. A dash, with
 * everything disabled, while its value is not known (`loaded` false: not
 * read yet; true: Decaid sent something CafAI could not read, which a note
 * says); read-only "Off" when the value means the drink is off.
 */
function SteppedField({
  spec,
  value,
  loaded,
  disabled,
  onCommit,
}: {
  spec: DrinkFieldSpec;
  value: number | null;
  loaded: boolean;
  disabled: boolean;
  onCommit(value: number): void;
}) {
  const [draft, setDraft] = useState(value === null ? DASH : String(value));
  useEffect(() => setDraft(value === null ? DASH : String(value)), [value]);

  if (value !== null && isDrinkOff(spec, value)) {
    return (
      <Box>
        <TextField
          size="small"
          label={`${spec.label} (${spec.unit})`}
          value="Off"
          disabled
          sx={fieldSx}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Note text={spec.offNote ?? null} />
      </Box>
    );
  }

  const unknown = value === null;
  const commit = (raw: string) => {
    if (value === null) return;
    const trimmed = raw.trim();
    // Nothing typed: never clamp or re-send a value nobody touched, even one outside this field's range.
    if (trimmed === String(value)) {
      setDraft(String(value));
      return;
    }
    const parsed = trimmed === '' ? Number.NaN : Number(trimmed);
    const next = clampDrinkField(spec, Number.isFinite(parsed) ? parsed : value);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  const nudge = (direction: 1 | -1) => {
    const next = value === null ? null : nudgeDrinkField(spec, value, direction);
    if (next === null) return;
    setDraft(String(next));
    onCommit(next);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <IconButton
          aria-label={`Less ${spec.label.toLowerCase()}`}
          onClick={() => nudge(-1)}
          disabled={disabled || unknown}
          sx={{ minWidth: 48, minHeight: 48 }}
        >
          <RemoveIcon fontSize="small" />
        </IconButton>
        <TextField
          size="small"
          label={`${spec.label} (${spec.unit})`}
          value={draft}
          disabled={disabled || unknown}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          sx={{ ...fieldSx, minWidth: 0 }}
          slotProps={{
            htmlInput: { inputMode: spec.integer ? 'numeric' : 'decimal' },
            inputLabel: { shrink: true },
          }}
        />
        <IconButton
          aria-label={`More ${spec.label.toLowerCase()}`}
          onClick={() => nudge(1)}
          disabled={disabled || unknown}
          sx={{ minWidth: 48, minHeight: 48 }}
        >
          <AddIcon fontSize="small" />
        </IconButton>
      </Box>
      <Note text={unknown && loaded ? UNREADABLE : null} />
    </Box>
  );
}

/** At most two fields per row (as GrinderFields.tsx), one on a phone: three or four steppers never share one row. */
function FieldRow({
  fields,
  data,
  disabled,
  onCommit,
}: {
  fields: readonly DrinkFieldSpec[];
  data: object | null;
  disabled: boolean;
  onCommit(spec: DrinkFieldSpec, value: number): void;
}) {
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
      {fields.map((spec) => (
        <SteppedField
          key={spec.key}
          spec={spec}
          value={fieldValue(data, spec.key)}
          loaded={data !== null}
          disabled={disabled}
          onCommit={(value) => onCommit(spec, value)}
        />
      ))}
    </Box>
  );
}

export function DrinkSettingsSection() {
  const { decaid } = useServices();
  const connected = useTelemetry((state) => state.machineConnected);
  const runningState = useTelemetry((state) => state.machine?.state.state ?? null);
  const blocked = blocksDrinkSettings(runningState);

  const [model, setModel] = useState<string | null>(null);
  const [steam, setSteam] = useState<SteamSettings | null>(null);
  const [hotWater, setHotWater] = useState<HotWaterData | null>(null);
  const [rinse, setRinse] = useState<RinseData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Bumped by Retry: reads the workflow again. */
  const [reads, setReads] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoadError(null);
    decaid
      .getWorkflow()
      .then((workflow) => {
        if (!live) return;
        setSteam(workflow.steamSettings);
        setHotWater(workflow.hotWaterData);
        setRinse(workflow.rinseData);
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

  const loaded = steam !== null && hotWater !== null && rinse !== null;
  const disabled = blocked || !connected || !loaded;
  /** Re-checked at the write, not just at render: the machine may have started, or gone, between the tap and the call. */
  const writable = () => connected && !blocksDrinkSettings(runningState);

  const commitSteam = async (spec: DrinkFieldSpec, value: number) => {
    if (!steam || !writable()) return;
    if (steam[spec.key] === value) return;
    const previous = steam;
    setSteam({ ...steam, [spec.key]: value });
    setError(null);
    try {
      const patch = { [spec.key]: value } as NonNullable<WorkflowPatch['steamSettings']>;
      const updated = await decaid.updateWorkflow({ steamSettings: patch });
      setSteam(updated.steamSettings);
    } catch (caught) {
      setSteam(previous);
      setError(`Could not save the ${spec.label.toLowerCase()}: ${errorText(caught)}`);
    }
  };

  const commitHotWater = async (spec: DrinkFieldSpec, value: number) => {
    if (!hotWater || !writable()) return;
    const key = spec.key as keyof HotWaterData;
    if (hotWater[key] === value) return;
    const previous = hotWater;
    setHotWater({ ...hotWater, [key]: value });
    setError(null);
    try {
      const patch = { [key]: value } as NonNullable<WorkflowPatch['hotWaterData']>;
      const updated = await decaid.updateWorkflow({ hotWaterData: patch });
      setHotWater(updated.hotWaterData);
    } catch (caught) {
      setHotWater(previous);
      setError(`Could not save the ${spec.label.toLowerCase()}: ${errorText(caught)}`);
    }
  };

  const commitRinse = async (spec: DrinkFieldSpec, value: number) => {
    if (!rinse || !writable()) return;
    const key = spec.key as keyof RinseData;
    if (rinse[key] === value) return;
    const previous = rinse;
    setRinse({ ...rinse, [key]: value });
    setError(null);
    try {
      const patch = { [key]: value } as NonNullable<WorkflowPatch['rinseData']>;
      const updated = await decaid.updateWorkflow({ rinseData: patch });
      setRinse(updated.rinseData);
    } catch (caught) {
      setRinse(previous);
      setError(`Could not save the ${spec.label.toLowerCase()}: ${errorText(caught)}`);
    }
  };

  // One reason at a time: without a machine, what it runs says nothing.
  const reason = !connected ? NOT_CONNECTED : blocked ? NOT_WHILE_RUNNING : !loaded && loadError === null ? READING : null;

  return (
    <Section title="Steam, hot water and flush">
      <Stack spacing={2} data-testid={TID.drinkSettings}>
        {reason ? (
          <Typography variant="body2" sx={mutedSx}>
            {reason}
          </Typography>
        ) : null}
        {loadError ? (
          <Alert
            severity="error"
            sx={{ alignItems: 'center', '& .MuiAlert-action': { pt: 0, alignItems: 'center' } }}
            action={
              <Button color="inherit" onClick={() => setReads((count) => count + 1)} sx={{ minHeight: 48 }}>
                Retry
              </Button>
            }
          >
            {loadError}
          </Alert>
        ) : null}
        <FieldRow fields={steamFields(model)} data={steam} disabled={disabled} onCommit={commitSteam} />
        <FieldRow fields={HOT_WATER_FIELDS} data={hotWater} disabled={disabled} onCommit={commitHotWater} />
        <FieldRow fields={RINSE_FIELDS} data={rinse} disabled={disabled} onCommit={commitRinse} />
        {error ? (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
      </Stack>
    </Section>
  );
}
