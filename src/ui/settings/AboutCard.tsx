/**
 * Settings > About > CafAI and Decaid: CafAI's version, then Decaid's against
 * the one CafAI was verified with, and anything Decaid sent that CafAI did
 * not expect (AboutDecaid.tsx, 4.6, D96); then what's new in this version
 * and a way to report a problem (WhatsNew.tsx, ReportProblem.tsx, D248).
 * Decaid's version is the host's, or Decaid's answer to GET /api/v1/info each
 * time the card opens (decaidVersion.ts); the log's header reads it too.
 */
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useServices } from '../../app/services.tsx';
import { AboutDecaid } from './AboutDecaid.tsx';
import { useDecaidVersion } from './decaidVersion.ts';
import { ReportProblem } from './ReportProblem.tsx';
import { Section } from './Section.tsx';
import { WhatsNew } from './WhatsNew.tsx';

export const ABOUT_CARD_TITLE = 'CafAI and Decaid';

export function AboutCard() {
  const { appVersion } = useServices();
  const decaidVersion = useDecaidVersion();
  return (
    <Section title={ABOUT_CARD_TITLE}>
      <Typography variant="body2">CafAI {appVersion}</Typography>
      <AboutDecaid decaidVersion={decaidVersion} />
      <Box sx={{ display: 'grid', gap: 2, mt: 2, justifyItems: 'start' }}>
        <WhatsNew />
        <ReportProblem />
      </Box>
    </Section>
  );
}
