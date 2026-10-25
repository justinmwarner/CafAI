/**
 * Settings > Display > Shot cards > Show TDS and extraction (D246): on, as
 * every shot card was (D162), or off for a barista without a refractometer,
 * which takes the "TDS · Add" cell and a reading's EY off the shot cards and
 * a shot's line in History. A TDS already given stays on the shot and the
 * coach still reads it; only the screens leave it out. Applied at once and
 * saved with the other settings (DisplayPrefsStore, src/app/displayPrefs.ts),
 * its error as the screensaver's. Without the store (a preview) it draws
 * nothing, as the drink screens do: there is nowhere to keep a choice.
 */
import { useId, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import type { DisplayPrefsStore } from '../../app/displayPrefs.ts';
import { useOptionalServices, useShowTds } from '../../app/services.tsx';
import { TID } from '../testIds.ts';

/** The switch's test id, as kept with the rest in TID (src/ui/testIds.ts). */
export const SHOW_TDS_TID = TID.showTds;

export const SHOW_TDS_LINE = "On shot cards and in History, for a refractometer's reading.";

/** MUI's switch is 38 px tall: the label around it, which toggles it too, is the 48 px touch target. */
const switchLabelSx = { minHeight: 48, mr: 0 } as const;

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function ShowTdsSwitch({ store }: { store: DisplayPrefsStore }) {
  const shown = useShowTds();
  const lineId = useId();
  const [error, setError] = useState<string | null>(null);
  const latestSave = useRef(0);

  const save = (next: boolean) => {
    const ticket = ++latestSave.current;
    setError(null);
    store.setShowTds(next).catch((reason: unknown) => {
      // Only the newest change speaks: one made after this that saved carried this one with it.
      if (ticket === latestSave.current) setError(`Could not save the TDS setting: ${errorText(reason)}`);
    });
  };

  return (
    <Box>
      <FormControlLabel
        control={
          <Switch
            checked={shown}
            onChange={(event) => save(event.target.checked)}
            slotProps={{ input: { 'aria-describedby': lineId, 'data-testid': SHOW_TDS_TID } }}
          />
        }
        label="Show TDS and extraction"
        sx={switchLabelSx}
      />
      <Typography id={lineId} variant="body2" sx={{ color: 'text.secondary' }}>
        {SHOW_TDS_LINE}
      </Typography>
      {error ? (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mt: 1.5 }}>
          {error}
        </Alert>
      ) : null}
    </Box>
  );
}

export function ShowTdsRow() {
  const store = useOptionalServices()?.displayPrefs;
  return store ? <ShowTdsSwitch store={store} /> : null;
}
