/** Settings > About's usage switch (D-USAGE-3): on every device, under either rule; a change is the device's answer. */
import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { TID } from '../testIds.ts';
import { useUsage } from '../usage/useUsage.ts';

const switchLabelSx = { minHeight: 48 } as const;

export function UsageRow() {
  const { usage, state } = useUsage();
  if (!usage || !state) return null;
  return (
    <Box sx={{ mt: 1.5 }}>
      <FormControlLabel
        control={
          <Switch
            checked={state.sharing}
            onChange={(event) => usage.choose(event.target.checked)}
            slotProps={{ input: { 'data-testid': TID.usageSwitch } }}
          />
        }
        label="Share usage with CafAI's developer"
        sx={switchLabelSx}
      />
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        Screens, taps and coach steps go to Microsoft Clarity, with all text hidden.
      </Typography>
    </Box>
  );
}
