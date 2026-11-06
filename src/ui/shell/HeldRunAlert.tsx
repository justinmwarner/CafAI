/**
 * The new bag screen's line about a run that stayed off the screen (D277):
 * the machine started a shot, steam, a flush or hot water while the barista
 * was setting up a bag, so the screen stayed where it was. The line says
 * what runs and offers its view; the barista goes there with a tap, or
 * dismisses the line for this run. It goes by itself when the run ends.
 */
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import CloseRounded from '@mui/icons-material/CloseRounded';
import { TID } from '../testIds.ts';
import type { RunKind } from './bagSetup.ts';

/** What runs, as the line says it, and the view its button opens. */
const WORDS: Readonly<Record<RunKind, { running: string; open: string }>> = {
  shot: { running: 'A shot is running.', open: 'Open the shot' },
  steam: { running: 'Steam is running.', open: 'Open Steam' },
  flush: { running: 'A flush is running.', open: 'Open Flush' },
  hotWater: { running: 'Hot water is running.', open: 'Open Hot water' },
};

/** The line's sentence after what runs: why the screen stayed. */
export const STAYED = 'You are setting up a bag, so CafAI stayed on this screen.';

export interface HeldRunAlertProps {
  kind: RunKind;
  onOpen(): void;
  onDismiss(): void;
}

export function HeldRunAlert({ kind, onOpen, onDismiss }: HeldRunAlertProps) {
  const words = WORDS[kind];
  return (
    <Alert
      severity="info"
      role="status"
      data-testid={TID.heldRun}
      sx={{
        flex: 'none',
        mx: 1.5,
        mt: 1,
        alignItems: 'center',
        '& .MuiAlert-message': { py: 0.5 },
        '& .MuiAlert-action': { pt: 0, alignItems: 'center' },
      }}
      action={
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Button color="inherit" data-testid={TID.heldRunOpen} onClick={onOpen} sx={{ minHeight: 48, whiteSpace: 'nowrap' }}>
            {words.open}
          </Button>
          <IconButton color="inherit" aria-label="Dismiss" data-testid={TID.heldRunDismiss} onClick={onDismiss}>
            <CloseRounded />
          </IconButton>
        </Stack>
      }
    >
      <strong>{words.running}</strong> {STAYED}
    </Alert>
  );
}
