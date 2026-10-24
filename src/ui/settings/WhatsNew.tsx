/**
 * About > What's new (D248): a tonal button, "What's new in 0.1.3", that
 * opens the running version's section of the changelog in a dialog
 * (whatsNew.ts), drawn as How to taste's: headings, paragraphs and bullets
 * in the body's size, bold words at 600. Not there when this version has no
 * section (a dev build's own version, a fork's). Nothing to fetch: the
 * changelog is in the bundle.
 */
import { useId, useMemo, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import ArticleRoundedIcon from '@mui/icons-material/ArticleRounded';
import { useServices } from '../../app/services.tsx';
import { formatDate } from '../chat/format.ts';
import { whatsNew, type NotesBlock, type Span } from './whatsNew.ts';

/** The button's and the dialog's test ids, for TID (src/ui/testIds.ts) once they have their place in About. */
export const WHATS_NEW_TID = {
  whatsNew: 'whats-new',
  whatsNewDialog: 'whats-new-dialog',
} as const;

function Words({ spans }: { spans: readonly Span[] }) {
  return (
    <>
      {spans.map((span, i): ReactNode => {
        if (span.strong) {
          return (
            <Box key={i} component="strong" sx={{ fontWeight: 600 }}>
              {span.text}
            </Box>
          );
        }
        if (span.code) {
          return (
            <Box key={i} component="code" sx={{ fontFamily: 'monospace', fontSize: '0.9em', overflowWrap: 'anywhere' }}>
              {span.text}
            </Box>
          );
        }
        return span.text;
      })}
    </>
  );
}

function Block({ block, first }: { block: NotesBlock; first: boolean }) {
  if (block.kind === 'heading') {
    return (
      <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700, mt: first ? 0 : 2.5, mb: 0.5 }}>
        <Words spans={block.spans} />
      </Typography>
    );
  }
  if (block.kind === 'paragraph') {
    return (
      <Typography variant="body1" sx={{ mt: first ? 0 : 1 }}>
        <Words spans={block.spans} />
      </Typography>
    );
  }
  return (
    <Box component="ul" sx={{ pl: 2.5, my: 1, display: 'grid', gap: 1 }}>
      {block.items.map((spans, i) => (
        <Typography key={i} component="li" variant="body1">
          <Words spans={spans} />
        </Typography>
      ))}
    </Box>
  );
}

export function WhatsNew() {
  const { appVersion } = useServices();
  const notes = useMemo(() => whatsNew(appVersion), [appVersion]);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  if (!notes) return null;
  const title = `What's new in ${notes.version}`;
  return (
    <>
      <Button
        variant="tonal"
        // Release notes to read: a page, not Material's "new releases" seal, whose "!" reads as a warning in About.
        startIcon={<ArticleRoundedIcon />}
        data-testid={WHATS_NEW_TID.whatsNew}
        onClick={() => setOpen(true)}
        sx={{ minHeight: 48 }}
      >
        {title}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="sm"
        aria-labelledby={titleId}
        data-testid={WHATS_NEW_TID.whatsNewDialog}
      >
        <DialogTitle id={titleId}>{title}</DialogTitle>
        <DialogContent>
          {notes.date ? (
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              Released {formatDate(notes.date)}
            </Typography>
          ) : null}
          {notes.blocks.map((block, i) => (
            <Block key={i} block={block} first={i === 0} />
          ))}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button variant="contained" onClick={() => setOpen(false)} sx={{ minHeight: 48, px: 3 }}>
            Done
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
