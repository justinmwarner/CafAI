/**
 * The settings route (#/settings): how CafAI looks (AppearanceSection.tsx),
 * the Anthropic API key, the model, and the grinder. The key goes straight
 * to the secret store and is never shown again; the UI only ever knows
 * whether one is saved. The grinder can be linked to Decaid's grinder
 * library, whose step size the coach then uses (GrinderFields.tsx), and a
 * grinder the library lacks can be added to it (AddGrinder.tsx). A key
 * pasted into another field never becomes a setting: storage takes it out
 * (src/storage/settings.ts) and the screen says so.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type RefObject } from 'react';
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
import { addOrFindGrinder, listGrinders } from '../../api/grinders.ts';
import { PLUGIN } from '../../api/plugins.ts';
import type { ModelInfo } from '../../llm/types.ts';
import { useCoach, useServices } from '../../app/services.tsx';
import { containsKeyLike } from '../../storage/redact.ts';
import type { Settings } from '../../storage/types.ts';
import { TID } from '../testIds.ts';
import { AboutDecaid } from './AboutDecaid.tsx';
import { AddGrinder, type AddedGrinder } from './AddGrinder.tsx';
import { addedNote, dye2GrindersUrl } from './addGrinder.ts';
import { AppearanceSection } from './AppearanceSection.tsx';
import { CoachSourceSection } from './CoachSourceSection.tsx';
import { useApiKeyView, useCoachRunsOnComputer } from './coachSourceView.ts';
import { DrinkSettingsSection } from './DrinkSettingsSection.tsx';
import { GrinderFields } from './GrinderFields.tsx';
import {
  canAddGrinder,
  grinderPatch,
  libraryAfterError,
  NOT_LISTED,
  withGrinder,
  type GrinderForm,
  type GrinderLibrary,
} from './grinderPicker.ts';
import { revealInColumn } from './reveal.ts';
import { Section } from './Section.tsx';

// The test id goes on the switch's checkbox input, the one element a test (or a keyboard) can focus and drive.
declare module '@mui/material/Switch' {
  interface SwitchInputSlotPropsOverrides {
    'data-testid'?: string;
  }
}

type Message = { tone: 'success' | 'error'; text: string };

/** Said when saving took a pasted API key out of a field, as the chat says it (D37). */
export const KEY_TAKEN_OUT = 'That looked like an API key, so CafAI took it out. Keys go in the API key field above.';

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function price(model: ModelInfo): string {
  return `$${model.inputPerMTok} in / $${model.outputPerMTok} out per million tokens`;
}

const fieldSx = { '& .MuiInputBase-root': { minHeight: 48 } } as const;
/** A native select opens only from the select element itself, so it is the 48 px target. */
const selectSx = { ...fieldSx, '& .MuiNativeSelect-select': { py: '12.5px' } } as const;

/** Backup-in-Decaid state while the choice is still being read, or while it is in flight. */
type KeepState = boolean | 'loading';

/** Saved while the choice is on, but the copy did not reach Decaid: src/storage/keyBackup.ts sends it when Decaid is back. */
const KEY_SAVED_COPY_LATER = "Key saved on this device. Decaid can't be reached right now, so CafAI will copy it there as soon as it can.";
/** Forgotten while the choice is on, but Decaid was out of reach: its copy is deleted when Decaid is back, and never restored meanwhile. */
const KEY_GONE_DELETE_LATER = "The key is gone from this device. Decaid can't be reached right now, so CafAI will delete its copy there as soon as it can.";

function ApiKeySection() {
  const { storage, coach } = useServices();
  const hasApiKeyInEngine = useCoach((s) => s.hasApiKey);
  // On the computer the engine's "has a key" is the bridge's code: then the key store says (coachSourceView.ts).
  const { onComputer, keySaved } = useApiKeyView(hasApiKeyInEngine);
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
      {onComputer ? (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          Not used while the coach runs on your computer.
        </Alert>
      ) : null}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
        {hasKey ? <CheckCircleIcon color="success" fontSize="small" /> : null}
        <Typography variant="body1" sx={{ fontWeight: 600 }} role="status">
          {hasKey ? 'A key is saved on this device.' : onComputer ? 'No key saved yet.' : 'No key saved yet. The coach needs one to work.'}
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
            variant="tonal"
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
          <Button
            color="error"
            variant="contained"
            data-testid={TID.forgetKeyConfirm}
            onClick={() => void forget()}
            sx={{ minHeight: 48 }}
          >
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
 * Settings > Coach's switch, D99: off by default. The checked state is
 * Settings.keepKeyInDecaid (lifted into ApiKeySection, which also needs it
 * to decide whether save() and forget() touch Decaid), never whether a
 * copy happens to exist there right now. Off with no key, there is nothing
 * to back up, so it waits for one; on, it can always be turned off, key or
 * not (Forget may have left a copy that Decaid has not deleted yet). A
 * toggle that cannot reach Decaid reverts and says so, so the switch never
 * claims a state that is not real.
 */
function KeyInDecaidSwitch({
  hasKey,
  keepInDecaid,
  onChange,
}: {
  hasKey: boolean;
  keepInDecaid: KeepState;
  onChange(next: boolean): void;
}) {
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

interface Form {
  model: string;
  grinder: GrinderForm;
}

function formFrom(settings: Settings): Form {
  return {
    model: settings.model,
    grinder: {
      pick: settings.grinderId ?? NOT_LISTED,
      name: settings.grinderName ?? '',
      setting: settings.grinderSetting ?? '',
    },
  };
}

/** The fields a person can type a pasted key into. */
const TYPED_FIELDS = ['model', 'grinderName', 'grinderSetting'] as const;

/** Did saving take key-shaped text out of what was sent? Storage does that; this only tells. */
function tookKeyOut(sent: Partial<Settings>, saved: Settings): boolean {
  return TYPED_FIELDS.some((field) => {
    const value = sent[field];
    return typeof value === 'string' && containsKeyLike(value) && !containsKeyLike(saved[field] ?? '');
  });
}

type SavedGrinder = Pick<Settings, 'grinderId' | 'grinderName'>;

/** Decaid answers in well under a second when it is there; do not hold the picker longer than this. */
const GRINDER_LIST_TIMEOUT_MS = 5000;

function CoachSettingsSection({ column }: { column: RefObject<HTMLElement | null> }) {
  const { storage, coach, models, decaid, plugins } = useServices();
  const onComputer = useCoachRunsOnComputer();
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState<SavedGrinder>({ grinderId: null, grinderName: null });
  const [library, setLibrary] = useState<GrinderLibrary>({ status: 'loading' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [keyNotice, setKeyNotice] = useState(false);
  // What the last Add a grinder said, until the settings are saved.
  const [addNote, setAddNote] = useState<string | null>(null);
  // DYE2's Grinders page edits Decaid's grinders; it is there only while Decaid runs DYE2 (D103).
  const dye2Loaded = useSyncExternalStore(plugins.subscribe, () => plugins.isLoaded(PLUGIN.dye2));
  // Grinder picks and saves so far: each pick brings the setting control and
  // Save into view, each save what it says (written under Save).
  const [picks, setPicks] = useState(0);
  const [saves, setSaves] = useState(0);
  const settingRef = useRef<HTMLDivElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    storage.settings
      .get()
      .then((settings) => {
        if (live) {
          setSaved({ grinderId: settings.grinderId ?? null, grinderName: settings.grinderName });
          setForm(formFrom(settings));
        }
      })
      .catch((error: unknown) => {
        if (live) setMessage({ tone: 'error', text: `Could not read the settings: ${errorText(error)}` });
      });
    return () => {
      live = false;
    };
  }, [storage]);

  // Decaid's grinder library, read each time the screen opens. An empty list
  // is an answer too (a link it lacks is kept and says so); while Decaid
  // cannot be reached the free-text fields show.
  useEffect(() => {
    let live = true;
    listGrinders(decaid, { timeoutMs: GRINDER_LIST_TIMEOUT_MS })
      .then((grinders) => {
        if (live) setLibrary({ status: 'ready', grinders });
      })
      .catch((error: unknown) => {
        if (live) setLibrary(libraryAfterError(error));
      });
    return () => {
      live = false;
    };
  }, [decaid]);

  // Before paint: at 962x602 the setting, Save and the messages under it sit below the fold.
  useLayoutEffect(() => {
    if (picks === 0 || !column.current || !settingRef.current) return;
    revealInColumn(column.current, settingRef.current, saveRef.current);
  }, [picks, column]);
  useLayoutEffect(() => {
    if (saves === 0 || !column.current || !saveRef.current) return;
    revealInColumn(column.current, saveRef.current, resultRef.current);
  }, [saves, column]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form || saving) return;
    setSaving(true);
    setMessage(null);
    setKeyNotice(false);
    try {
      // Only CafAI's own settings: the engine carries the grinder to Decaid's workflow.
      const sent = { model: form.model, ...grinderPatch(form.grinder, library, saved) };
      const next = await storage.settings.update(sent);
      setSaved({ grinderId: next.grinderId ?? null, grinderName: next.grinderName });
      // The fields show what was really saved, not what was typed.
      setForm(formFrom(next));
      setKeyNotice(tookKeyOut(sent, next));
      setAddNote(null);
      setMessage({ tone: 'success', text: 'Settings saved.' });
      setSaves((count) => count + 1);
      await coach.refresh();
    } catch (error) {
      setMessage({ tone: 'error', text: `Could not save the settings: ${errorText(error)}` });
      setSaves((count) => count + 1);
    } finally {
      setSaving(false);
    }
  };

  const update = (patch: Partial<Form>) => setForm((current) => (current ? { ...current, ...patch } : current));
  const updateGrinder = (patch: Partial<GrinderForm>) => {
    setForm((current) => (current ? { ...current, grinder: { ...current.grinder, ...patch } } : current));
    if (patch.pick !== undefined) setPicks((count) => count + 1);
  };
  // Added to Decaid's library (or found there): in the list and picked; Save links it like any pick.
  const grinderAdded = ({ grinder, added }: AddedGrinder) => {
    setLibrary((current) => withGrinder(current, grinder));
    updateGrinder({ pick: grinder.id });
    setAddNote(addedNote(grinder, added));
  };
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
          sx={selectSx}
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
        {onComputer ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: -1 }}>
            The prices do not apply while the coach runs on your computer: it uses your Claude plan.
          </Typography>
        ) : null}
        <GrinderFields
          form={form?.grinder ?? null}
          library={library}
          savedName={saved.grinderName}
          disabled={disabled}
          onChange={updateGrinder}
          settingRef={settingRef}
        />
        <AddGrinder
          canAdd={canAddGrinder(library)}
          dye2Url={dye2Loaded ? dye2GrindersUrl(decaid.httpOrigin) : null}
          initialModel={form && form.grinder.pick === NOT_LISTED ? form.grinder.name : ''}
          disabled={disabled}
          note={addNote}
          add={(request) => addOrFindGrinder(decaid, request)}
          onAdded={grinderAdded}
        />
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: -1 }}>
          The coach uses your grinder and its dial setting to say how far to turn it.
        </Typography>
        <Box>
          <Button
            ref={saveRef}
            type="submit"
            variant="contained"
            data-testid={TID.settingsSave}
            disabled={disabled}
            sx={{ minHeight: 48, px: 3 }}
          >
            Save settings
          </Button>
        </Box>
      </Box>
      <Box ref={resultRef}>
        {message ? (
          <Alert severity={message.tone} sx={{ mt: 1.5 }} onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        ) : null}
        {keyNotice ? (
          <Alert severity="info" sx={{ mt: 1.5 }} onClose={() => setKeyNotice(false)}>
            {KEY_TAKEN_OUT}
          </Alert>
        ) : null}
      </Box>
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
      <AboutDecaid decaidVersion={decaidVersion} />
    </Section>
  );
}

export function SettingsScreen() {
  // The column scrolls inside itself; the page never does (AppShell).
  const column = useRef<HTMLDivElement>(null);
  return (
    <Box ref={column} sx={{ height: '100%', minHeight: 0, overflowY: 'auto' }}>
      <Stack spacing={2} sx={{ p: 2, maxWidth: 760 }}>
        <Typography variant="h6" component="h1">
          Settings
        </Typography>
        <AppearanceSection />
        <CoachSourceSection />
        <ApiKeySection />
        <CoachSettingsSection column={column} />
        <DrinkSettingsSection />
        <AboutSection />
      </Stack>
    </Box>
  );
}
