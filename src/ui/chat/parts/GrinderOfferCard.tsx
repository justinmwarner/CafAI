import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import type { OfferGrinder } from '../../../coach/contract.ts';
import { TID } from '../../testIds.ts';
import { setAsideNote } from '../format.ts';
import type { GrinderOfferPart } from './types.ts';

export interface GrinderOfferCardProps {
  part: GrinderOfferPart;
  /** True while the coach is working; blocks a second tap. */
  disabled?: boolean;
  onAdd(): void;
  onDecline(): void;
}

/** A step as people write it: 0.5, 2, 0.25 (never 0.30000000000000004). */
const step = (value: number) => String(Math.round(value * 1000) / 1000);

/** A long list of settings, shortened: "1, 2, 3 … 40". */
function settingsPreview(values: readonly string[]): string {
  return values.length <= 5 ? values.join(', ') : `${values.slice(0, 3).join(', ')} … ${values[values.length - 1]}`;
}

/** How the dial moves, as the coach heard it; null when the barista did not say. */
export function dialLine(grinder: OfferGrinder): string | null {
  if (grinder.settingType === 'preset' || (grinder.settingType === null && grinder.values !== null)) {
    const values = grinder.values ?? [];
    if (values.length === 0) return 'A list of settings.';
    return `${values.length} ${values.length === 1 ? 'setting' : 'settings'}: ${settingsPreview(values)}.`;
  }
  const small = grinder.smallStep;
  if (small !== null) return `A numbered dial, in steps of ${step(small)}${grinder.bigStep !== null ? ` (big steps ${step(grinder.bigStep)})` : ''}.`;
  return grinder.settingType === 'numeric' ? 'A numbered dial.' : null;
}

/** The dial says nothing CafAI can move it by: the coach then gives directions only (D73). */
function withoutSteps(grinder: OfferGrinder): boolean {
  return grinder.settingType === 'preset' || grinder.values !== null ? (grinder.values ?? []).length === 0 : grinder.smallStep === null;
}

/** An answer given on the card, in the accent with a check, where its buttons were. */
function Done({ text }: { text: string }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: 'primary.main', mt: 1 }}>
      <CheckCircleIcon fontSize="small" />
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {text}
      </Typography>
    </Stack>
  );
}

/**
 * The coach's offer to add the barista's grinder to Decaid's grinder library
 * (D125): what the coach heard (the grinder, its burrs, how its dial moves),
 * then Add to Decaid or Not now. Nothing is added before Add; then CafAI adds
 * it, or takes the one Decaid already has, and links it as Settings does. A
 * failed Add says why and stays open to tap again. Answered, it stays in the
 * chat, closed.
 */
export function GrinderOfferCard({ part, disabled = false, onAdd, onDecline }: GrinderOfferCardProps) {
  const { grinder, status } = part;
  const open = status === 'pending' || status === 'adding';
  const adding = status === 'adding';
  const dial = dialLine(grinder);
  const facts = [grinder.burrs?.trim() ? `Burrs: ${grinder.burrs.trim()}.` : null, dial].filter(Boolean).join(' ');

  return (
    <Paper
      variant="outlined"
      data-testid={TID.grinderOffer}
      component="section"
      aria-label="Add your grinder to Decaid"
      sx={{
        p: 1.5,
        my: 0.5,
        bgcolor: 'background.paper',
        color: status === 'expired' ? 'text.secondary' : 'text.primary',
        borderColor: open ? 'primary.main' : 'divider',
        borderWidth: open ? 2 : 1,
      }}
    >
      <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
        Add {grinder.model} to Decaid&apos;s grinders?
      </Typography>
      {facts ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
          {facts}
        </Typography>
      ) : null}
      {open ? (
        <>
          <Typography variant="body2" sx={{ mt: 0.75 }}>
            Decaid and your other skins will list it, and CafAI uses it from then on
            {withoutSteps(grinder) ? ': without its step size the coach gives directions only.' : '.'}
          </Typography>
          {part.error ? (
            <Typography variant="body2" role="alert" sx={{ color: 'error.main', mt: 0.75 }}>
              Couldn&apos;t add it: {part.error} Try again, or tap Not now.
            </Typography>
          ) : null}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
            <Button
              variant="contained"
              disabled={disabled || adding}
              onClick={onAdd}
              data-testid={TID.grinderOfferAdd}
              startIcon={adding ? <CircularProgress size={16} color="inherit" /> : undefined}
              sx={{ minHeight: 48, px: 3 }}
            >
              {adding ? 'Adding…' : 'Add to Decaid'}
            </Button>
            <Button disabled={disabled || adding} onClick={onDecline} data-testid={TID.grinderOfferDecline} sx={{ minHeight: 48 }}>
              Not now
            </Button>
          </Box>
        </>
      ) : null}
      {status === 'added' ? <Done text={`Added to Decaid's grinders: CafAI uses ${part.linkedName ?? grinder.model} now.`} /> : null}
      {status === 'existing' ? <Done text={`Decaid already had ${part.linkedName ?? grinder.model}: CafAI uses it now.`} /> : null}
      {status === 'declined' ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.75 }}>
          Not added.
        </Typography>
      ) : null}
      {status === 'expired' ? (
        <Typography variant="body2" sx={{ mt: 0.75 }}>
          {setAsideNote(part.setAsideReason, 'Set aside: you typed in the chat instead.')} Nothing was added.
        </Typography>
      ) : null}
    </Paper>
  );
}
