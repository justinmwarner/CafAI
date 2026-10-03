import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type { NoticeTone } from './types.ts';

const ICONS = {
  info: InfoOutlinedIcon,
  success: CheckCircleIcon,
  warning: WarningAmberIcon,
  error: ErrorIcon,
} as const;

/** One line from the app itself (not the model), e.g. "Shot saved" or "Upload failed". */
export function Notice({ tone, text }: { tone: NoticeTone; text: string }) {
  const Icon = ICONS[tone];
  return (
    <Stack
      direction="row"
      spacing={1}
      role={tone === 'error' ? 'alert' : 'status'}
      data-tone={tone}
      sx={{ alignItems: 'flex-start', my: 0.25, color: tone === 'info' ? 'text.secondary' : `${tone}.main` }}
    >
      <Icon fontSize="small" sx={{ mt: '2px' }} />
      <Typography variant="body2" sx={{ color: tone === 'info' ? 'text.secondary' : 'text.primary' }}>
        {text}
      </Typography>
    </Stack>
  );
}
