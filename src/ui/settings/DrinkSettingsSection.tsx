/**
 * Settings > Steam, hot water and flush (6.6): the three drink presets
 * Decaid keeps on the workflow. Each field reads GET /api/v1/workflow once
 * and writes its own object with PUT /api/v1/workflow (never the profile),
 * clamped by drinkSettings.ts. Disabled while a shot, steam, hot water or
 * flush is running, since Decaid is already using these values then.
 *
 * A blur or a stepper tap only ever writes a value the user actually
 * chose: leaving a field untouched never clamps or re-sends whatever
 * Decaid already had, even when that value sits outside CafAI's own
 * range (another skin's, or steam off). Steam temperature 0 means off;
 * CafAI shows that read-only rather than clamp it up to "on".
 */
import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import type { HotWaterData, RinseData, SteamSettings } from '../../api/types.ts';
import { useServices, useTelemetry } from '../../app/services.tsx';
import { TID } from '../testIds.ts';
import { blocksDrinkSettings, clampDrinkField, HOT_WATER_FIELDS, RINSE_FIELDS, steamFields, type DrinkFieldSpec } from './drinkSettings.ts';
import { Section } from './Section.tsx';

const NOT_WHILE_RUNNING = 'Not while the machine is running';

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

const fieldSx = { '& .MuiInputBase-root': { minHeight: 48 } } as const;
const mutedSx = { color: 'text.secondary' } as const;

/** A number field with a step, clamped into its field's range. Read-only when the value is the field's "off" sentinel. */
function SteppedField({
  spec,
  value,
  disabled,
  onCommit,
}: {
  spec: DrinkFieldSpec;
  value: number;
  disabled: boolean;
  onCommit(value: number): void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  if (spec.offValue !== undefined && value === spec.offValue) {
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
        {spec.offNote ? (
          <Typography variant="body2" sx={mutedSx}>
            {spec.offNote}
          </Typography>
        ) : null}
      </Box>
    );
  }

  const commit = (raw: string) => {
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
    const next = clampDrinkField(spec, value + direction * spec.step);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <IconButton
        aria-label={`Less ${spec.label.toLowerCase()}`}
        onClick={() => nudge(-1)}
        disabled={disabled}
        sx={{ minWidth: 48, minHeight: 48 }}
      >
        <RemoveIcon fontSize="small" />
      </IconButton>
      <TextField
        size="small"
        label={`${spec.label} (${spec.unit})`}
        value={draft}
        disabled={disabled}
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
        disabled={disabled}
        sx={{ minWidth: 48, minHeight: 48 }}
      >
        <AddIcon fontSize="small" />
      </IconButton>
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
  data: Record<string, number> | null;
  disabled: boolean;
  onCommit(spec: DrinkFieldSpec, value: number): void;
}) {
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
      {fields.map((spec) => (
        <SteppedField
          key={spec.key}
          spec={spec}
          value={data ? data[spec.key] ?? spec.range.min : spec.range.min}
          disabled={disabled || data === null}
          onCommit={(value) => onCommit(spec, value)}
        />
      ))}
    </Box>
  );
}

export function DrinkSettingsSection() {
  const { decaid } = useServices();
  const runningState = useTelemetry((state) => state.machine?.state.state ?? null);
  const blocked = blocksDrinkSettings(runningState);

  const [model, setModel] = useState<string | null>(null);
  const [steam, setSteam] = useState<SteamSettings | null>(null);
  const [hotWater, setHotWater] = useState<HotWaterData | null>(null);
  const [rinse, setRinse] = useState<RinseData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
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
  }, [decaid]);

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
  const disabled = blocked || !loaded;

  const commitSteam = async (spec: DrinkFieldSpec, value: number) => {
    // Re-checked here, not just at render: the machine may have started between the tap and this call.
    if (!steam || blocksDrinkSettings(runningState)) return;
    const key = spec.key as keyof SteamSettings;
    if (steam[key] === value) return;
    const previous = steam;
    setSteam({ ...steam, [key]: value });
    setError(null);
    try {
      // Every field of SteamSettings is a number, so this single key is always a valid partial.
      const patch = { [key]: value } as Partial<SteamSettings>;
      const updated = await decaid.updateWorkflow({ steamSettings: patch });
      setSteam(updated.steamSettings);
    } catch (caught) {
      setSteam(previous);
      setError(`Could not save the ${spec.label.toLowerCase()}: ${errorText(caught)}`);
    }
  };

  const commitHotWater = async (spec: DrinkFieldSpec, value: number) => {
    if (!hotWater || blocksDrinkSettings(runningState)) return;
    const key = spec.key as keyof HotWaterData;
    if (hotWater[key] === value) return;
    const previous = hotWater;
    setHotWater({ ...hotWater, [key]: value });
    setError(null);
    try {
      // Every field of HotWaterData is a number, so this single key is always a valid partial.
      const patch = { [key]: value } as Partial<HotWaterData>;
      const updated = await decaid.updateWorkflow({ hotWaterData: patch });
      setHotWater(updated.hotWaterData);
    } catch (caught) {
      setHotWater(previous);
      setError(`Could not save the ${spec.label.toLowerCase()}: ${errorText(caught)}`);
    }
  };

  const commitRinse = async (spec: DrinkFieldSpec, value: number) => {
    if (!rinse || blocksDrinkSettings(runningState)) return;
    const key = spec.key as keyof RinseData;
    if (rinse[key] === value) return;
    const previous = rinse;
    setRinse({ ...rinse, [key]: value });
    setError(null);
    try {
      // Every field of RinseData is a number, so this single key is always a valid partial.
      const patch = { [key]: value } as Partial<RinseData>;
      const updated = await decaid.updateWorkflow({ rinseData: patch });
      setRinse(updated.rinseData);
    } catch (caught) {
      setRinse(previous);
      setError(`Could not save the ${spec.label.toLowerCase()}: ${errorText(caught)}`);
    }
  };

  return (
    <Section title="Steam, hot water and flush">
      <Stack spacing={2} data-testid={TID.drinkSettings}>
        {blocked ? (
          <Typography variant="body2" sx={mutedSx}>
            {NOT_WHILE_RUNNING}
          </Typography>
        ) : null}
        {loadError ? <Alert severity="error">{loadError}</Alert> : null}
        {/* FieldRow only reads by key for display; every field of these three wire types is a number. */}
        <FieldRow fields={steamFields(model)} data={steam as Record<string, number> | null} disabled={disabled} onCommit={commitSteam} />
        <FieldRow fields={HOT_WATER_FIELDS} data={hotWater as Record<string, number> | null} disabled={disabled} onCommit={commitHotWater} />
        <FieldRow fields={RINSE_FIELDS} data={rinse as Record<string, number> | null} disabled={disabled} onCommit={commitRinse} />
        {error ? (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
      </Stack>
    </Section>
  );
}
