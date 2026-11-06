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
  /** As read from the photo of the bag (a name the bag did not show is empty), or blank to type into. */
  details: SaveBagDetails;
  /** A photo's reading to check, or details the barista types (D279). */
  source?: 'photo' | 'typed';
  confirmed: boolean;
  /** True while the coach is working; blocks Confirm. */
  disabled?: boolean;
  /** Set aside unconfirmed (the bag was described in the chat): nothing was saved. */
  expired?: boolean;
  setAsideReason?: SetAsideReason;
  onConfirm(details: SaveBagDetails): void;
}

/** The fields as typed: every one text, a blank one unknown. */
type Draft = Record<
  'name' | 'roaster' | 'origin' | 'process' | 'notes' | 'roastLevel' | 'roastDate' | 'producer' | 'variety' | 'altitude' | 'other',
  string
>;

/** The one-line text fields, in the card's order, with their labels and an example where one helps. */
const TEXT_FIELDS: ReadonlyArray<{ field: 'name' | 'roaster' | 'origin' | 'producer' | 'variety' | 'altitude' | 'process'; label: string; example?: string }> = [
  { field: 'name', label: 'Name' },
  { field: 'roaster', label: 'Roaster' },
  { field: 'origin', label: 'Origin', example: 'Colombia, Huila' },
  { field: 'producer', label: 'Producer or farm', example: 'El Paraíso' },
  { field: 'variety', label: 'Variety', example: 'Castillo, Caturra' },
  { field: 'altitude', label: 'Altitude', example: '1,950 masl' },
  { field: 'process', label: 'Process', example: 'Washed' },
];

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
    // Absent on a card stored before them (D278).
    producer: details.producer ?? '',
    variety: details.variety ?? '',
    altitude: details.altitude ?? '',
    other: details.other ?? '',
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
    producer: known(draft.producer),
    variety: known(draft.variety),
    altitude: known(draft.altitude),
    other: known(draft.other),
  };
}

/** The details once decided: the name, then the facts joined by middle dots, then the notes. */
function DetailsText({ details }: { details: SaveBagDetails }) {
  const facts = [
    details.roaster,
    details.origin,
    details.producer ? `Produced by ${details.producer}` : null,
    details.variety,
    details.altitude,
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
      {details.other ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25, whiteSpace: 'pre-line' }}>
          Other details: {details.other}
        </Typography>
      ) : null}
    </Box>
  );
}

/**
 * The bag's details for the barista to fix or fill in, then confirm: read
 * from a photo of the bag by the coach's model (6.8), or blank for the
 * barista to type (D279). Confirm saves them as the coach's
 * save_bag_details would; until then nothing is saved. Afterwards the card
 * stays in the chat with the details as text.
 */
export function BagConfirmCard({
  details,
  source = 'photo',
  confirmed,
  disabled = false,
  expired = false,
  setAsideReason,
  onConfirm,
}: BagConfirmCardProps) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(details));
  // A typed card starts blank: its name is asked for in red only once the barista has been to it.
  const [nameTouched, setNameTouched] = useState(false);
  const open = !confirmed && !expired;
  const typed = source === 'typed';
  const set = (field: keyof Draft) => (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [field]: event.target.value }));
  const nameMissing = draft.name.trim() === '';
  const nameError = nameMissing && (!typed || nameTouched);

  const text = ({ field, label, example }: (typeof TEXT_FIELDS)[number]) => (
    <TextField
      key={field}
      size="small"
      label={label}
      value={draft[field]}
      onChange={set(field)}
      onBlur={field === 'name' ? () => setNameTouched(true) : undefined}
      placeholder={typed && example ? `e.g. ${example}` : undefined}
      error={field === 'name' && nameError}
      helperText={field === 'name' && (nameError || (typed && nameMissing)) ? 'Needed: it names the profiles.' : undefined}
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
        {typed ? "The bag's details" : "Check the bag's details"}
      </Typography>
      {open ? (
        <>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
            {typed
              ? 'Type what the bag says. Only the name is needed; leave blank what it does not say.'
              : 'Read from your photo. Fix anything that is wrong, then confirm.'}
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 1.5, mt: 1.5 }}>
            {TEXT_FIELDS.map(text)}
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
            <TextField
              size="small"
              label="Other details"
              value={draft.other}
              onChange={set('other')}
              placeholder="Anything else: a lot, the harvest, a fermentation, your own notes"
              multiline
              minRows={2}
              maxRows={6}
              sx={{ ...fieldSx, gridColumn: '1 / -1' }}
              slotProps={{ htmlInput: { maxLength: BAG_LIMITS.other }, inputLabel: { shrink: true } }}
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
