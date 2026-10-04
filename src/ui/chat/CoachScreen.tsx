/**
 * The coach route (#/): bag header, error banner, and the chat. Renders
 * CoachState and calls the controller; it keeps no coaching state itself.
 */
import { useMemo, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import KeyIcon from '@mui/icons-material/Key';
import LocalCafeIcon from '@mui/icons-material/LocalCafe';
import UndoIcon from '@mui/icons-material/Undo';
import type { Bag } from '../../storage/types.ts';
import type { CoachPhase } from '../../app/types.ts';
import { useCoach, useServices, useTelemetry } from '../../app/services.tsx';
import { isShotRunning } from '../../api/workflow.ts';
import { TID } from '../testIds.ts';
import { ChatSurface } from './ChatSurface.tsx';
import { formatDateTime } from './format.ts';

export interface CoachScreenProps {
  /** Where the "add your API key" card links. */
  settingsHref?: string;
}

const PLACEHOLDERS: Record<CoachPhase, string> = {
  no_bag: 'Start a new bag first',
  intake: 'Origin, roast, process, tasting notes…',
  choosing_template: 'Pick a starting profile, or ask a question',
  awaiting_shot: 'Pull a shot, or ask the coach',
  awaiting_feedback: 'Tap an answer, or say how it tasted',
  awaiting_confirmation: 'Confirm the change, or ask a question',
  idle: 'Ask for starting profiles, or ask a question',
};

/** Controller calls report failures through CoachState.error; this only stops unhandled rejections. */
function fire(action: Promise<void>) {
  action.catch((error: unknown) => {
    console.error('Coach action failed:', error instanceof Error ? error.message : String(error));
  });
}

function pickerBags(bags: readonly Bag[], activeBag: Bag | null): Bag[] {
  return bags
    .filter((bag) => !bag.archived || bag.id === activeBag?.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The picker label: the bag's name, plus when it was started if another bag has the same name. */
export function bagLabels(bags: readonly Bag[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const bag of bags) counts.set(bag.name, (counts.get(bag.name) ?? 0) + 1);
  return new Map(
    bags.map((bag) => [bag.id, (counts.get(bag.name) ?? 0) > 1 ? `${bag.name} · ${formatDateTime(bag.createdAt)}` : bag.name]),
  );
}

function BagPicker({ bags, activeBag, disabled }: { bags: Bag[]; activeBag: Bag | null; disabled: boolean }) {
  const { coach } = useServices();
  const labels = bagLabels(bags);
  return (
    <TextField
      select
      size="small"
      label="Bag"
      value={activeBag?.id ?? ''}
      disabled={disabled}
      onChange={(event) => {
        const id = event.target.value;
        if (id && id !== activeBag?.id) fire(coach.selectBag(id));
      }}
      slotProps={{
        select: { native: true },
        htmlInput: { 'data-testid': TID.bagPicker },
        inputLabel: { shrink: true },
      }}
      // The native select itself is the touch target: 12.5 px padding makes it 48 px tall.
      sx={{ minWidth: 150, maxWidth: 280, flex: '1 1 180px', '& .MuiNativeSelect-select': { py: '12.5px' } }}
    >
      {activeBag ? null : (
        <option value="" disabled>
          Choose a bag…
        </option>
      )}
      {bags.map((bag) => (
        <option key={bag.id} value={bag.id}>
          {labels.get(bag.id) ?? bag.name}
        </option>
      ))}
    </TextField>
  );
}

function ErrorBanner({ error }: { error: string }) {
  const { coach } = useServices();
  return (
    <Alert
      severity="error"
      data-testid={TID.errorBanner}
      sx={{ mx: 1.5, mt: 1, alignItems: 'center', '& .MuiAlert-action': { pt: 0, alignItems: 'center' } }}
      action={
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Button color="inherit" data-testid={TID.retryButton} onClick={() => fire(coach.retry())} sx={{ minHeight: 48 }}>
            Retry
          </Button>
          <IconButton color="inherit" aria-label="Dismiss" onClick={() => coach.dismissError()}>
            <CloseIcon />
          </IconButton>
        </Stack>
      }
    >
      {error}
    </Alert>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', p: 2 }}>
      <Paper
        variant="outlined"
        sx={{ m: 'auto', p: 3, maxWidth: 460, width: '100%', textAlign: 'center', bgcolor: 'background.paper' }}
      >
        {children}
      </Paper>
    </Box>
  );
}

function ApiKeyCard({ settingsHref }: { settingsHref: string }) {
  return (
    <EmptyState>
      <KeyIcon sx={{ fontSize: 40, color: 'primary.main' }} />
      <Typography variant="h6" component="h2" sx={{ mt: 1 }}>
        Add your Anthropic API key to start coaching
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
        The key stays on this tablet. You pay Anthropic directly for what the coach uses.
      </Typography>
      <Button variant="contained" href={settingsHref} sx={{ mt: 2.5, minHeight: 48, px: 3 }}>
        Open Settings
      </Button>
    </EmptyState>
  );
}

function NewBagCta({ hasBags, disabled }: { hasBags: boolean; disabled: boolean }) {
  const { coach } = useServices();
  return (
    <EmptyState>
      <LocalCafeIcon sx={{ fontSize: 40, color: 'primary.main' }} />
      <Typography variant="h6" component="h2" sx={{ mt: 1 }}>
        {hasBags ? 'Pick a bag above, or start a new one' : 'Dial in your first bag'}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
        Tell the coach about the coffee. It suggests a starting profile, reads every shot, and changes one thing
        at a time, only when you confirm.
      </Typography>
      <Button
        variant="contained"
        size="large"
        startIcon={<AddIcon />}
        data-testid={TID.newBag}
        disabled={disabled}
        onClick={() => fire(coach.newBag())}
        sx={{ mt: 2.5, minHeight: 56, px: 4, fontSize: '1.05rem' }}
      >
        New bag
      </Button>
    </EmptyState>
  );
}

export function CoachScreen({ settingsHref = '#/settings' }: CoachScreenProps) {
  const { coach } = useServices();
  const ready = useCoach((s) => s.ready);
  const hasApiKey = useCoach((s) => s.hasApiKey);
  const bags = useCoach((s) => s.bags);
  const activeBag = useCoach((s) => s.activeBag);
  const activeVersion = useCoach((s) => s.activeVersion);
  const phase = useCoach((s) => s.phase);
  const messages = useCoach((s) => s.messages);
  const busy = useCoach((s) => s.busy);
  const error = useCoach((s) => s.error);
  const canUndo = useCoach((s) => s.canUndo);
  // A shot belongs to the bag on screen: no switching while it is pulled.
  const shotRunning = useTelemetry(isShotRunning);

  const listedBags = useMemo(() => pickerBags(bags, activeBag), [bags, activeBag]);
  const showChat = ready && hasApiKey && activeBag !== null;

  let body: ReactNode;
  if (!ready) {
    body = (
      <Stack spacing={1.5} sx={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} role="status">
        <CircularProgress />
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Loading your bags…
        </Typography>
      </Stack>
    );
  } else if (!hasApiKey) {
    body = <ApiKeyCard settingsHref={settingsHref} />;
  } else if (!activeBag) {
    body = <NewBagCta hasBags={listedBags.length > 0} disabled={busy || shotRunning} />;
  } else {
    body = (
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <ChatSurface
          messages={messages}
          busy={busy}
          placeholder={PLACEHOLDERS[phase]}
          canUndo={canUndo}
          onSend={(text) => fire(coach.sendText(text))}
          onPickTemplate={(requestId, templateId) => fire(coach.pickTemplate(requestId, templateId))}
          onAnswerOptions={(requestId, selected, otherText) => fire(coach.answerOptions(requestId, selected, otherText))}
          onConfirm={(requestId) => fire(coach.confirmChange(requestId))}
          onDecline={(requestId) => fire(coach.declineChange(requestId))}
          onUndo={() => fire(coach.undo())}
        />
      </Box>
    );
  }

  const showHeader = ready && hasApiKey && (activeBag !== null || listedBags.length > 0);

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {showHeader ? (
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          component="header"
          aria-label="Bag"
          sx={{ alignItems: 'center', flexWrap: 'wrap', px: 1.5, pt: 1.5, pb: 1, borderBottom: 1, borderColor: 'divider' }}
        >
          <BagPicker bags={listedBags} activeBag={activeBag} disabled={busy || shotRunning} />
          {activeBag ? (
            <Chip
              data-testid={TID.activeVersion}
              label={activeVersion ? <VersionLabel title={activeVersion.title} version={activeVersion.version} /> : 'No profile yet'}
              color={activeVersion ? 'primary' : 'default'}
              variant={activeVersion ? 'filled' : 'outlined'}
              sx={{ minHeight: 0, height: 36, fontWeight: 600, maxWidth: 260, '& .MuiChip-label': { display: 'flex', minWidth: 0 } }}
            />
          ) : null}
          <Box sx={{ flex: '1 0 0', minWidth: 0 }} />
          {canUndo && showChat ? (
            <Button
              variant="outlined"
              startIcon={<UndoIcon />}
              data-testid={TID.undoButton}
              disabled={busy}
              onClick={() => fire(coach.undo())}
              sx={{ minHeight: 48 }}
            >
              Undo
            </Button>
          ) : null}
          {activeBag ? (
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              data-testid={TID.newBag}
              disabled={busy || shotRunning}
              onClick={() => fire(coach.newBag())}
              sx={{ minHeight: 48 }}
            >
              New bag
            </Button>
          ) : null}
        </Stack>
      ) : null}
      {error ? <ErrorBanner error={error} /> : null}
      {body}
    </Box>
  );
}

/** "<long bag name>… v12": the name may shorten, the version never does. */
function VersionLabel({ title, version }: { title: string; version: number }) {
  const suffix = ` v${version}`;
  const name = title.endsWith(suffix) ? title.slice(0, -suffix.length) : title;
  return (
    <Box component="span" sx={{ display: 'flex', minWidth: 0 }}>
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </Box>
      {name !== title ? (
        <Box component="span" sx={{ flexShrink: 0, whiteSpace: 'pre' }}>
          {suffix}
        </Box>
      ) : null}
    </Box>
  );
}
