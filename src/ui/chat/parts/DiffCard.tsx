import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import BackHandIcon from '@mui/icons-material/BackHandOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import UndoIcon from '@mui/icons-material/Undo';
import { TID } from '../../testIds.ts';
import { splitDiffLine } from '../format.ts';
import type { DiffPart } from './types.ts';

export interface DiffCardProps {
  part: DiffPart;
  /** True while the coach is working; blocks Confirm / Not now / Undo. */
  disabled?: boolean;
  /** Show Undo: the change can be undone and this is the latest applied card. */
  showUndo: boolean;
  onConfirm(): void;
  onDecline(): void;
  onUndo(): void;
}

// '&&' doubles the class so these lists beat the chat bubble's own ul/ol
// indentation, which would otherwise win on specificity.
const listSx = { '&&': { listStyle: 'none', p: 0, m: 0, mt: 1, display: 'grid', gap: 0.5 } } as const;

function DiffLine({ line }: { line: string }) {
  const parts = splitDiffLine(line);
  if (!parts) {
    return (
      <Typography component="li" variant="body1">
        {line}
      </Typography>
    );
  }
  return (
    <Typography component="li" variant="body1">
      <Box component="span" sx={{ color: 'text.secondary' }}>
        {parts.label}:{' '}
      </Box>
      <Box component="span" sx={{ color: 'text.secondary', textDecoration: 'line-through' }}>
        {parts.before}
      </Box>
      <ArrowForwardIcon
        aria-label="changes to"
        sx={{ fontSize: '1rem', mx: 0.75, verticalAlign: 'middle', color: 'text.secondary' }}
      />
      <Box component="span" sx={{ fontWeight: 600 }}>
        {parts.after}
      </Box>
    </Typography>
  );
}

function StatusLine({ part, showUndo, disabled, onUndo }: Pick<DiffCardProps, 'part' | 'showUndo' | 'disabled' | 'onUndo'>) {
  switch (part.status) {
    case 'applying':
      return (
        <Box role="status">
          <Typography variant="body2" sx={{ mb: 0.75 }}>
            {part.versionLabel ? `Loading ${part.versionLabel} onto the machine…` : 'Saving…'}
          </Typography>
          <LinearProgress />
        </Box>
      );
    case 'applied':
      return (
        <Stack direction="row" spacing={1} useFlexGap role="status" sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <CheckCircleIcon color="success" fontSize="small" />
          <Typography variant="body1" sx={{ flex: 1, fontWeight: 600 }}>
            {part.versionLabel ? `Loaded as ${part.versionLabel}` : 'Confirmed. Make the change before your next shot.'}
          </Typography>
          {showUndo ? (
            <Button
              variant="outlined"
              startIcon={<UndoIcon />}
              data-testid={TID.diffUndo}
              disabled={disabled}
              onClick={onUndo}
              sx={{ minHeight: 48 }}
            >
              Undo
            </Button>
          ) : null}
        </Stack>
      );
    case 'declined':
      return (
        <Typography variant="body2" role="status" sx={{ color: 'text.secondary' }}>
          Not applied. Nothing changed on the machine.
        </Typography>
      );
    case 'failed':
      return (
        <Stack direction="row" spacing={1} role="alert" sx={{ alignItems: 'flex-start', color: 'error.main' }}>
          <ErrorOutlineIcon fontSize="small" sx={{ mt: 0.25 }} />
          <Typography variant="body2">{part.error ?? 'The change could not be loaded onto the machine.'}</Typography>
        </Stack>
      );
    case 'undone':
      return (
        <Typography variant="body2" role="status" sx={{ color: 'text.secondary' }}>
          Undone. Back on the previous version.
        </Typography>
      );
    case 'expired':
      return (
        <Typography variant="body2" role="status" sx={{ color: 'text.secondary' }}>
          Set aside: the conversation moved on. Nothing changed on the machine.
        </Typography>
      );
    case 'pending':
      return null;
  }
}

/**
 * One proposed change as a plain-language diff. Nothing reaches the machine
 * until the barista taps Confirm.
 */
export function DiffCard({ part, disabled = false, showUndo, onConfirm, onDecline, onUndo }: DiffCardProps) {
  const pending = part.status === 'pending';
  return (
    <Paper
      variant="outlined"
      data-testid={TID.diffCard}
      data-status={part.status}
      sx={{
        p: 1.5,
        my: 0.5,
        bgcolor: 'background.paper',
        borderColor: pending ? 'primary.main' : 'divider',
        borderWidth: pending ? 2 : 1,
      }}
    >
      <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
        {part.summary}
      </Typography>

      {part.lines.length > 0 ? (
        <Box component="ul" sx={listSx}>
          {part.lines.map((line, i) => (
            <DiffLine key={i} line={line} />
          ))}
        </Box>
      ) : null}

      {part.manualSteps.length > 0 ? (
        <Box component="ul" aria-label="By hand" sx={listSx}>
          {part.manualSteps.map((step, i) => (
            <Typography key={i} component="li" variant="body1" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <BackHandIcon sx={{ fontSize: '1.1rem', color: 'primary.main' }} aria-label="By hand:" />
              <Box component="span" sx={{ fontWeight: 600 }}>
                {step}
              </Box>
            </Typography>
          ))}
        </Box>
      ) : null}

      <Typography variant="body2" sx={{ mt: 1 }}>
        <Box component="span" sx={{ color: 'text.secondary' }}>
          Why:{' '}
        </Box>
        {part.rationale}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5 }}>
        <Box component="span" sx={{ color: 'text.secondary' }}>
          Expect:{' '}
        </Box>
        {part.expectedEffect}
      </Typography>

      {pending ? (
        <>
          {part.error ? (
            <Stack direction="row" spacing={1} role="alert" sx={{ mt: 1, alignItems: 'flex-start', color: 'error.main' }}>
              <ErrorOutlineIcon fontSize="small" sx={{ mt: 0.25 }} />
              <Typography variant="body2">{part.error}</Typography>
            </Stack>
          ) : null}
          <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
            {part.versionLabel
              ? `Confirm saves this as ${part.versionLabel} and loads it onto the machine.`
              : 'No new profile: this is a change you make by hand.'}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1.25 }}>
            <Button
              variant="contained"
              data-testid={TID.diffConfirm}
              disabled={disabled}
              onClick={onConfirm}
              sx={{ minHeight: 48, px: 3 }}
            >
              Confirm
            </Button>
            <Button
              variant="text"
              data-testid={TID.diffCancel}
              disabled={disabled}
              onClick={onDecline}
              sx={{ minHeight: 48, px: 2 }}
            >
              Not now
            </Button>
          </Stack>
        </>
      ) : (
        <Box sx={{ mt: 1.25 }}>
          <StatusLine part={part} showUndo={showUndo} disabled={disabled} onUndo={onUndo} />
        </Box>
      )}
    </Paper>
  );
}
