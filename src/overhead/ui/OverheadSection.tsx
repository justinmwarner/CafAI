/**
 * Settings › Display › Overhead: the Overhead plugin's settings, read from and
 * saved to the plugin itself (`/api/v1/plugins/overhead.reaplugin/config`),
 * since Decaid's own settings route would need a management token a skin
 * does not hold (docs/overhead/DECISIONS.md, O3). The form is the plugin's
 * settings table (src/overhead/shared/settings.ts), so its labels and help are
 * the ones Decaid's Plugins screen shows. Saved with Save; an empty field
 * goes back to its default. Preview shows Overhead now, anywhere.
 *
 * Without the plugin it says how to install it and nothing else.
 */
import { useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { useServices } from '../../app/services.tsx';
import { Section } from '../../ui/settings/Section.tsx';
import { TID } from '../../ui/testIds.ts';
import { readSettings, SETTING_SPECS, settingsValues, validValues } from '../shared/settings.ts';
import { NO_OVERHEAD, type OverheadClient } from './client.ts';
import { overheadPreview, type OverheadPreviewStore } from './preview.ts';

type Draft = Record<string, string | boolean>;

/** The form's text for a value: '' for none. */
function draftOf(values: Record<string, unknown>): Draft {
  const draft: Draft = {};
  for (const spec of SETTING_SPECS) {
    const value = values[spec.key];
    draft[spec.key] = spec.kind === 'boolean' ? value === true : value === null || value === undefined ? '' : String(value);
  }
  return draft;
}

export const INSTALL_HELP =
  "Overhead needs its Decaid plugin, overhead.reaplugin. Install it once in Decaid: Settings › Plugins › Install plugin › ZIP file, with the overhead.reaplugin zip from CafAI's release. CafAI then finds it by itself.";

export interface OverheadSectionProps {
  client?: OverheadClient;
  preview?: OverheadPreviewStore;
}

export function OverheadSection({ client, preview = overheadPreview }: OverheadSectionProps) {
  const { overhead: servicesClient } = useServices();
  const overhead = client ?? servicesClient ?? NO_OVERHEAD;
  const [saved, setSaved] = useState<Record<string, unknown> | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    overhead.config().then(
      (values) => {
        if (cancelled) return;
        setSaved(values);
        setDraft(draftOf(values));
        setMissing(null);
      },
      (reason: unknown) => {
        if (!cancelled) setMissing(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [overhead]);

  const changed = useMemo(() => {
    if (saved === null || draft === null) return {};
    const before = draftOf(saved);
    const out: Record<string, unknown> = {};
    for (const spec of SETTING_SPECS) {
      if (draft[spec.key] === before[spec.key]) continue;
      const value = draft[spec.key];
      out[spec.key] = value === '' ? null : value;
    }
    return out;
  }, [saved, draft]);
  const invalid = Object.entries(changed)
    .filter(([key, value]) => value !== null && !(key in validValues({ [key]: value })))
    .map(([key]) => SETTING_SPECS.find((spec) => spec.key === key)?.label ?? key);

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const values = await overhead.saveConfig(changed);
      setSaved(values);
      setDraft(draftOf(values));
      const settings = readSettings(values);
      setNotice(settings.homeLat === null ? 'Saved. Overhead still needs your home.' : 'Saved.');
    } catch (reason) {
      setError(`Could not save Overhead's settings: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="Overhead">
      <Stack spacing={1.5} data-testid={TID.overheadSection}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          The aircraft passing over your home, on a map and a departure board, when CafAI is idle. Free sources, no keys; your home stays in Decaid on this tablet.
        </Typography>
        {missing !== null ? (
          <Alert severity="info" data-testid={TID.overheadSectionStatus}>
            {INSTALL_HELP}
          </Alert>
        ) : draft === null ? (
          <Typography variant="body2" data-testid={TID.overheadSectionStatus}>
            Asking the Overhead plugin…
          </Typography>
        ) : (
          <>
            {SETTING_SPECS.map((spec) =>
              spec.kind === 'boolean' ? (
                <Box key={spec.key}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={draft[spec.key] === true}
                        onChange={(event) => setDraft({ ...draft, [spec.key]: event.target.checked })}
                        slotProps={{ input: { 'data-testid': TID.overheadField(spec.key) } }}
                      />
                    }
                    label={spec.label}
                    sx={{ minHeight: 48, mr: 0 }}
                  />
                </Box>
              ) : (
                <TextField
                  key={spec.key}
                  size="small"
                  label={spec.label}
                  value={draft[spec.key] as string}
                  placeholder={spec.fallback === null ? '' : String(spec.fallback)}
                  helperText={spec.description}
                  onChange={(event) => setDraft({ ...draft, [spec.key]: event.target.value })}
                  slotProps={{
                    htmlInput: { 'data-testid': TID.overheadField(spec.key), inputMode: spec.kind === 'number' ? 'decimal' : 'text' },
                    inputLabel: { shrink: true },
                  }}
                  sx={{ '& .MuiInputBase-root': { minHeight: 48 } }}
                />
              ),
            )}
            {invalid.length > 0 ? <Alert severity="warning">{`Not a value Overhead can use: ${invalid.join(', ')}.`}</Alert> : null}
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={() => void save()} disabled={saving || Object.keys(changed).length === 0 || invalid.length > 0} data-testid={TID.overheadSave} sx={{ minHeight: 48 }}>
                Save
              </Button>
              <Button variant="tonal" startIcon={<PlayArrowRoundedIcon />} onClick={() => preview.show({ mock: false })} data-testid={TID.overheadPreview} sx={{ minHeight: 48 }}>
                Preview
              </Button>
            </Stack>
          </>
        )}
        {notice ? <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert> : null}
        {error ? (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
      </Stack>
    </Section>
  );
}

/** The settings in effect with defaults filled in, as the form shows them (for tests). */
export const shownValues = (values: Record<string, unknown>) => draftOf(settingsValues(readSettings(values)));
