/**
 * Exporting all of CafAI's data (D244): the work behind an Export button and
 * the "Your CafAI data" dialog it opens, one component for History's header
 * and Settings > Data and privacy > Your data, so both give the same file
 * and the same dialog. Taken out of HistoryScreen.tsx as it was.
 *
 * Outside Decaid the file downloads at once and the dialog says so; inside
 * Decaid's WebView a download usually goes nowhere, so the dialog offers the
 * text to copy first (exportFile.ts). The export never holds the API key
 * (the porter leaves it out).
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { useServices } from '../../app/services.tsx';
import { copyText, downloadText, exportFileName } from '../history/exportFile.ts';

export interface ExportResult {
  json: string;
  fileName: string;
  downloaded: boolean;
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

export function ExportDialog({ result, onClose }: { result: ExportResult; onClose(): void }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const [downloaded, setDownloaded] = useState(result.downloaded);
  // Copy's fallback over plain http puts its text area here: one outside the dialog loses the focus to its trap.
  const content = useRef<HTMLDivElement>(null);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Your CafAI data</DialogTitle>
      <DialogContent ref={content}>
        <Typography variant="body2" sx={{ mb: 1.5 }}>
          {downloaded
            ? `Saved as ${result.fileName}. If no file appeared, copy the text below and keep it somewhere safe.`
            : 'Downloads may not work inside Decaid. Copy the text below and keep it somewhere safe.'}{' '}
          It holds your bags, versions and shots, never your API key.
        </Typography>
        <Box
          component="textarea"
          readOnly
          value={result.json}
          aria-label="Exported data"
          onFocus={(event) => event.currentTarget.select()}
          sx={{
            width: '100%',
            height: '40vh',
            resize: 'none',
            fontFamily: 'monospace',
            fontSize: 12,
            color: 'text.primary',
            bgcolor: 'background.default',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            p: 1,
          }}
        />
        {copied !== null ? (
          <Typography variant="body2" role="status" sx={{ mt: 1, color: copied ? 'success.main' : 'error.main' }}>
            {copied ? 'Copied.' : 'Copying failed. Tap the text, select all, then copy.'}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          startIcon={<FileDownloadIcon />}
          onClick={() => setDownloaded(downloadText(result.fileName, result.json))}
          sx={{ minHeight: 48 }}
        >
          Download file
        </Button>
        <Button
          startIcon={<ContentCopyIcon />}
          onClick={() => void copyText(result.json, content.current ?? undefined).then(setCopied)}
          sx={{ minHeight: 48 }}
        >
          Copy
        </Button>
        <Button variant="contained" onClick={onClose} sx={{ minHeight: 48 }}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export interface ExportData {
  /** True while the porter gathers the data: the button that started it is held. */
  working: boolean;
  /**
   * Gathers everything, saves it as a file outside Decaid and opens the
   * dialog. Never rejects: resolves with what went wrong ("Export failed:
   * …") for the caller to say where its button is, or null.
   */
  start(): Promise<string | null>;
  /** The dialog while it is open, else null; render it beside the button. */
  dialog: ReactNode;
}

export function useExportData(): ExportData {
  const { storage, host } = useServices();
  const [result, setResult] = useState<ExportResult | null>(null);
  const [working, setWorking] = useState(false);

  const start = useCallback(async (): Promise<string | null> => {
    setWorking(true);
    try {
      const data = await storage.porter.exportAll();
      const json = JSON.stringify(data, null, 2);
      const fileName = exportFileName(new Date());
      // Inside Decaid's WebView a download usually goes nowhere; go straight to copying.
      const downloaded = host.insideDecaid ? false : downloadText(fileName, json);
      setResult({ json, fileName, downloaded });
      return null;
    } catch (error) {
      return `Export failed: ${errorText(error)}`;
    } finally {
      setWorking(false);
    }
  }, [storage, host]);

  const close = useCallback(() => setResult(null), []);
  return { working, start, dialog: result ? <ExportDialog result={result} onClose={close} /> : null };
}
