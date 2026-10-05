/**
 * The grinder fields of the Settings screen: a picker over Decaid's grinder
 * library (or today's free-text name when Decaid has none to offer), the line
 * that says what CafAI will use, and the current setting (a list for a preset
 * grinder). State and saving live in SettingsScreen.tsx; the rules in
 * grinderPicker.ts.
 */
import type { ReactNode, Ref } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { TID } from '../testIds.ts';
import {
  grinderLabel,
  grinderView,
  missingGrinderLabel,
  NOT_LISTED,
  presetOptions,
  type GrinderForm,
  type GrinderLibrary,
} from './grinderPicker.ts';

const fieldSx = { '& .MuiInputBase-root': { minHeight: 48 } } as const;
/** A native select opens only from the select element itself, so it is the 48 px target. */
const selectSx = { ...fieldSx, '& .MuiNativeSelect-select': { py: '12.5px' } } as const;

const SETTING_LABEL = 'Current grinder setting';

export interface GrinderFieldsProps {
  form: GrinderForm | null;
  library: GrinderLibrary;
  /** The saved grinder name, to label a link Decaid no longer lists. */
  savedName: string | null;
  disabled: boolean;
  onChange(patch: Partial<GrinderForm>): void;
  /** The setting control, whichever it is, so the screen can bring it into view. */
  settingRef?: Ref<HTMLDivElement>;
}

export function GrinderFields({ form, library, savedName, disabled, onChange, settingRef }: GrinderFieldsProps) {
  const pick = form?.pick ?? NOT_LISTED;
  const view = grinderView(form, library);
  const grinders = library.status === 'ready' ? library.grinders : [];

  let setting: ReactNode;
  if (view.setting === 'pending') {
    // Its kind (list or free text) is not known yet: a list must never show as free text first.
    setting = (
      <TextField
        ref={settingRef}
        size="small"
        label={SETTING_LABEL}
        placeholder="Loading…"
        value=""
        disabled
        sx={fieldSx}
        slotProps={{ inputLabel: { shrink: true } }}
      />
    );
  } else if (view.setting === 'preset' && view.picked) {
    setting = (
      <TextField
        ref={settingRef}
        select
        size="small"
        label={SETTING_LABEL}
        value={form?.setting ?? ''}
        disabled={disabled}
        onChange={(event) => onChange({ setting: event.target.value })}
        sx={selectSx}
        slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
      >
        {presetOptions(view.picked, form?.setting ?? '').map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </TextField>
    );
  } else {
    setting = (
      <TextField
        ref={settingRef}
        size="small"
        label={SETTING_LABEL}
        placeholder="e.g. 14"
        value={form?.setting ?? ''}
        disabled={disabled}
        onChange={(event) => onChange({ setting: event.target.value })}
        sx={fieldSx}
        slotProps={{ htmlInput: { 'data-testid': TID.grinderSetting, maxLength: 20 }, inputLabel: { shrink: true } }}
      />
    );
  }

  return (
    <>
      {view.picker ? (
        <TextField
          select
          size="small"
          label="Grinder from Decaid"
          value={pick}
          disabled={disabled || library.status !== 'ready'}
          onChange={(event) => onChange({ pick: event.target.value })}
          helperText={view.line ?? ' '}
          sx={selectSx}
          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
        >
          {library.status === 'loading' ? <option value={pick}>Loading Decaid's grinders…</option> : null}
          {view.lostLink ? <option value={pick}>{missingGrinderLabel(savedName)}</option> : null}
          {grinders.map((grinder) => (
            <option key={grinder.id} value={grinder.id}>
              {grinderLabel(grinder)}
            </option>
          ))}
          {library.status === 'ready' ? <option value={NOT_LISTED}>Not in Decaid's list</option> : null}
        </TextField>
      ) : null}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: view.name ? '3fr 2fr' : '1fr 1fr' } }}>
        {view.name ? (
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
        {setting}
      </Box>
      {!view.picker && view.line ? (
        <Typography variant="body2" sx={{ mt: -1 }}>
          {view.line}
        </Typography>
      ) : null}
    </>
  );
}
