/**
 * Settings > Data and privacy > Share usage (D212): the usage switch, which
 * was About's, on every device under either rule; a change is the device's
 * answer. A card of its own (ShareUsageSection), left out with the switch
 * where the build shares nothing.
 */
import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { TID } from '../testIds.ts';
import { useUsage } from '../usage/useUsage.ts';
import { Section } from './Section.tsx';

export const SHARE_USAGE_TITLE = 'Share usage';

const switchLabelSx = { minHeight: 48 } as const;

export function UsageRow() {
  const { usage, state } = useUsage();
  if (!usage || !state) return null;
  return (
    <Box>
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

/** The switch in its card; nothing where the build shares nothing. */
export function ShareUsageSection() {
  const { usage, state } = useUsage();
  if (!usage || !state) return null;
  return (
    <Section title={SHARE_USAGE_TITLE}>
      <UsageRow />
    </Section>
  );
}
