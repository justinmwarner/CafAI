/**
 * Under Settings' grinder fields: Add a grinder, a dialog that adds one to
 * Decaid's grinder library (so Decaid and every skin list it) and picks it,
 * and, while Decaid runs the DYE2 plugin, Edit grinders in DYE2, the page
 * where Decaid's grinders are edited and deleted (Decaid's own app has no
 * such screen). The rules live in addGrinder.ts; the screen does the adding
 * and the picking (SettingsScreen.tsx).
 */
import { useState, type FormEvent } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import { GRINDER_LIMITS, type Grinder, type GrinderCreateRequest, type GrinderSettingType } from '../../api/grinders.ts';
import { TID } from '../testIds.ts';
import { addGrinderError, checkAddGrinder, emptyAddGrinderForm, type AddGrinderField, type AddGrinderForm } from './addGrinder.ts';

const fieldSx = { '& .MuiInputBase-root': { minHeight: 48 } } as const;
/** A native select opens only from the select element itself, so it is the 48 px target. */
const selectSx = { ...fieldSx, '& .MuiNativeSelect-select': { py: '12.5px' } } as const;

export interface AddedGrinder {
  grinder: Grinder;
  /** False when Decaid already had it, so nothing was added. */
  added: boolean;
}

export interface AddGrinderProps {
  /** Decaid answered with its grinder library, so one can be added. */
  canAdd: boolean;
  /** DYE2's Grinders page while Decaid has DYE2 loaded, else null. */
  dye2Url: string | null;
  /** The name typed in Settings' grinder field, to start the form from. */
  initialModel: string;
  disabled: boolean;
  /** What the last add said, until the settings are saved. */
  note: string | null;
  /** Add the grinder to Decaid's library, or find it there. Throws with a sentence. */
  add(request: GrinderCreateRequest): Promise<AddedGrinder>;
  onAdded(result: AddedGrinder): void;
}

export function AddGrinder({ canAdd, dye2Url, initialModel, disabled, note, add, onAdded }: AddGrinderProps) {
  const [open, setOpen] = useState(false);
  if (!canAdd && dye2Url === null) return null;
  return (
    <Box sx={{ display: 'grid', gap: 1, mt: -1 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {canAdd ? (
          <Button
            startIcon={<AddRoundedIcon />}
            disabled={disabled}
            onClick={() => setOpen(true)}
            data-testid={TID.addGrinder}
            sx={{ minHeight: 48 }}
          >
            Add a grinder
          </Button>
        ) : null}
        {dye2Url !== null ? (
          <Button component="a" href={dye2Url} startIcon={<EditRoundedIcon />} data-testid={TID.editGrindersInDye2} sx={{ minHeight: 48 }}>
            Edit grinders in DYE2
          </Button>
        ) : null}
      </Box>
      {note ? (
        <Alert severity="success" data-testid={TID.addGrinderNote}>
          {note}
        </Alert>
      ) : null}
      {open ? (
        <AddGrinderDialog
          initialModel={initialModel}
          add={add}
          onClose={() => setOpen(false)}
          onAdded={(result) => {
            setOpen(false);
            onAdded(result);
          }}
        />
      ) : null}
    </Box>
  );
}

interface AddGrinderDialogProps {
  initialModel: string;
  add(request: GrinderCreateRequest): Promise<AddedGrinder>;
  onClose(): void;
  onAdded(result: AddedGrinder): void;
}

const DIAL_LABELS: Record<GrinderSettingType, string> = { numeric: 'Numbered dial', preset: 'List of settings' };

/** Mounted only while open, so each opening starts from the grinder name typed in Settings. */
function AddGrinderDialog({ initialModel, add, onClose, onAdded }: AddGrinderDialogProps) {
  const [form, setForm] = useState<AddGrinderForm>(() => emptyAddGrinderForm(initialModel));
  const [problem, setProblem] = useState<{ field: AddGrinderField | null; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const numeric = form.dial === 'numeric';

  const change = (patch: Partial<AddGrinderForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setProblem(null);
  };
  const fieldError = (field: AddGrinderField) => (problem?.field === field ? problem.message : null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // React carries the submit up through the portal to Settings' own form, whose Save it would run.
    event.stopPropagation();
    if (busy) return;
    const check = checkAddGrinder(form);
    if (!check.ok) {
      setProblem({ field: check.field, message: check.message });
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      onAdded(await add(check.request));
    } catch (error) {
      setProblem({ field: null, message: addGrinderError(error) });
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={() => {
        // A grinder on its way to Decaid finishes first: closing would hide whether it got there.
        if (!busy) onClose();
      }}
      fullWidth
      maxWidth="sm"
      scroll="paper"
      slotProps={{ paper: { component: 'form', onSubmit: (event: FormEvent) => void submit(event) } }}
    >
      <DialogTitle>Add a grinder to Decaid</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, alignContent: 'start' }}>
        <DialogContentText>It goes into Decaid's grinder library, so Decaid and your other skins see it too.</DialogContentText>
        <TextField
          size="small"
          label="Grinder"
          placeholder="e.g. Niche Zero"
          value={form.model}
          disabled={busy}
          autoFocus
          onChange={(event) => change({ model: event.target.value })}
          error={fieldError('model') !== null}
          helperText={fieldError('model') ?? ' '}
          sx={fieldSx}
          slotProps={{ htmlInput: { 'data-testid': TID.addGrinderModel, maxLength: GRINDER_LIMITS.model }, inputLabel: { shrink: true } }}
        />
        <TextField
          size="small"
          label="Burrs (optional)"
          placeholder="e.g. 63 mm conical"
          value={form.burrs}
          disabled={busy}
          onChange={(event) => change({ burrs: event.target.value })}
          error={fieldError('burrs') !== null}
          helperText={fieldError('burrs') ?? ' '}
          sx={fieldSx}
          slotProps={{ htmlInput: { 'data-testid': TID.addGrinderBurrs, maxLength: GRINDER_LIMITS.burrs }, inputLabel: { shrink: true } }}
        />
        <TextField
          select
          size="small"
          label="Dial"
          value={form.dial}
          disabled={busy}
          onChange={(event) => change({ dial: event.target.value === 'preset' ? 'preset' : 'numeric' })}
          sx={selectSx}
          slotProps={{ select: { native: true }, htmlInput: { 'data-testid': TID.addGrinderDial }, inputLabel: { shrink: true } }}
        >
          {(['numeric', 'preset'] as const).map((dial) => (
            <option key={dial} value={dial}>
              {DIAL_LABELS[dial]}
            </option>
          ))}
        </TextField>
        {numeric ? (
          <>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
              <TextField
                size="small"
                label="Smallest step"
                placeholder="e.g. 0.5"
                value={form.smallStep}
                disabled={busy}
                onChange={(event) => change({ smallStep: event.target.value })}
                error={fieldError('smallStep') !== null}
                helperText={fieldError('smallStep') ?? ' '}
                sx={fieldSx}
                slotProps={{
                  htmlInput: { 'data-testid': TID.addGrinderSmallStep, inputMode: 'decimal', maxLength: 10 },
                  inputLabel: { shrink: true },
                }}
              />
              <TextField
                size="small"
                label="Big step (optional)"
                placeholder="e.g. 2"
                value={form.bigStep}
                disabled={busy}
                onChange={(event) => change({ bigStep: event.target.value })}
                error={fieldError('bigStep') !== null}
                helperText={fieldError('bigStep') ?? ' '}
                sx={fieldSx}
                slotProps={{
                  htmlInput: { 'data-testid': TID.addGrinderBigStep, inputMode: 'decimal', maxLength: 10 },
                  inputLabel: { shrink: true },
                }}
              />
            </Box>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: -1 }}>
              CafAI turns the dial in these steps. Not sure? Leave them empty and the coach gives directions only.
            </Typography>
          </>
        ) : (
          <TextField
            size="small"
            label="Settings, finest first"
            placeholder="e.g. 1, 2, 3, 4"
            value={form.settings}
            disabled={busy}
            onChange={(event) => change({ settings: event.target.value })}
            error={fieldError('settings') !== null}
            helperText={fieldError('settings') ?? 'With commas between them, as the grinder shows them.'}
            sx={fieldSx}
            slotProps={{ htmlInput: { 'data-testid': TID.addGrinderSettings }, inputLabel: { shrink: true } }}
          />
        )}
        {problem && problem.field === null ? <Alert severity="error">{problem.message}</Alert> : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy} sx={{ minHeight: 48 }}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={busy} data-testid={TID.addGrinderSubmit} sx={{ minHeight: 48 }}>
          {busy ? 'Adding…' : 'Add to Decaid'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
