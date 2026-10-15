/**
 * Settings > Machine care (D152): the way into the cleaning guide (#/care).
 * Nothing here is a setting yet; the reminders, the third machine care item,
 * will add the water's hardness.
 */
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import CleaningServicesRoundedIcon from '@mui/icons-material/CleaningServicesRounded';
import { routeHref } from '../router.ts';
import { TID } from '../testIds.ts';
import { Section } from './Section.tsx';

export const CARE_LINE = "What to clean every day, week and month, with Decent's video.";

export function CareSection() {
  return (
    <Section title="Machine care">
      <Box data-testid={TID.careSection}>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
          {CARE_LINE}
        </Typography>
        <Button
          variant="tonal"
          href={routeHref({ name: 'care', routine: 'daily' })}
          startIcon={<CleaningServicesRoundedIcon />}
          data-testid={TID.careOpen}
          sx={{ minHeight: 48 }}
        >
          Cleaning guide
        </Button>
      </Box>
    </Section>
  );
}
