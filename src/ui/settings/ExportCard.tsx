/**
 * Settings > Data and privacy > Your data (D244): Export, the same file and
 * dialog as History's (src/ui/data/ExportData.tsx), so the barista finds it
 * where the backup and the log are. History keeps its own Export, and
 * Import stays there. Nothing is read until the tap.
 */
import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { useExportData } from '../data/ExportData.tsx';
import { Section } from './Section.tsx';
import { TID } from '../testIds.ts';

/** The card's test ids, for TID (src/ui/testIds.ts) once the card has its place in the Data and privacy group. */
export const EXPORT_CARD_TID = {
  /** The card's Export button; History's keeps TID.exportData. */
  settingsExport: TID.settingsExport,
  /** The line under it when an export failed. */
  settingsExportSaid: TID.settingsExportSaid,
} as const;

export const EXPORT_CARD_LINE = 'Your bags, versions and shots, as a file to keep or move to another device. Never your API key.';

export function ExportCard() {
  const { working, start, dialog } = useExportData();
  const [failed, setFailed] = useState<string | null>(null);

  const onExport = () => {
    setFailed(null);
    void start().then(setFailed);
  };

  return (
    <Section title="Your data">
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
        {EXPORT_CARD_LINE}
      </Typography>
      <Box>
        <Button
          variant="tonal"
          startIcon={working ? <CircularProgress size={16} /> : <FileDownloadIcon />}
          data-testid={EXPORT_CARD_TID.settingsExport}
          disabled={working}
          onClick={onExport}
          sx={{ minHeight: 48 }}
        >
          Export
        </Button>
      </Box>
      {failed ? (
        <Typography variant="body2" role="alert" data-testid={EXPORT_CARD_TID.settingsExportSaid} sx={{ color: 'error.main', mt: 1 }}>
          {failed}
        </Typography>
      ) : null}
      {dialog}
    </Section>
  );
}
