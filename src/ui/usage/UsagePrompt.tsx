/**
 * Usage sharing's card and notice (D-USAGE-3), at the foot of the chat in
 * the prompt row: the device's, never the bag's, so never in a transcript,
 * the backup or an export. The card asks first (Europe, D-USAGE-2); the
 * notice tells, elsewhere. Each stays until answered, and nothing waits on it.
 */
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useOptionalServices } from '../../app/services.tsx';
import { outsideLinkProps } from '../care/videoPlace.ts';
import { TID } from '../testIds.ts';
import { useUsage } from './useUsage.ts';

export const PRIVACY_URL = 'https://github.com/justinmwarner/CafAI#privacy';

const CARD = {
  title: 'Help improve CafAI?',
  body: 'Share how you use CafAI with its developer through Microsoft Clarity: the screens you open, where you tap and scroll, and steps such as a shot read or a change confirmed. All text is hidden: never your words, your coffee or your key. Settings > About turns it off.',
  yes: 'Yes, share',
  no: 'No thanks',
};

const NOTICE = {
  title: null,
  body: 'CafAI shares how you use it with its developer through Microsoft Clarity: screens, taps and steps such as a shot read, with all text hidden. Settings > About turns it off.',
  yes: 'OK',
  no: 'Turn off',
};

export function UsagePrompt() {
  const { usage, state } = useUsage();
  const insideDecaid = useOptionalServices()?.host.insideDecaid ?? false;
  if (!usage || !state?.prompt) return null;
  const words = state.prompt === 'card' ? CARD : NOTICE;
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label="Usage sharing"
      data-testid={TID.usagePrompt}
      sx={{ flexBasis: '100%', p: 1.5, bgcolor: 'background.paper' }}
    >
      {words.title ? (
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, mb: 0.5 }}>
          {words.title}
        </Typography>
      ) : null}
      <Typography variant="body2">{words.body}</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1 }}>
        <Button variant="contained" data-testid={TID.usageYes} onClick={() => usage.choose(true)} sx={{ minHeight: 48 }}>
          {words.yes}
        </Button>
        <Button variant="text" data-testid={TID.usageNo} onClick={() => usage.choose(false)} sx={{ minHeight: 48 }}>
          {words.no}
        </Button>
        <Link href={PRIVACY_URL} {...outsideLinkProps({ insideDecaid })} variant="body2" sx={{ ml: 'auto' }}>
          What is shared
        </Link>
      </Box>
    </Paper>
  );
}
