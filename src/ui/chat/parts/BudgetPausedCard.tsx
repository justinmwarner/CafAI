import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import PauseCircleOutlineRounded from '@mui/icons-material/PauseCircleOutlineRounded';
import { pausedLine } from '../../../spend/budget.ts';
import { requestUsageReveal } from '../../../spend/reveal.ts';
import { routeHref } from '../../router.ts';

/** The card's test ids, here until they join src/ui/testIds.ts (the layout's file). */
export const BUDGET_PAUSED_TID = {
  card: 'budget-paused',
  openSettings: 'budget-paused-open-settings',
} as const;

/** Settings > Coach, where the usage card holds the budget (D233). */
const COACH_SETTINGS = routeHref({ name: 'settings', group: 'coach' });

export interface BudgetPausedCardProps {
  /** The budget it reached, whole dollars. */
  budgetUsd: number;
  /** 'YYYY-MM-DD': the first of next month, when the pause lifts by itself. */
  resumesOn: string;
}

/**
 * The coach paused by the month's budget (D240), in place of its reply: what
 * reached the budget and when the coach starts again by itself, in the
 * warning colour's pause mark beside the words, then Open Settings, which
 * brings the usage card into view on the Coach page. Raised or cleared there,
 * or with the pause turned off, the reply that waited goes; the card stays in
 * the chat as it was.
 */
export function BudgetPausedCard({ budgetUsd, resumesOn }: BudgetPausedCardProps) {
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label="The coach is paused"
      data-testid={BUDGET_PAUSED_TID.card}
      sx={{ p: 1.5, my: 0.5, bgcolor: 'background.paper' }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <PauseCircleOutlineRounded fontSize="small" aria-hidden sx={{ color: 'warning.main', mt: '2px' }} />
        <Typography variant="body2">{pausedLine(budgetUsd, resumesOn)}</Typography>
      </Stack>
      <Button
        variant="contained"
        href={COACH_SETTINGS}
        onClick={requestUsageReveal}
        data-testid={BUDGET_PAUSED_TID.openSettings}
        sx={{ mt: 1.5, minHeight: 48, px: 3 }}
      >
        Open Settings
      </Button>
    </Paper>
  );
}
