import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { TID } from '../../testIds.ts';
import { RichText } from '../RichText.tsx';

export interface FactCardProps {
  /** The fact, CafAI's own (D199) or the coach's (D201), read as the coach's words are. */
  text: string;
  /** The site it came from ("sca.coffee"), or null when there is none to show. */
  source: string | null;
}

/**
 * A fun fact under the coach's reply to a shot that ran like the last one on
 * a kept recipe (D197, D202): "Fun fact" in the coach's label style, the fact
 * through RichText (no links, temperatures in the barista's unit, D176), and
 * the site it came from as plain text, never a link. No icon and no accent:
 * a nicety, so it stays quiet beside the cards that ask for a tap.
 */
export function FactCard({ text, source }: FactCardProps) {
  return (
    <Paper variant="outlined" data-testid={TID.factCard} sx={{ p: 1.5, my: 0.5, bgcolor: 'background.paper' }}>
      <Typography variant="label" component="div" sx={{ color: 'text.secondary', mb: 0.25 }}>
        Fun fact
      </Typography>
      <RichText text={text} />
      {source ? (
        // A long host name breaks rather than push the card past a phone's lane.
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, overflowWrap: 'anywhere' }}>
          Source: {source}
        </Typography>
      ) : null}
    </Paper>
  );
}
