/**
 * Settings > About > CafAI and Decaid: CafAI's version, then Decaid's against
 * the one CafAI was verified with, and anything Decaid sent that CafAI did
 * not expect (AboutDecaid.tsx, 4.6, D96). Decaid's version is the host's,
 * or Decaid's answer to GET /api/v1/info each time the card opens
 * (decaidVersion.ts); the log's header reads it too.
 */
import Typography from '@mui/material/Typography';
import { useServices } from '../../app/services.tsx';
import { AboutDecaid } from './AboutDecaid.tsx';
import { useDecaidVersion } from './decaidVersion.ts';
import { Section } from './Section.tsx';

export const ABOUT_CARD_TITLE = 'CafAI and Decaid';

export function AboutCard() {
  const { appVersion } = useServices();
  const decaidVersion = useDecaidVersion();
  return (
    <Section title={ABOUT_CARD_TITLE}>
      <Typography variant="body2">CafAI {appVersion}</Typography>
      <AboutDecaid decaidVersion={decaidVersion} />
    </Section>
  );
}
