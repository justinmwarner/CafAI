import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import type { SetAsideReason } from '../../../app/types.ts';
import { BAG_LIMITS, ROAST_LEVELS, toRoastLevel, type SaveBagDetails } from '../../../coach/contract.ts';
import { TID } from '../../testIds.ts';
import { formatDate, setAsideNote } from '../format.ts';

export interface BagConfirmCardProps {
  /** As read from the photo of the bag; a name the bag did not show is empty. */
  details: SaveBagDetails;
  confirmed: boolean;
  /** True while the coach is working; blocks Confirm. */
  disabled?: boolean;
  /** Set aside unconfirmed (the bag was described in the chat): nothing was saved. */
  expired?: boolean;
  setAsideReason?: SetAsideReason;
  onConfirm(details: SaveBagDetails): void;
}

/** The fields as typed: every one text, a blank one unknown. */
type Draft = Record<'name' | 'roaster' | 'origin' | 'process' | 'notes' | 'roastLevel' | 'roastDate', string>;

const LEVEL_LABELS: Record<(typeof ROAST_LEVELS)[number], string> = {
  light: 'Light',
  'medium-light': 'Medium-light',
  medium: 'Medium',
  'medium-dark': 'Medium-dark',
  dark: 'Dark',
};

/**
 * The card lives in the chat, where x-chat's ChatBox has every element inherit
 * its border-box (whether that wins depends on which styles went in first):
 * that took an input's paddings out of its own height and left the select no
 * room for its text. Inputs keep MUI's content-box here.
 */
const fieldSx = { '& .MuiInputBase-root': { minHeight: 48 }, '& .MuiInputBase-input': { boxSizing: 'content-box' } } as const;
/** A native select opens only from the select element itself, so it is the 48 px target. */
const selectSx = { ...fieldSx, '& .MuiNativeSelect-select': { py: '12.5px' } } as const;

function draftOf(details: SaveBagDetails): Draft {
  return {
    name: details.name,
    roaster: details.roaster ?? '',
    origin: details.origin ?? '',
    process: details.process ?? '',
    notes: details.notes ?? '',
    roastLevel: details.roastLevel ?? '',
    roastDate: details.roastDate ?? '',
  };
}

const known = (text: string) => text.trim() || null;

function detailsOf(draft: Draft): SaveBagDetails {
  return {
    name: draft.name.trim(),
    roaster: known(draft.roaster),
    origin: known(draft.origin),
    roastLevel: toRoastLevel(draft.roastLevel),
    process: known(draft.process),
    notes: known(draft.notes),
    roastDate: /^\d{4}-\d{2}-\d{2}$/.test(draft.roastDate) ? draft.roastDate : null,
  };
}

/** The details once decided: the name, then the facts joined by middle dots, then the notes. */
function DetailsText({ details }: { details: SaveBagDetails }) {
  const facts = [
    details.roaster,
    details.origin,
    details.process,
    details.roastLevel ? `${details.roastLevel} roast` : null,
    details.roastDate ? `Roasted ${formatDate(details.roastDate)}` : null,
  ].filter(Boolean);
  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
        {details.name || 'No name'}
      </Typography>
      {facts.length > 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
          {facts.join(' · ')}
        </Typography>
      ) : null}
      {details.notes ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
          Tasting notes: {details.notes}
        </Typography>
      ) : null}
    </Box>
  );
}

/**
 * The details the coach's model read from a photo of the bag (6.8), for the
 * barista to fix and confirm. Confirm saves them as the coach's
 * save_bag_details would; until then nothing is saved. Afterwards the card
 * stays in the chat with the details as text.
 */
export function BagConfirmCard({ details, confirmed, disabled = false, expired = false, setAsideReason, onConfirm }: BagConfirmCardProps) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(details));
  const open = !confirmed && !expired;
  const set = (field: keyof Draft) => (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [field]: event.target.value }));
  const nameMissing = draft.name.trim() === '';

  const text = (field: 'name' | 'roaster' | 'origin' | 'process', label: string) => (
    <TextField
      size="small"
      label={label}
      value={draft[field]}
      onChange={set(field)}
      error={field === 'name' && nameMissing}
      helperText={field === 'name' && nameMissing ? 'Needed: it names the profiles.' : undefined}
      sx={fieldSx}
      slotProps={{
        htmlInput: { maxLength: BAG_LIMITS[field], ...(field === 'name' ? { 'aria-required': true } : {}) },
        inputLabel: { shrink: true },
      }}
    />
  );

  return (
    <Paper
      variant="outlined"
      data-testid={TID.bagConfirm}
      component="section"
      aria-label="The bag's details"
      sx={{
        p: 1.5,
        my: 0.5,
        bgcolor: 'background.paper',
        color: expired ? 'text.secondary' : 'text.primary',
        borderColor: open ? 'primary.main' : 'divider',
        borderWidth: open ? 2 : 1,
      }}
    >
      <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>
        Check the bag&apos;s details
      </Typography>
      {open ? (
        <>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
            Read from your photo. Fix anything that is wrong, then confirm.
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 1.5, mt: 1.5 }}>
            {text('name', 'Name')}
            {text('roaster', 'Roaster')}
            {text('origin', 'Origin')}
            {text('process', 'Process')}
            <TextField
              select
              size="small"
              label="Roast level"
              value={draft.roastLevel}
              onChange={set('roastLevel')}
              sx={selectSx}
              slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
            >
              <option value="">Not on the bag</option>
              {ROAST_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {LEVEL_LABELS[level]}
                </option>
              ))}
            </TextField>
            <TextField
              type="date"
              size="small"
              label="Roast date"
              value={draft.roastDate}
              onChange={set('roastDate')}
              sx={fieldSx}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              size="small"
              label="Tasting notes"
              value={draft.notes}
              onChange={set('notes')}
              multiline
              minRows={1}
              maxRows={4}
              sx={{ ...fieldSx, gridColumn: '1 / -1' }}
              slotProps={{ htmlInput: { maxLength: BAG_LIMITS.notes }, inputLabel: { shrink: true } }}
            />
          </Box>
          <Stack direction="row" sx={{ mt: 1.5 }}>
            <Button variant="contained" disabled={disabled || nameMissing} onClick={() => onConfirm(detailsOf(draft))} sx={{ minHeight: 48, px: 3 }}>
              Confirm
            </Button>
          </Stack>
        </>
      ) : (
        <>
          {expired ? (
            <Typography variant="body2" sx={{ mt: 0.25 }}>
              {setAsideNote(setAsideReason, 'Set aside: you described the bag in the chat.')} These details were not saved.
            </Typography>
          ) : null}
          <DetailsText details={details} />
          {confirmed ? (
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: 'primary.main', mt: 1 }}>
              <CheckCircleIcon fontSize="small" />
              <Typography variant="button" sx={{ textTransform: 'none' }}>
                Confirmed
              </Typography>
            </Stack>
          ) : null}
        </>
      )}
    </Paper>
  );
}
