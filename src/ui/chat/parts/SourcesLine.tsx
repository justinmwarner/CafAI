import Typography from '@mui/material/Typography';
import { TID } from '../../testIds.ts';

/**
 * The sites the coach's words just above cite (D203), as plain text, never
 * links, in the fact card's "Source:" style: Anthropic asks that search
 * results shown to people say where they came from.
 */
export function SourcesLine({ sites }: { sites: readonly string[] }) {
  return (
    <Typography variant="body2" data-testid={TID.sourcesLine} sx={{ color: 'text.secondary', mt: 0.5, overflowWrap: 'anywhere' }}>
      {sites.length === 1 ? 'Source' : 'Sources'}: {sites.join(', ')}
    </Typography>
  );
}
