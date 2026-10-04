import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type { NoticeProgress } from '../../../app/types.ts';
import type { NoticeTone } from './types.ts';

const ICONS = {
  info: InfoOutlinedIcon,
  success: CheckCircleIcon,
  warning: WarningAmberIcon,
  error: ErrorIcon,
} as const;

/**
 * One line from the app itself (not the model), e.g. "Shot saved" or "Upload
 * failed". With `progress` it says what CafAI is doing right now (loading a
 * profile, looking for a shot) and shows a bar: open-ended while the length is
 * unknown, filling up otherwise.
 */
export function Notice({ tone, text, progress }: { tone: NoticeTone; text: string; progress?: NoticeProgress }) {
  const Icon = ICONS[tone];
  const line = (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', color: tone === 'info' ? 'text.secondary' : `${tone}.main` }}>
      <Icon fontSize="small" sx={{ mt: '2px' }} />
      <Typography variant="body2" sx={{ color: tone === 'info' ? 'text.secondary' : 'text.primary', flex: progress ? 1 : undefined }}>
        {text}
      </Typography>
      {progress?.label ? (
        <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', pt: '2px' }}>
          {progress.label}
        </Typography>
      ) : null}
    </Stack>
  );
  if (progress) {
    return (
      <Box role="status" data-tone={tone} sx={{ my: 0.25, maxWidth: 480 }}>
        {line}
        <LinearProgress
          variant={progress.value === null ? 'indeterminate' : 'determinate'}
          {...(progress.value === null ? {} : { value: Math.round(Math.min(1, Math.max(0, progress.value)) * 100) })}
          aria-label={text}
          sx={{ mt: 0.75, ml: 3.5, borderRadius: 1 }}
        />
      </Box>
    );
  }
  return (
    <Box role={tone === 'error' ? 'alert' : 'status'} data-tone={tone} sx={{ my: 0.25 }}>
      {line}
    </Box>
  );
}
