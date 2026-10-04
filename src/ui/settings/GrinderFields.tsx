/**
 * The grinder fields of the Settings screen: a picker over Decaid's grinder
 * library (or today's free-text name when Decaid has none to offer), the line
 * that says what CafAI will use, and the current setting (a list for a preset
 * grinder). State and saving live in SettingsScreen.tsx; the rules in
 * grinderPicker.ts.
 */
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { TID } from '../testIds.ts';
import {
  grinderLabel,
  LIBRARY_HINT,
  missingGrinderLabel,
  MISSING_LINE,
  NOT_LISTED,
  presetOptions,
  stepLine,
  usesPresetSetting,
  type GrinderForm,
  type GrinderLibrary,
} from './grinderPicker.ts';

const fieldSx = { '& .MuiInputBase-root': { minHeight: 48 } } as const;
/** A native select opens only from the select element itself, so it is the 48 px target. */
const selectSx = { ...fieldSx, '& .MuiNativeSelect-select': { py: '12.5px' } } as const;

export interface GrinderFieldsProps {
  form: GrinderForm | null;
  library: GrinderLibrary;
  /** The saved grinder name, to label a link Decaid no longer lists. */
  savedName: string | null;
  disabled: boolean;
  onChange(patch: Partial<GrinderForm>): void;
}

export function GrinderFields({ form, library, savedName, disabled, onChange }: GrinderFieldsProps) {
  const pick = form?.pick ?? NOT_LISTED;
  const grinders = library.status === 'ready' ? library.grinders : [];
  const picked = grinders.find((grinder) => grinder.id === pick) ?? null;
  const lostLink = library.status === 'ready' && pick !== NOT_LISTED && picked === null;
  const showName = library.status === 'unavailable' || pick === NOT_LISTED;
  const line = picked ? stepLine(picked) : lostLink ? MISSING_LINE : LIBRARY_HINT;
  const preset = picked !== null && usesPresetSetting(picked);

  return (
    <>
      {library.status !== 'unavailable' ? (
        <TextField
          select
          size="small"
          label="Grinder from Decaid"
          value={pick}
          disabled={disabled || library.status !== 'ready'}
          onChange={(event) => onChange({ pick: event.target.value })}
          helperText={library.status === 'ready' ? line : ' '}
          sx={selectSx}
          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
        >
          {library.status === 'loading' ? <option value={pick}>Loading Decaid's grinders…</option> : null}
          {lostLink ? <option value={pick}>{missingGrinderLabel(savedName)}</option> : null}
          {grinders.map((grinder) => (
            <option key={grinder.id} value={grinder.id}>
              {grinderLabel(grinder)}
            </option>
          ))}
          {library.status === 'ready' ? <option value={NOT_LISTED}>Not in Decaid's list</option> : null}
        </TextField>
      ) : null}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: showName ? '3fr 2fr' : '1fr 1fr' } }}>
        {showName ? (
          <TextField
            size="small"
            label="Grinder"
            placeholder="e.g. Niche Zero"
            value={form?.name ?? ''}
            disabled={disabled}
            onChange={(event) => onChange({ name: event.target.value })}
            sx={fieldSx}
            slotProps={{ htmlInput: { 'data-testid': TID.grinderName, maxLength: 60 }, inputLabel: { shrink: true } }}
          />
        ) : null}
        {preset && picked ? (
          <TextField
            select
            size="small"
            label="Current grinder setting"
            value={form?.setting ?? ''}
            disabled={disabled}
            onChange={(event) => onChange({ setting: event.target.value })}
            sx={selectSx}
            slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
          >
            {presetOptions(picked, form?.setting ?? '').map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </TextField>
        ) : (
          <TextField
            size="small"
            label="Current grinder setting"
            placeholder="e.g. 14"
            value={form?.setting ?? ''}
            disabled={disabled}
            onChange={(event) => onChange({ setting: event.target.value })}
            sx={fieldSx}
            slotProps={{ htmlInput: { 'data-testid': TID.grinderSetting, maxLength: 20 }, inputLabel: { shrink: true } }}
          />
        )}
      </Box>
      {library.status === 'unavailable' ? (
        <Typography variant="body2" sx={{ mt: -1 }}>
          {LIBRARY_HINT}
        </Typography>
      ) : null}
    </>
  );
}
