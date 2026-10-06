import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import type { SetAsideReason, TemplateCardItem } from '../../../app/types.ts';
import type { Confidence } from '../../../coach/contract.ts';
import { TID } from '../../testIds.ts';
import { confidenceLabel, setAsideNote } from '../format.ts';

const CONFIDENCE_COLOR: Record<Confidence, 'success' | 'primary' | 'default'> = {
  high: 'success',
  medium: 'primary',
  low: 'default',
};

export interface TemplateCardsProps {
  items: readonly TemplateCardItem[];
  pickedTemplateId: string | null;
  /** True while the coach is working; blocks a second tap. */
  disabled?: boolean;
  /** Set aside unanswered (the barista typed instead of picking, say): the suggestions are closed. */
  expired?: boolean;
  /** Why they were set aside, for the note above the cards. */
  setAsideReason?: SetAsideReason;
  onPick(templateId: string): void;
}

/** The model's starting-profile suggestions. Tapping "Use this" creates and loads v1. */
export function TemplateCards({ items, pickedTemplateId, disabled = false, expired = false, setAsideReason, onPick }: TemplateCardsProps) {
  const locked = pickedTemplateId !== null || expired;
  return (
    <Stack spacing={1} role="list" aria-label="Suggested starting profiles" sx={{ my: 0.5 }}>
      {expired && pickedTemplateId === null ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {setAsideNote(setAsideReason, 'Set aside: you replied in the chat instead.')} Ask the coach to suggest again.
        </Typography>
      ) : null}
      {items.map((item) => {
        const picked = item.templateId === pickedTemplateId;
        return (
          <Paper
            key={item.templateId}
            role="listitem"
            variant="outlined"
            data-testid={TID.templateCard(item.templateId)}
            aria-current={picked ? 'true' : undefined}
            sx={{
              p: 1.5,
              bgcolor: 'background.paper',
              borderColor: picked ? 'primary.main' : 'divider',
              borderWidth: picked ? 2 : 1,
              opacity: locked && !picked ? 0.55 : 1,
            }}
          >
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
                    {item.name}
                  </Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    color={CONFIDENCE_COLOR[item.confidence]}
                    label={confidenceLabel(item.confidence)}
                    sx={{ minHeight: 0 }}
                  />
                </Stack>
                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
                  {item.style} · {item.shape}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.75 }}>
                  {item.reason}
                </Typography>
              </Box>
              {picked ? (
                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{ alignItems: 'center', color: 'primary.main', minHeight: 48, flexShrink: 0 }}
                >
                  <CheckCircleIcon fontSize="small" />
                  <Typography variant="button" sx={{ textTransform: 'none' }}>
                    In use
                  </Typography>
                </Stack>
              ) : (
                <Button
                  variant={locked ? 'text' : 'contained'}
                  data-testid={TID.templatePick(item.templateId)}
                  disabled={disabled || locked}
                  onClick={() => onPick(item.templateId)}
                  sx={{ minHeight: 48, flexShrink: 0, px: 2 }}
                >
                  Use this
                </Button>
              )}
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );
}
