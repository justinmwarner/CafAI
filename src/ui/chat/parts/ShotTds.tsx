/**
 * The barista's refractometer reading on a shot's card (D-TDS-1 to D-TDS-3,
 * D-TDS-8): cells of the card's grid of numbers, so ShotCard mounts it with
 * one line inside that grid.
 *
 * Without a reading, one quiet cell: "TDS" over "+ Add", the whole cell a
 * 48 px button (its box reaches 3 px into the gaps around it, so the row
 * stays as tall as its neighbours: on a tablet the cell fills the grid's
 * empty fifth column and the card does not grow). A tap opens the field
 * across the card, under the numbers. With a reading, TDS and EY start a row
 * of their own, the barista's numbers apart from the machine's, and a tap on
 * the TDS opens the field again to change or remove it.
 *
 * The field is CafAI's number field (AddGrinder.tsx's steps, DrinkFields.tsx):
 * text with the decimal keyboard (`inputmode="decimal"`), a comma read as a
 * point, the unit at its end; Enter (the keyboard's Done) or Save keeps it,
 * Cancel or Escape closes it. Leaving the field keeps the draft and does
 * nothing else: a tap on Save leaves the field first. As in the composer,
 * typing is never held while the coach works; saving is, as the rating is.
 */
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { EY_MAX_PCT, formatEy, formatTds, readingOf, readTdsInput, type ShotReading } from '../../../coach/extraction.ts';
import type { ShotSummary } from '../../../coach/types.ts';
import { TID } from '../../testIds.ts';
import { formatGrams } from '../format.ts';

/** A number the card does not have, as the card's other numbers show it (format.ts). */
const NO_VALUE = '–';

/** A number and its unit never part at a line's end ("45.8 g", "25 %"): the space between them becomes a no-break space. */
const keepUnits = (text: string) => text.replace(/(\d) (g|%)(?=[\s.,;:)]|$)/g, '$1 $2');

/** The card's metric value: what ShotCard's own metrics are set in. */
const valueStyle = { fontWeight: 650, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' } as const;

/**
 * The TDS cell as one button the cell's size: its text where the other
 * cells have theirs, its box 8 px wider at each side (into the 16 px between
 * columns) and 3 px into the gaps above and below, so it is 48 px tall while
 * its row stays 42. With a reading it starts a row: the barista's numbers
 * apart from the machine's.
 */
function cellButtonSx(startsRow: boolean): SxProps<Theme> {
  return (theme) => ({
    minWidth: 0,
    minHeight: 48,
    mx: -1,
    my: '-3px',
    px: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'center',
    textAlign: 'left',
    gridColumnStart: startsRow ? 1 : 'auto',
    borderRadius: `${theme.shape.borderRadius}px`,
    '@media (hover: hover)': { '&:hover': { bgcolor: 'action.hover' } },
  });
}

/** Why a reading has no EY, in a line under the numbers. */
function noEyReason(summary: Pick<ShotSummary, 'doseG' | 'yieldG'>): string {
  const dose = typeof summary.doseG === 'number' && summary.doseG > 0;
  const cup = typeof summary.yieldG === 'number' && summary.yieldG > 0;
  if (!dose && !cup) return 'this shot has no dose or yield';
  if (!dose) return 'Decaid had no dose for this shot';
  return 'this shot has no yield from the scale';
}

/** What the field says under it: what to type, where the EY comes from, and when the coach hears it. */
export function fieldHelp(summary: Pick<ShotSummary, 'doseG' | 'yieldG'>): string {
  const hasEy = typeof summary.doseG === 'number' && summary.doseG > 0 && typeof summary.yieldG === 'number' && summary.yieldG > 0;
  if (hasEy) {
    return keepUnits(
      `What your refractometer reads. CafAI works out the EY from this shot's ${formatGrams(summary.doseG)} dose ` +
        `and ${formatGrams(summary.yieldG)} yield, and the coach gets both with your next tap or message.`,
    );
  }
  const why = noEyReason(summary);
  return `What your refractometer reads. ${why.charAt(0).toUpperCase()}${why.slice(1)}, so there is no EY; the coach gets the TDS with your next tap or message.`;
}

/** The line under the numbers once a reading is saved: why there is no EY, or an EY no coffee gives. */
function readingNote(reading: ShotReading, summary: Pick<ShotSummary, 'doseG' | 'yieldG'>): { warning: boolean; text: string } | null {
  if (reading.eyPct === null) return { warning: false, text: `No EY: ${noEyReason(summary)}.` };
  if (reading.eyPct > EY_MAX_PCT) {
    return { warning: true, text: keepUnits(`An EY of ${formatEy(reading.eyPct)} is more than coffee gives up. Check the TDS, and the dose in Decaid.`) };
  }
  return null;
}

export interface ShotTdsProps {
  summary: ShotSummary;
  /** Keep a TDS (%) or remove it (null). Without it the card only shows a reading it has. */
  onSave?: (tdsPct: number | null) => void;
  /** True while the coach works: Save and Remove are held, typing is not. */
  busy?: boolean;
}

/** The TDS and EY cells of a shot card's numbers, and the field that sets them (D-TDS-1). */
export function ShotTds({ summary, onSave, busy = false }: ShotTdsProps) {
  const fieldId = useId();
  const helpId = useId();
  const cellRef = useRef<HTMLButtonElement | null>(null);
  /** The field was opened from a keyboard (Enter or Space on the cell): closing it gives the cell the focus back. */
  const fromKeyboard = useRef(false);
  const reading = readingOf(summary);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  if (!onSave) {
    // History and other places that only show the card: the reading, or nothing.
    if (!reading) return null;
    return (
      <>
        <ReadingMetric label="TDS" value={formatTds(reading.tdsPct)} testId={TID.tdsCell} first />
        <ReadingMetric label="EY" value={reading.eyPct === null ? NO_VALUE : formatEy(reading.eyPct)} testId={TID.tdsEy} />
      </>
    );
  }

  const open = () => {
    setDraft(reading ? reading.tdsPct.toFixed(2) : '');
    setProblem(null);
    setEditing(true);
  };
  const close = () => {
    setEditing(false);
    setProblem(null);
    // A keyboard keeps its place on the cell. Opened by a tap, the focus leaves with the field, so the
    // on-screen keyboard goes and no keyboard focus ring lands on the cell (DESIGN.md: touch never sees one).
    if (fromKeyboard.current) cellRef.current?.focus();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    // Held while the coach works: the draft waits in the field.
    if (busy) return;
    const read = readTdsInput(draft);
    if (!read.ok) {
      setProblem(read.message);
      return;
    }
    close();
    if (read.tdsPct !== (reading?.tdsPct ?? null)) onSave(read.tdsPct);
  };
  const remove = () => {
    close();
    onSave(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close();
  };

  const note = !editing && reading ? readingNote(reading, summary) : null;
  return (
    <>
      <ButtonBase
        ref={cellRef}
        data-testid={TID.tdsCell}
        aria-label={reading ? `TDS ${formatTds(reading.tdsPct)}, change it` : 'Add TDS'}
        aria-expanded={editing}
        aria-controls={editing ? fieldId : undefined}
        onClick={(event) => {
          // A click from Enter or Space has no pointer count.
          fromKeyboard.current = event.detail === 0;
          if (editing) close();
          else open();
        }}
        sx={cellButtonSx(reading !== null)}
      >
        <Typography variant="label" component="span" sx={{ color: 'text.secondary' }}>
          TDS
        </Typography>
        {reading ? (
          <Typography variant="body1" component="span" sx={{ ...valueStyle, display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'text.primary' }}>
            {formatTds(reading.tdsPct)}
            <EditRoundedIcon aria-hidden sx={{ fontSize: 16, color: 'primary.main' }} />
          </Typography>
        ) : (
          <Typography
            variant="body1"
            component="span"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, color: 'primary.main', fontWeight: 600 }}
          >
            <AddRoundedIcon aria-hidden sx={{ fontSize: 18 }} />
            Add
          </Typography>
        )}
      </ButtonBase>
      {reading ? <ReadingMetric label="EY" value={reading.eyPct === null ? NO_VALUE : formatEy(reading.eyPct)} testId={TID.tdsEy} /> : null}
      {editing ? (
        <Box
          component="form"
          id={fieldId}
          noValidate
          aria-label="TDS from your refractometer"
          onSubmit={submit}
          onKeyDown={onKeyDown}
          sx={{ gridColumn: '1 / -1', display: 'grid', gap: 0.75, mt: 0.5 }}
        >
          <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
            <TextField
              size="small"
              label="TDS"
              value={draft}
              autoFocus
              error={problem !== null}
              onChange={(event) => {
                setDraft(event.target.value);
                setProblem(null);
              }}
              sx={{ width: 136, '& .MuiInputBase-root': { minHeight: 48 } }}
              slotProps={{
                htmlInput: {
                  inputMode: 'decimal',
                  enterKeyHint: 'done',
                  maxLength: 8,
                  autoComplete: 'off',
                  'aria-describedby': helpId,
                  'data-testid': TID.tdsInput,
                  style: { fontVariantNumeric: 'tabular-nums' },
                },
                input: {
                  endAdornment: (
                    <InputAdornment position="end" aria-hidden sx={{ '& .MuiTypography-root': { color: 'text.secondary' } }}>
                      %
                    </InputAdornment>
                  ),
                },
                inputLabel: { shrink: true },
              }}
            />
            <Button type="submit" variant="contained" disabled={busy} data-testid={TID.tdsSave} sx={{ minHeight: 48 }}>
              Save
            </Button>
            {reading ? (
              <Button type="button" variant="text" disabled={busy} onClick={remove} data-testid={TID.tdsRemove} sx={{ minHeight: 48 }}>
                Remove
              </Button>
            ) : null}
            <Button type="button" variant="text" onClick={close} data-testid={TID.tdsCancel} sx={{ minHeight: 48 }}>
              Cancel
            </Button>
          </Stack>
          <Typography
            id={helpId}
            variant="body2"
            role={problem ? 'alert' : undefined}
            sx={{ color: problem ? 'error.main' : 'text.secondary' }}
          >
            {problem ? keepUnits(problem) : fieldHelp(summary)}
          </Typography>
        </Box>
      ) : null}
      {note ? (
        <Stack
          direction="row"
          spacing={1}
          data-testid={TID.tdsNote}
          sx={{ gridColumn: '1 / -1', alignItems: 'flex-start', color: note.warning ? 'warning.main' : 'text.secondary' }}
        >
          {note.warning ? <WarningAmberIcon fontSize="small" sx={{ mt: 0.25 }} /> : null}
          <Typography variant="body2">{note.text}</Typography>
        </Stack>
      ) : null}
    </>
  );
}

/** A reading's number as the card's other numbers are drawn: its label over its value. */
function ReadingMetric({ label, value, testId, first = false }: { label: string; value: string; testId: string; first?: boolean }) {
  return (
    <Box data-testid={testId} sx={{ minWidth: 0, gridColumnStart: first ? 1 : 'auto' }}>
      <Typography variant="label" component="div" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="body1" component="div" sx={valueStyle}>
        {value}
      </Typography>
    </Box>
  );
}
