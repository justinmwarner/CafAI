/**
 * Settings > Where the coach runs: Anthropic's API with the user's key, or
 * Claude on the user's own Mac or PC through CafAI Bridge, which answers with
 * their Claude plan through Claude Code
 * (docs/superpowers/specs/2026-10-11-local-claude-design.md). The choice, the
 * bridge's address and its pairing code stay on this device
 * (src/storage/coachSource.ts); a change reaches the coach at once. The code
 * lets anyone on the network use the plan, so it is hidden like the API key
 * until shown. Test asks the bridge how it is and for one short real reply on
 * the coach's model; Find looks for a bridge on this same computer (Decaid on
 * a Mac or PC). Shown only when the services carry the store.
 */
import { useEffect, useId, useState, type FormEvent } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { useServices } from '../../app/services.tsx';
import { bridgeFailureLine, bridgeStatusLine, findBridge, getBridgeStatus } from '../../llm/bridgeClient.ts';
import { resolveModel } from '../../llm/models.ts';
import {
  normalizeAddress,
  normalizeCode,
  type CoachSource,
  type CoachSourceKind,
  type CoachSourceStore,
} from '../../storage/coachSource.ts';
import { SECRET_FIELD } from '../../usage/mask.ts';
import { TID } from '../testIds.ts';
import { Section } from './Section.tsx';

// The test ids go on the radios' own inputs, the elements a test (or a keyboard) can focus and check.
declare module '@mui/material/Radio' {
  interface RadioInputSlotPropsOverrides {
    'data-testid'?: string;
  }
}

/** The bridge caps its test reply at 60 s: wait a little longer for its answer. */
const TEST_TIMEOUT_MS = 75_000;
const START_BRIDGE = "On that computer, run npm run bridge in CafAI's folder (see bridge/README.md).";
const SAVE_TO_USE = 'Tap Save to use it.';

type Line = { tone: 'success' | 'info' | 'warning' | 'error'; text: string };
type Busy = 'choose' | 'save' | 'test' | 'find';

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

const fieldSx = { '& .MuiInputBase-root': { minHeight: 48 } } as const;
const mutedSx = { color: 'text.secondary' } as const;

/** A saved code as the field shows it: ABCD-EFGH. */
function shownCode(code: string): string {
  const result = normalizeCode(code);
  return result.ok ? result.display : code;
}

function Choice({ value, title, note, testId, disabled }: { value: CoachSourceKind; title: string; note: string; testId: string; disabled: boolean }) {
  const noteId = useId();
  return (
    <Box>
      <FormControlLabel
        value={value}
        disabled={disabled}
        label={title}
        control={<Radio slotProps={{ input: { 'data-testid': testId, 'aria-describedby': noteId } }} />}
        sx={{ minHeight: 48, mr: 0 }}
      />
      <Typography id={noteId} variant="body2" sx={{ ...mutedSx, pl: 4, mt: -0.75, mb: 0.5 }}>
        {note}
      </Typography>
    </Box>
  );
}

/** The coach's model as saved in Settings (a blank one is the default), for the test reply. */
async function savedModel(settings: { get(): Promise<{ model: string }> }): Promise<string> {
  try {
    return resolveModel((await settings.get()).model);
  } catch {
    return resolveModel(null);
  }
}

function CoachSourceForm({ store }: { store: CoachSourceStore }) {
  const { coach, storage, usage } = useServices();
  const [saved, setSaved] = useState<CoachSource | null>(null);
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [codeVisible, setCodeVisible] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  // What Save, Find or a switch did; what Test found (TID.computerStatus).
  const [message, setMessage] = useState<Line | null>(null);
  const [status, setStatus] = useState<Line | null>(null);

  useEffect(() => {
    let live = true;
    store.get().then(
      (source) => {
        if (!live) return;
        setSaved(source);
        setAddress(source.address);
        setCode(shownCode(source.code));
      },
      (error: unknown) => {
        if (live) setMessage({ tone: 'error', text: errorText(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [store]);

  /**
   * The engine reads readiness again, and sends a reply that waited for the
   * code. It may be busy with a turn first, so this section does not wait;
   * the next request reads the saved choice anyway.
   */
  const refreshCoach = () => {
    coach.refresh().catch(() => undefined);
  };

  /** The fields as the bridge needs them, or null once the fields say what is wrong. */
  const readFields = () => {
    const where = normalizeAddress(address);
    const pairing = normalizeCode(code);
    setAddressError(where.ok ? null : where.error);
    setCodeError(pairing.ok ? null : pairing.error);
    return where.ok && pairing.ok ? { where, pairing } : null;
  };

  const choose = async (kind: CoachSourceKind) => {
    if (!saved || busy || kind === saved.kind) return;
    const before = saved;
    // The address and the code stay, whichever is chosen.
    const next = { ...saved, kind };
    // The choice shows at once, and goes back if it could not be saved.
    setSaved(next);
    setBusy('choose');
    setMessage(null);
    setStatus(null);
    try {
      await store.set(next);
      refreshCoach();
    } catch (error) {
      setSaved(before);
      setMessage({ tone: 'error', text: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!saved || busy) return;
    const fields = readFields();
    if (!fields) return;
    setBusy('save');
    setMessage(null);
    setStatus(null);
    try {
      const next: CoachSource = { kind: 'computer', address: fields.where.display, code: fields.pairing.code };
      await store.set(next);
      setSaved(next);
      // The fields show what was saved, not what was typed.
      setAddress(next.address);
      setCode(fields.pairing.display);
      setMessage({ tone: 'success', text: 'Saved on this device.' });
      refreshCoach();
      usage?.track('coach_setup');
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    if (busy) return;
    const fields = readFields();
    if (!fields) return;
    setBusy('test');
    // One result at a time: what Save or Find said is old news now.
    setMessage(null);
    setStatus({ tone: 'info', text: 'Asking CafAI Bridge for a short test reply…' });
    try {
      const result = await getBridgeStatus({
        baseUrl: fields.where.baseUrl,
        code: fields.pairing.code,
        probe: true,
        // The test reply runs on the coach's model: a Claude Code too old for it shows up now.
        model: await savedModel(storage.settings),
        timeoutMs: TEST_TIMEOUT_MS,
      });
      if (!result.ok) {
        setStatus({ tone: 'error', text: bridgeFailureLine(result.failure, fields.where.display) });
        return;
      }
      const line = bridgeStatusLine(result.status);
      // Tested before saving: the coach still uses what was saved.
      const unsaved = saved?.address !== fields.where.display || saved.code !== fields.pairing.code;
      setStatus({ tone: line.ok ? 'success' : 'warning', text: line.ok && unsaved ? `${line.text} ${SAVE_TO_USE}` : line.text });
    } finally {
      setBusy(null);
    }
  };

  const find = async () => {
    if (busy) return;
    setBusy('find');
    setMessage(null);
    setStatus(null);
    try {
      const found = await findBridge();
      if (found === null) {
        setMessage({ tone: 'info', text: 'Did not find CafAI Bridge on this device. Type the address it shows on your computer.' });
        return;
      }
      setAddress(found);
      setAddressError(null);
      const next = normalizeCode(code).ok ? SAVE_TO_USE : 'Type the code it shows, then tap Save.';
      setMessage({ tone: 'success', text: `Found CafAI Bridge on this device. ${next}` });
    } finally {
      setBusy(null);
    }
  };

  const onComputer = saved?.kind === 'computer';
  const disabled = saved === null || busy !== null;
  // The choice just tapped stays as it is while it saves (choose() ignores taps meanwhile), so focus stays on it.
  const choiceDisabled = saved === null || (busy !== null && busy !== 'choose');

  return (
    <Section title="Where the coach runs">
      <RadioGroup name="coach-source" value={saved?.kind ?? ''} onChange={(event) => void choose(event.target.value as CoachSourceKind)}>
        <Choice
          value="anthropic"
          title="Anthropic API key"
          note="Billed per use to your key."
          testId={TID.coachSourceAnthropic}
          disabled={choiceDisabled}
        />
        <Choice
          value="computer"
          title="Claude on my computer"
          note="Uses your Claude Pro or Max plan through Claude Code. Run CafAI Bridge on your Mac or PC."
          testId={TID.coachSourceComputer}
          disabled={choiceDisabled}
        />
      </RadioGroup>
      {onComputer ? (
        <Box component="form" onSubmit={(event) => void save(event)} sx={{ display: 'grid', gap: 1.5, mt: 1.5 }}>
          <Typography variant="body2" sx={mutedSx}>
            {START_BRIDGE}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <TextField
              label="Address"
              placeholder="e.g. 192.168.1.20"
              value={address}
              onChange={(event) => {
                setAddress(event.target.value);
                setAddressError(null);
                setStatus(null);
              }}
              disabled={disabled}
              error={addressError !== null}
              helperText={addressError}
              size="small"
              sx={{ ...fieldSx, flex: '1 1 260px' }}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: {
                  'data-testid': TID.computerAddress,
                  inputMode: 'url',
                  autoComplete: 'off',
                  autoCapitalize: 'off',
                  autoCorrect: 'off',
                  spellCheck: false,
                },
              }}
            />
            <Button variant="tonal" data-testid={TID.computerFind} disabled={disabled} onClick={() => void find()} sx={{ minHeight: 48 }}>
              Find
            </Button>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <TextField
              label="Code"
              placeholder="e.g. ABCD-EFGH"
              type={codeVisible ? 'text' : 'password'}
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                setCodeError(null);
                setStatus(null);
              }}
              disabled={disabled}
              error={codeError !== null}
              helperText={codeError}
              size="small"
              sx={{ ...fieldSx, flex: '1 1 260px' }}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: {
                  'data-testid': TID.computerCode,
                  // Out of Clarity entirely, shown or hidden (D-USAGE-5).
                  ...SECRET_FIELD,
                  autoComplete: 'off',
                  autoCapitalize: 'characters',
                  autoCorrect: 'off',
                  spellCheck: false,
                },
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton aria-label={codeVisible ? 'Hide code' : 'Show code'} onClick={() => setCodeVisible((v) => !v)} edge="end">
                        {codeVisible ? <VisibilityOffIcon /> : <VisibilityIcon />}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Button type="submit" variant="contained" data-testid={TID.computerSave} disabled={disabled} sx={{ minHeight: 48, px: 3 }}>
              Save
            </Button>
            <Button variant="tonal" data-testid={TID.computerTest} disabled={disabled} onClick={() => void test()} sx={{ minHeight: 48 }}>
              {busy === 'test' ? 'Testing…' : 'Test'}
            </Button>
          </Box>
          {status ? (
            <Alert severity={status.tone} role="status" data-testid={TID.computerStatus}>
              {status.text}
            </Alert>
          ) : null}
        </Box>
      ) : null}
      {message ? (
        <Alert severity={message.tone} sx={{ mt: 1.5 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      ) : null}
    </Section>
  );
}

export function CoachSourceSection() {
  const { coachSource } = useServices();
  // Without the store (fakes, previews) there is nothing to choose: the coach runs on Anthropic.
  return coachSource ? <CoachSourceForm store={coachSource} /> : null;
}
