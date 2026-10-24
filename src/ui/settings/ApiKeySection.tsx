/**
 * Settings > Coach > Anthropic API key: the key the coach calls Anthropic
 * with, shown only while the coach runs on Anthropic (D140). The key goes
 * straight to the secret store and is never shown again; the UI only ever
 * knows whether one is saved. Under it, the switch that keeps a copy in
 * Decaid (D99), off by default, which save and Forget follow.
 */
import { useEffect, useState, type FormEvent } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { useCoach, useServices } from '../../app/services.tsx';
import { SECRET_FIELD } from '../../usage/mask.ts';
import { TID } from '../testIds.ts';
import { useApiKeyView } from './coachSourceView.ts';
import { Section } from './Section.tsx';

// The test id goes on the switch's checkbox input, the one element a test (or a keyboard) can focus and drive.
declare module '@mui/material/Switch' {
  interface SwitchInputSlotPropsOverrides {
    'data-testid'?: string;
  }
}

type Message = { tone: 'success' | 'error'; text: string };

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

const fieldSx = { '& .MuiInputBase-root': { minHeight: 48 } } as const;

/** Backup-in-Decaid state while the choice is still being read, or while it is in flight. */
type KeepState = boolean | 'loading';

/** Saved while the choice is on, but the copy did not reach Decaid: src/storage/keyBackup.ts sends it when Decaid is back. */
const KEY_SAVED_COPY_LATER = "Key saved on this device. Decaid can't be reached right now, so CafAI will copy it there as soon as it can.";
/** Forgotten while the choice is on, but Decaid was out of reach: its copy is deleted when Decaid is back, and never restored meanwhile. */
const KEY_GONE_DELETE_LATER = "The key is gone from this device. Decaid can't be reached right now, so CafAI will delete its copy there as soon as it can.";

export function ApiKeySection() {
  const { storage, coach, usage } = useServices();
  const hasApiKeyInEngine = useCoach((s) => s.hasApiKey);
  // Shown only while the coach runs on Anthropic (D140); the key store still says while the engine catches up
  // with a choice just switched back (on the computer its "has a key" is the bridge's code, coachSourceView.ts).
  const { keySaved } = useApiKeyView(hasApiKeyInEngine);
  // What this screen just did wins until the engine has re-read the store.
  const [savedHere, setSavedHere] = useState<boolean | null>(null);
  const hasKey = savedHere ?? keySaved;
  const [draft, setDraft] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  // The choice to keep a copy in Decaid (Settings.keepKeyInDecaid), read once; KeyInDecaidSwitch
  // both shows and changes it, so save() and forget() know whether to copy or delete there too.
  const [keepInDecaid, setKeepInDecaid] = useState<KeepState>('loading');

  useEffect(() => {
    let live = true;
    storage.settings
      .get()
      .then((settings) => {
        if (live) setKeepInDecaid(settings.keepKeyInDecaid ?? false);
      })
      .catch(() => {
        if (live) setKeepInDecaid(false);
      });
    return () => {
      live = false;
    };
  }, [storage]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const key = draft.trim();
    if (!key || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      // While the choice is on the copy in Decaid follows; one Decaid does not take now goes when it is back.
      const copied = await storage.keyBackup.saveKey(key, keepInDecaid === true);
      setDraft('');
      setVisible(false);
      setSavedHere(true);
      setMessage({ tone: 'success', text: copied ? 'Key saved on this device.' : KEY_SAVED_COPY_LATER });
      await coach.refresh();
      usage?.track('coach_setup');
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
      // Gone for good: a copy Decaid still holds never brings it back. While the choice is on that copy is
      // deleted, now or once Decaid is back, and the choice stays on for the next key saved here.
      const deleted = await storage.keyBackup.forgetKey(keepInDecaid === true);
      setSavedHere(false);
      setMessage({ tone: 'success', text: deleted ? 'The key is gone from this device.' : KEY_GONE_DELETE_LATER });
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
          {hasKey ? 'A key is saved on this device.' : 'No key saved yet. The coach needs one to work.'}
        </Typography>
      </Stack>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
        The key stays on this device unless you keep a copy in Decaid (below). It is never included in exports.
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
              // Out of Clarity entirely, shown or hidden: the key leaves only for Anthropic (D214).
              ...SECRET_FIELD,
              autoComplete: 'off',
              autoCapitalize: 'off',
              autoCorrect: 'off',
              spellCheck: false,
            },
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton aria-label={visible ? 'Hide key' : 'Show key'} onClick={() => setVisible((v) => !v)} edge="end">
                    {visible ? <VisibilityOffIcon /> : <VisibilityIcon />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />
        <Button type="submit" variant="contained" data-testid={TID.apiKeySave} disabled={busy || draft.trim() === ''} sx={{ minHeight: 48, px: 3 }}>
          Save key
        </Button>
        {hasKey ? (
          <Button color="error" variant="tonal" data-testid={TID.forgetKey} disabled={busy} onClick={() => setConfirmForget(true)} sx={{ minHeight: 48 }}>
            Forget key
          </Button>
        ) : null}
      </Box>
      {message ? (
        <Alert severity={message.tone} sx={{ mt: 1.5 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      ) : null}
      <KeyInDecaidSwitch hasKey={hasKey} keepInDecaid={keepInDecaid} onChange={setKeepInDecaid} />
      <Dialog open={confirmForget} onClose={() => setConfirmForget(false)}>
        <DialogTitle>Forget the API key?</DialogTitle>
        <DialogContent>
          <DialogContentText>The coach stops working on this device until you add a key again.</DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmForget(false)} sx={{ minHeight: 48 }}>
            Keep it
          </Button>
          <Button color="error" variant="contained" data-testid={TID.forgetKeyConfirm} onClick={() => void forget()} sx={{ minHeight: 48 }}>
            Forget key
          </Button>
        </DialogActions>
      </Dialog>
    </Section>
  );
}

/** Spec 5.6: why the key's copy in Decaid is worth having, and what it costs. */
const KEY_IN_DECAID_SENTENCE =
  "So you do not have to paste it again after a Decaid update. Any device on your network can read Decaid's store, and Decaid's backups include it.";

/** MUI's switch is 38 px tall: the label around it, which toggles it too, is the 48 px touch target. */
const switchLabelSx = { minHeight: 48 } as const;

/**
 * The key's switch, D99: off by default. The checked state is
 * Settings.keepKeyInDecaid (lifted into ApiKeySection, which also needs it
 * to decide whether save() and forget() touch Decaid), never whether a
 * copy happens to exist there right now. Off with no key, there is nothing
 * to back up, so it waits for one; on, it can always be turned off, key or
 * not (Forget may have left a copy that Decaid has not deleted yet). A
 * toggle that cannot reach Decaid reverts and says so, so the switch never
 * claims a state that is not real.
 */
function KeyInDecaidSwitch({ hasKey, keepInDecaid, onChange }: { hasKey: boolean; keepInDecaid: KeepState; onChange(next: boolean): void }) {
  const { storage } = useServices();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsKey = !hasKey && keepInDecaid !== true;

  const toggle = async (checked: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await storage.keyBackup.setOn(checked);
      await storage.settings.update({ keepKeyInDecaid: checked });
      onChange(checked);
    } catch (caught) {
      setError(`Could not reach Decaid: ${errorText(caught)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ mt: 1.5 }}>
      <FormControlLabel
        control={
          <Switch
            checked={keepInDecaid === true}
            disabled={keepInDecaid === 'loading' || busy || needsKey}
            onChange={(event) => void toggle(event.target.checked)}
            slotProps={{ input: { 'data-testid': TID.keyInDecaid } }}
          />
        }
        label="Keep my API key in Decaid"
        sx={switchLabelSx}
      />
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {needsKey ? 'Add a key above before turning this on.' : KEY_IN_DECAID_SENTENCE}
      </Typography>
      {error ? (
        <Typography variant="body2" sx={{ color: 'error.main' }}>
          {error}
        </Typography>
      ) : null}
    </Box>
  );
}
