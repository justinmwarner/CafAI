/**
 * The settings route (#/settings): the Anthropic API key, the model, and the
 * grinder. The key goes straight to the secret store and is never shown
 * again; the UI only ever knows whether one is saved.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import type { ModelInfo } from '../../llm/types.ts';
import { useCoach, useServices } from '../../app/services.tsx';
import { TID } from '../testIds.ts';

type Message = { tone: 'success' | 'error'; text: string };

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function price(model: ModelInfo): string {
  return `$${model.inputPerMTok} in / $${model.outputPerMTok} out per million tokens`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" component="section" aria-label={title} sx={{ p: 2, bgcolor: 'background.paper' }}>
      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, mb: 1 }}>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

const fieldSx = { '& .MuiInputBase-root': { minHeight: 48 } } as const;

function ApiKeySection() {
  const { storage, coach } = useServices();
  const hasApiKeyInEngine = useCoach((s) => s.hasApiKey);
  // What this screen just did wins until the engine has re-read the store.
  const [savedHere, setSavedHere] = useState<boolean | null>(null);
  const hasKey = savedHere ?? hasApiKeyInEngine;
  const [draft, setDraft] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const key = draft.trim();
    if (!key || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await storage.secrets.setApiKey(key);
      setDraft('');
      setVisible(false);
      setSavedHere(true);
      setMessage({ tone: 'success', text: 'Key saved on this tablet.' });
      await coach.refresh();
    } catch (error) {
      setMessage({ tone: 'error', text: `Could not save the key: ${errorText(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    setConfirmForget(false);
    setBusy(true);
    setMessage(null);
    try {
      await storage.secrets.forgetApiKey();
      setSavedHere(false);
      setMessage({ tone: 'success', text: 'The key is gone from this tablet.' });
      await coach.refresh();
    } catch (error) {
      setMessage({ tone: 'error', text: `Could not forget the key: ${errorText(error)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Anthropic API key">
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
        {hasKey ? <CheckCircleIcon color="success" fontSize="small" /> : null}
        <Typography variant="body1" sx={{ fontWeight: 600 }} role="status">
          {hasKey ? 'A key is saved on this tablet.' : 'No key saved yet. The coach needs one to work.'}
        </Typography>
      </Stack>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
        The key stays on this tablet. It is never sent to Decaid or included in exports.
      </Typography>
      <Box component="form" onSubmit={(event) => void save(event)} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <TextField
          label={hasKey ? 'Replace the key' : 'API key'}
          placeholder="sk-ant-…"
          type={visible ? 'text' : 'password'}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={busy}
          size="small"
          sx={{ ...fieldSx, flex: '1 1 260px' }}
          slotProps={{
            inputLabel: { shrink: true },
            htmlInput: {
              'data-testid': TID.apiKeyInput,
              autoComplete: 'off',
              autoCapitalize: 'off',
              autoCorrect: 'off',
              spellCheck: false,
            },
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={visible ? 'Hide key' : 'Show key'}
                    onClick={() => setVisible((v) => !v)}
                    edge="end"
                  >
                    {visible ? <VisibilityOffIcon /> : <VisibilityIcon />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />
        <Button
          type="submit"
          variant="contained"
          data-testid={TID.apiKeySave}
          disabled={busy || draft.trim() === ''}
          sx={{ minHeight: 48, px: 3 }}
        >
          Save key
        </Button>
        {hasKey ? (
          <Button
            color="error"
            variant="outlined"
            data-testid={TID.forgetKey}
            disabled={busy}
            onClick={() => setConfirmForget(true)}
            sx={{ minHeight: 48 }}
          >
            Forget key
          </Button>
        ) : null}
      </Box>
      {message ? (
        <Alert severity={message.tone} sx={{ mt: 1.5 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      ) : null}
      <Dialog open={confirmForget} onClose={() => setConfirmForget(false)}>
        <DialogTitle>Forget the API key?</DialogTitle>
        <DialogContent>
          <DialogContentText>The coach stops working on this tablet until you add a key again.</DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmForget(false)} sx={{ minHeight: 48 }}>
            Keep it
          </Button>
          <Button color="error" variant="contained" onClick={() => void forget()} sx={{ minHeight: 48 }}>
            Forget key
          </Button>
        </DialogActions>
      </Dialog>
    </Section>
  );
}

interface Form {
  model: string;
  grinderName: string;
  grinderSetting: string;
}

function CoachSettingsSection() {
  const { storage, coach, models } = useServices();
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  useEffect(() => {
    let live = true;
    storage.settings
      .get()
      .then((settings) => {
        if (live) {
          setForm({
            model: settings.model,
            grinderName: settings.grinderName ?? '',
            grinderSetting: settings.grinderSetting ?? '',
          });
        }
      })
      .catch((error: unknown) => {
        if (live) setMessage({ tone: 'error', text: `Could not read the settings: ${errorText(error)}` });
      });
    return () => {
      live = false;
    };
  }, [storage]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      await storage.settings.update({
        model: form.model,
        grinderName: form.grinderName.trim() || null,
        grinderSetting: form.grinderSetting.trim() || null,
      });
      setMessage({ tone: 'success', text: 'Settings saved.' });
      await coach.refresh();
    } catch (error) {
      setMessage({ tone: 'error', text: `Could not save the settings: ${errorText(error)}` });
    } finally {
      setSaving(false);
    }
  };

  const update = (patch: Partial<Form>) => setForm((current) => (current ? { ...current, ...patch } : current));
  const selected = models.find((m) => m.id === form?.model);
  const disabled = form === null || saving;

  return (
    <Section title="Coach">
      <Box component="form" onSubmit={(event) => void save(event)} sx={{ display: 'grid', gap: 2 }}>
        <TextField
          select
          size="small"
          label="Model"
          value={form?.model ?? ''}
          disabled={disabled}
          onChange={(event) => update({ model: event.target.value })}
          helperText={selected ? `${selected.note} ${price(selected)}.` : ' '}
          sx={fieldSx}
          slotProps={{
            select: { native: true },
            htmlInput: { 'data-testid': TID.modelSelect },
            inputLabel: { shrink: true },
          }}
        >
          {form && !selected ? <option value={form.model}>{form.model} (no longer offered)</option> : null}
          {form === null ? <option value="">Loading…</option> : null}
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} · ${model.inputPerMTok} / ${model.outputPerMTok} per MTok
            </option>
          ))}
        </TextField>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '3fr 2fr' } }}>
          <TextField
            size="small"
            label="Grinder"
            placeholder="e.g. Niche Zero"
            value={form?.grinderName ?? ''}
            disabled={disabled}
            onChange={(event) => update({ grinderName: event.target.value })}
            sx={fieldSx}
            slotProps={{ htmlInput: { 'data-testid': TID.grinderName, maxLength: 60 }, inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            label="Current grinder setting"
            placeholder="e.g. 14"
            value={form?.grinderSetting ?? ''}
            disabled={disabled}
            onChange={(event) => update({ grinderSetting: event.target.value })}
            sx={fieldSx}
            slotProps={{ htmlInput: { 'data-testid': TID.grinderSetting, maxLength: 20 }, inputLabel: { shrink: true } }}
          />
        </Box>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: -1 }}>
          The coach uses your grinder and its dial setting to say how far to turn it.
        </Typography>
        <Box>
          <Button type="submit" variant="contained" data-testid={TID.settingsSave} disabled={disabled} sx={{ minHeight: 48, px: 3 }}>
            Save settings
          </Button>
        </Box>
      </Box>
      {message ? (
        <Alert severity={message.tone} sx={{ mt: 1.5 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      ) : null}
    </Section>
  );
}

function AboutSection() {
  const { appVersion, host, decaid } = useServices();
  const [decaidVersion, setDecaidVersion] = useState<string | null>(host.hostVersion);
  useEffect(() => {
    if (host.hostVersion) return;
    let live = true;
    decaid
      .getInfo()
      .then((info) => {
        if (live) setDecaidVersion(info.fullVersion || info.version);
      })
      .catch(() => {
        if (live) setDecaidVersion(null);
      });
    return () => {
      live = false;
    };
  }, [decaid, host.hostVersion]);
  return (
    <Section title="About">
      <Typography variant="body2">CafAI {appVersion}</Typography>
      <Typography variant="body2" sx={{ color: decaidVersion ? 'text.primary' : 'text.secondary' }}>
        {decaidVersion ? `Decaid ${decaidVersion}` : 'Decaid version unknown (not connected)'}
      </Typography>
    </Section>
  );
}

export function SettingsScreen() {
  return (
    <Box sx={{ height: '100%', minHeight: 0, overflowY: 'auto' }}>
      <Stack spacing={2} sx={{ p: 2, maxWidth: 760 }}>
        <Typography variant="h6" component="h1">
          Settings
        </Typography>
        <ApiKeySection />
        <CoachSettingsSection />
        <AboutSection />
      </Stack>
    </Box>
  );
}
