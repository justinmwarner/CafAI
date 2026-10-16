/**
 * The history route: #/history lists the bags, #/history/<bagId> shows one
 * bag's profile versions with the dial-in iterations under each. Reads
 * storage directly and re-reads whenever the coach commits something.
 * Export and import of all data live here too.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import type { Bag, IterationRecord, ProfileVersion } from '../../storage/types.ts';
import { OTHER_OPTION } from '../../coach/contract.ts';
import { formatEy, formatTds, readingOf } from '../../coach/extraction.ts';
import { inTemperatureUnit } from '../../coach/temperature.ts';
import { useCoach, useServices, useTemperatureUnit } from '../../app/services.tsx';
import { TID } from '../testIds.ts';
import {
  describeChannelingFlag,
  formatBar,
  formatDateTime,
  formatGrams,
  formatRatio,
  formatSeconds,
  shotRatio,
  splitDiffLine,
} from '../chat/format.ts';
import { VisualizerLink } from '../chat/parts/ShotCard.tsx';
import { copyText, downloadText, exportFileName } from './exportFile.ts';
import { groupHistory, outcomeLabel, templateName, versionStatusLabel } from './historyModel.ts';

export interface HistoryScreenProps {
  /** From the route: null on #/history (the bag list), the id on #/history/<bagId>. */
  bagId: string | null;
  /** Open a bag's history, or the list with null. Defaults to changing the location hash. */
  onSelectBag?(bagId: string | null): void;
}

function hashNavigate(bagId: string | null) {
  window.location.hash = bagId ? `#/history/${encodeURIComponent(bagId)}` : '#/history';
}

type Message = { tone: 'success' | 'error' | 'info'; text: string };

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/**
 * What changes when the coach commits something worth re-reading: bags or
 * versions, or a turn ending. Deliberately not the messages, which change on
 * every streamed token.
 */
function useCoachCommits() {
  return [useCoach((s) => s.bags), useCoach((s) => s.versions), useCoach((s) => s.phase), useCoach((s) => s.busy)] as const;
}

// ---------------------------------------------------------------------------
// Bag list
// ---------------------------------------------------------------------------

function bagDetails(bag: Bag): string {
  return [bag.roaster, bag.origin, bag.roastLevel, bag.process].filter(Boolean).join(' · ');
}

function BagList({ bags, shotCounts, onSelect }: { bags: Bag[]; shotCounts: Map<string, number>; onSelect(id: string): void }) {
  if (bags.length === 0) {
    return (
      <Typography sx={{ color: 'text.secondary', p: 2 }}>
        No bags yet. Start one on the Coach screen; every shot and change you confirm will show up here.
      </Typography>
    );
  }
  return (
    <List disablePadding sx={{ display: 'grid', gap: 1 }}>
      {bags.map((bag) => {
        const shots = shotCounts.get(bag.id) ?? 0;
        return (
          <Paper key={bag.id} variant="outlined" sx={{ bgcolor: 'background.paper', overflow: 'hidden' }}>
            <ListItemButton data-testid={TID.historyBag(bag.id)} onClick={() => onSelect(bag.id)} sx={{ minHeight: 64, gap: 2 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {bag.name}
                  {bag.archived ? (
                    <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>
                      {' '}
                      (archived)
                    </Box>
                  ) : null}
                </Typography>
                <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
                  {bagDetails(bag) || 'No details yet'}
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                <Typography variant="body2">{shots === 1 ? '1 shot' : `${shots} shots`}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {formatDateTime(bag.updatedAt)}
                </Typography>
              </Box>
              <ChevronRightIcon sx={{ color: 'text.secondary' }} />
            </ListItemButton>
          </Paper>
        );
      })}
    </List>
  );
}

// ---------------------------------------------------------------------------
// One bag
// ---------------------------------------------------------------------------

const STATUS_COLOR = { active: 'success', superseded: 'default', undone: 'warning' } as const;

/** A change's words with their temperatures in the barista's unit (D-TEMP-6): kept as written, read in °C or °F. */
function useWords(): (text: string) => string {
  const unit = useTemperatureUnit();
  return (text) => inTemperatureUnit(text, unit);
}

function ChangeLines({ lines }: { lines: string[] }) {
  const words = useWords();
  return (
    <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 0.25 }}>
      {lines.map((kept, i) => {
        const line = words(kept);
        const parts = splitDiffLine(line);
        return (
          <Typography key={i} component="li" variant="body2">
            {parts ? (
              <>
                <Box component="span" sx={{ color: 'text.secondary' }}>
                  {parts.label}:{' '}
                </Box>
                <Box component="span" sx={{ color: 'text.secondary', textDecoration: 'line-through' }}>
                  {parts.before}
                </Box>
                {' → '}
                <Box component="span" sx={{ fontWeight: 600 }}>
                  {parts.after}
                </Box>
              </>
            ) : (
              line
            )}
          </Typography>
        );
      })}
    </Box>
  );
}

function shotLine(record: IterationRecord): string {
  const s = record.summary;
  if (!s) return 'No shot data';
  // The barista's refractometer reading, and its EY when there is one (D-TDS-5).
  const reading = readingOf(s);
  const measured = reading ? [`TDS ${formatTds(reading.tdsPct)}`, ...(reading.eyPct === null ? [] : [`EY ${formatEy(reading.eyPct)}`])] : [];
  return [
    formatSeconds(s.durationS),
    `${formatGrams(s.doseG)} → ${formatGrams(s.yieldG)}`,
    formatRatio(shotRatio(s)),
    `peak ${formatBar(s.peakPressureBar)}`,
    ...measured,
  ].join(' · ');
}

function feedbackText(record: IterationRecord): string | null {
  const f = record.feedback;
  if (!f) return null;
  const picked = f.selected.filter((option) => option !== OTHER_OPTION || f.otherText === null);
  const words = [...picked, ...(f.otherText ? [`“${f.otherText}”`] : [])];
  return words.length > 0 ? words.join(', ') : null;
}

function IterationRow({ record }: { record: IterationRecord }) {
  const words = useWords();
  const feedback = feedbackText(record);
  const flags = record.summary?.channelingFlags ?? [];
  return (
    <Box
      data-testid={TID.historyIteration(record.id)}
      sx={{ py: 0.75, display: 'grid', gap: 0.25 }}
    >
      <Typography variant="body2">
        <Box component="span" sx={{ color: 'text.secondary' }}>
          {formatDateTime(record.createdAt)} ·{' '}
        </Box>
        {shotLine(record)}
      </Typography>
      {flags.length > 0 ? (
        <Typography variant="body2" sx={{ color: 'warning.main' }}>
          {flags.map(describeChannelingFlag).join('; ')}
        </Typography>
      ) : null}
      {feedback ? (
        <Typography variant="body2">
          <Box component="span" sx={{ color: 'text.secondary' }}>
            Taste:{' '}
          </Box>
          {feedback}
        </Typography>
      ) : null}
      {record.proposal ? (
        <Typography variant="body2">
          <Box component="span" sx={{ color: 'text.secondary' }}>
            Proposed:{' '}
          </Box>
          {words(record.proposal.summary)}
        </Typography>
      ) : null}
      <Typography variant="body2" sx={{ color: record.outcome === 'applied' ? 'success.main' : 'text.secondary' }}>
        {outcomeLabel(record.outcome)}
      </Typography>
      {/* The shot's page on Visualizer, kept with the iteration (6.4). */}
      <VisualizerLink url={record.visualizerUrl} />
    </Box>
  );
}

function VersionCard({ version, iterations }: { version: ProfileVersion; iterations: IterationRecord[] }) {
  const words = useWords();
  return (
    <Paper
      variant="outlined"
      data-testid={TID.historyVersion(version.version)}
      data-status={version.status}
      sx={{
        p: 1.5,
        bgcolor: 'background.paper',
        // An undone version reads as set aside: the muted ink throughout (its
        // chip keeps the warning colour), never faded, so it still reads at AA.
        color: version.status === 'undone' ? 'text.secondary' : 'text.primary',
        borderColor: version.status === 'active' ? 'success.main' : 'divider',
      }}
    >
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>
          {version.title}
        </Typography>
        <Chip
          size="small"
          label={versionStatusLabel(version.status)}
          color={STATUS_COLOR[version.status]}
          variant={version.status === 'active' ? 'filled' : 'outlined'}
          sx={{ minHeight: 0 }}
        />
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {formatDateTime(version.createdAt)}
        </Typography>
      </Stack>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
        {version.change ? `From ${templateName(version.templateId)}` : `Starting point: ${templateName(version.templateId)}`}
      </Typography>
      {version.change ? (
        <Box sx={{ mt: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {words(version.change.summary)}
          </Typography>
          <ChangeLines lines={version.change.diffLines} />
        </Box>
      ) : null}
      {iterations.length > 0 ? (
        <Box sx={{ mt: 1, display: 'grid', '& > * + *': { borderTop: 1, borderColor: 'divider' } }}>
          {iterations.map((record) => (
            <IterationRow key={record.id} record={record} />
          ))}
        </Box>
      ) : (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
          No shots on this version.
        </Typography>
      )}
    </Paper>
  );
}

interface BagHistory {
  bag: Bag | undefined;
  versions: ProfileVersion[];
  iterations: IterationRecord[];
}

function BagDetail({ data, onBack }: { data: BagHistory; onBack(): void }) {
  const { groups, unassigned } = useMemo(() => groupHistory(data.versions, data.iterations), [data]);
  const back = (
    <Button startIcon={<ArrowBackIcon />} onClick={onBack} sx={{ minHeight: 48, alignSelf: 'flex-start' }}>
      All bags
    </Button>
  );
  if (!data.bag) {
    return (
      <Stack spacing={1}>
        {back}
        <Typography sx={{ color: 'text.secondary' }}>That bag was not found.</Typography>
      </Stack>
    );
  }
  const bag = data.bag;
  return (
    <Stack spacing={1.5}>
      {back}
      <Box>
        <Typography variant="h6" component="h2">
          {bag.name}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {bagDetails(bag) || 'No details yet'}
        </Typography>
        {bag.notes ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Notes: {bag.notes}
          </Typography>
        ) : null}
      </Box>
      {groups.length === 0 && unassigned.length === 0 ? (
        <Typography sx={{ color: 'text.secondary' }}>No profile yet. Pick a starting profile on the Coach screen.</Typography>
      ) : null}
      {groups.map((group) => (
        <VersionCard key={group.version.id} version={group.version} iterations={group.iterations} />
      ))}
      {unassigned.length > 0 ? (
        <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'background.paper' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            Shots without a profile version
          </Typography>
          <Box sx={{ display: 'grid', '& > * + *': { borderTop: 1, borderColor: 'divider' } }}>
            {unassigned.map((record) => (
              <IterationRow key={record.id} record={record} />
            ))}
          </Box>
        </Paper>
      ) : null}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

interface ExportResult {
  json: string;
  fileName: string;
  downloaded: boolean;
}

function ExportDialog({ result, onClose }: { result: ExportResult; onClose(): void }) {
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

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

type ListData = { bags: Bag[]; shotCounts: Map<string, number> };

export function HistoryScreen({ bagId, onSelectBag = hashNavigate }: HistoryScreenProps) {
  const { storage, coach, host, appearance, temperatureUnit, care } = useServices();
  const [coachBags, coachVersions, coachPhase, coachBusy] = useCoachCommits();
  const [reloads, setReloads] = useState(0);
  const [list, setList] = useState<ListData | null>(null);
  const [detail, setDetail] = useState<(BagHistory & { id: string }) | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [working, setWorking] = useState<'export' | 'import' | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        if (bagId === null) {
          const [bags, iterations] = await Promise.all([storage.bags.list(), storage.iterations.listAll()]);
          const shotCounts = new Map<string, number>();
          for (const record of iterations) {
            if (record.shotId) shotCounts.set(record.bagId, (shotCounts.get(record.bagId) ?? 0) + 1);
          }
          const sorted = [...bags].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          if (live) setList({ bags: sorted, shotCounts });
        } else {
          const [bag, versions, iterations] = await Promise.all([
            storage.bags.get(bagId),
            storage.versions.listByBag(bagId),
            storage.iterations.listByBag(bagId),
          ]);
          if (live) setDetail({ id: bagId, bag, versions, iterations });
        }
        if (live) setLoadError(null);
      } catch (error) {
        if (live) setLoadError(`Could not read the history: ${errorText(error)}`);
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [storage, bagId, coachBags, coachVersions, coachPhase, coachBusy, reloads]);

  const onExport = useCallback(async () => {
    setWorking('export');
    setMessage(null);
    try {
      const data = await storage.porter.exportAll();
      const json = JSON.stringify(data, null, 2);
      const fileName = exportFileName(new Date());
      // Inside Decaid's WebView a download usually goes nowhere; go straight to copying.
      const downloaded = host.insideDecaid ? false : downloadText(fileName, json);
      setExportResult({ json, fileName, downloaded });
    } catch (error) {
      setMessage({ tone: 'error', text: `Export failed: ${errorText(error)}` });
    } finally {
      setWorking(null);
    }
  }, [storage, host]);

  const onImport = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      // Clear the input so picking the same file again still fires a change.
      input.value = '';
      if (!file) return;
      setWorking('import');
      setMessage(null);
      try {
        let data: unknown;
        try {
          data = JSON.parse(await file.text());
        } catch {
          setMessage({ tone: 'error', text: 'That file is not a CafAI export (it is not JSON).' });
          return;
        }
        const { imported } = await storage.porter.importAll(data, 'merge');
        setMessage(
          imported > 0
            ? { tone: 'success', text: `Imported ${imported} ${imported === 1 ? 'record' : 'records'}.` }
            : { tone: 'info', text: 'Nothing new to import: this device already has everything in that file.' },
        );
        setReloads((n) => n + 1);
        coach.refresh().catch(() => undefined);
        // An import can bring a look along (a device still on the default takes it).
        appearance.reload().catch(() => undefined);
        // And a temperature unit, on a device that never chose one (D-TEMP-2).
        temperatureUnit.reload().catch(() => undefined);
        // And machine care's last times (D-CARE-7).
        care?.reload().catch(() => undefined);
      } catch (error) {
        setMessage({ tone: 'error', text: `Import failed: ${errorText(error)}` });
      } finally {
        setWorking(null);
      }
    },
    [storage, coach, appearance, temperatureUnit, care],
  );

  const current = bagId === null ? list : detail?.id === bagId ? detail : null;

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        component="header"
        sx={{ alignItems: 'center', flexWrap: 'wrap', px: 2, pt: 1.5, pb: 1, borderBottom: 1, borderColor: 'divider' }}
      >
        <Typography variant="h6" component="h1" sx={{ flex: 1 }}>
          History
        </Typography>
        <Button
          variant="tonal"
          startIcon={working === 'export' ? <CircularProgress size={16} /> : <FileDownloadIcon />}
          data-testid={TID.exportData}
          disabled={working !== null}
          onClick={() => void onExport()}
          sx={{ minHeight: 48 }}
        >
          Export
        </Button>
        <Button
          variant="tonal"
          component="label"
          startIcon={working === 'import' ? <CircularProgress size={16} /> : <FileUploadIcon />}
          disabled={working !== null}
          sx={{ minHeight: 48 }}
        >
          Import
          <input
            type="file"
            accept="application/json,.json"
            hidden
            data-testid={TID.importData}
            disabled={working !== null}
            onChange={(event) => void onImport(event)}
          />
        </Button>
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 2, display: 'grid', gap: 1.5, alignContent: 'start' }}>
        {message ? (
          <Alert severity={message.tone} onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        ) : null}
        {loadError ? <Alert severity="error">{loadError}</Alert> : null}
        {current === null ? (
          loadError ? null : (
            <Stack direction="row" spacing={1.5} role="status" sx={{ alignItems: 'center', color: 'text.secondary' }}>
              <CircularProgress size={20} />
              <Typography variant="body2">Loading…</Typography>
            </Stack>
          )
        ) : bagId === null && list ? (
          <BagList bags={list.bags} shotCounts={list.shotCounts} onSelect={(id) => onSelectBag(id)} />
        ) : detail ? (
          <BagDetail data={detail} onBack={() => onSelectBag(null)} />
        ) : null}
      </Box>
      {exportResult ? <ExportDialog result={exportResult} onClose={() => setExportResult(null)} /> : null}
    </Box>
  );
}
