/** One titled card of the Settings screen, named for assistive tech by its title. */
import type { ReactNode } from 'react';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" component="section" aria-label={title} sx={{ p: 2, bgcolor: 'background.paper' }}>
      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, mb: 1 }}>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}
