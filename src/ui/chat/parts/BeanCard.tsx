import { useId, useRef, useState, type ChangeEvent } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PhotoCameraRoundedIcon from '@mui/icons-material/PhotoCameraRounded';
import type { BeanChoice, BeanPickerOption, SetAsideReason } from '../../../app/types.ts';
import type { BagPhoto } from '../../../llm/extractBag.ts';
import { TID } from '../../testIds.ts';
import { UNREADABLE, prepareBagPhoto } from '../bagPhoto.ts';
import { formatDate, setAsideNote } from '../format.ts';
import { Notice } from './Notice.tsx';

export interface BeanCardProps {
  /** Decaid's batches, newest roast first; none when the library is empty or Decaid was out of reach. */
  options: readonly BeanPickerOption[];
  /** True while Decaid's batches are being read: the card says so, and a photo or something else work already. */
  loading?: boolean;
  /** The answer, once given. */
  choice: BeanChoice | null;
  /** True while the coach is working; blocks a second tap. */
  disabled?: boolean;
  /** Set aside unanswered (the bag was described in the chat): the card is closed. */
  expired?: boolean;
  setAsideReason?: SetAsideReason;
  onPick(batchId: string): void;
  onSomethingElse(): void;
  /** The photo, ready to send; it goes no further than the coach's one reading of it. */
  onPhoto(photo: BagPhoto): void;
  /** Turns the chosen file into what is sent (tests stand in for the browser's decoding). */
  preparePhoto?: (file: File) => Promise<BagPhoto>;
}

function details(option: BeanPickerOption): string {
  return [option.roaster, option.roastDate ? `Roasted ${formatDate(option.roastDate)}` : null].filter(Boolean).join(' · ');
}

/**
 * Every row's button reads "Use this": its name says which coffee, for a
 * screen reader that lists the buttons alone, and which roast, since two
 * batches of one bean share the name.
 */
function pickLabel(option: BeanPickerOption): string {
  return option.roastDate ? `Use this: ${option.name}, roasted ${formatDate(option.roastDate)}` : `Use this: ${option.name}`;
}

/** An answer given on the card, in the accent with a check, where its button was. */
function Chosen({ label }: { label: string }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: 'primary.main', minHeight: 48, px: 1, flexShrink: 0 }}>
      <CheckCircleIcon fontSize="small" />
      <Typography variant="button" sx={{ textTransform: 'none' }}>
        {label}
      </Typography>
    </Stack>
  );
}

/**
 * "Which coffee is it?" (6.1): the batches in Decaid's bean library to pick
 * from, a photo of the bag (6.8), or something else (the bag described in the
 * chat). The batches are plain rows inside the one card, so more of them fit
 * on a small screen. Picked, it stays in the chat, closed, as the starting
 * profiles do. The camera opens through a plain file input with `capture`
 * (D122): inside Decaid 0.8.8 the WebView's own file chooser handles it, the
 * next release confirms each capture on Android, and a phone's browser
 * offers its picker.
 */
export function BeanCard({
  options,
  loading = false,
  choice,
  disabled = false,
  expired = false,
  setAsideReason,
  onPick,
  onSomethingElse,
  onPhoto,
  preparePhoto = prepareBagPhoto,
}: BeanCardProps) {
  const input = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const locked = choice !== null || expired;
  const blocked = disabled || locked || preparing;

  const takePhoto = () => {
    setProblem(null);
    input.current?.click();
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const field = event.currentTarget;
    const file = field.files?.[0];
    // Cleared, so the same photo can be chosen again.
    field.value = '';
    if (!file) return;
    setPreparing(true);
    try {
      onPhoto(await preparePhoto(file));
    } catch (error) {
      setProblem(error instanceof Error && error.message ? error.message : UNREADABLE);
    } finally {
      setPreparing(false);
    }
  };

  return (
    <Paper
      variant="outlined"
      data-testid={TID.beanCard}
      aria-labelledby={titleId}
      component="section"
      sx={{ p: 1.5, my: 0.5, bgcolor: 'background.paper' }}
    >
      <Typography id={titleId} component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>
        Which coffee is it?
      </Typography>
      {expired && choice === null ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
          {setAsideNote(setAsideReason, 'Set aside: you described the bag in the chat.')}
        </Typography>
      ) : null}
      {loading && !locked ? (
        <Stack direction="row" spacing={1.25} role="status" sx={{ alignItems: 'center', mt: 1 }}>
          <CircularProgress size={16} thickness={5} aria-hidden />
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Looking in Decaid's beans…
          </Typography>
        </Stack>
      ) : null}
      {options.length > 0 ? (
        <Box role="list" aria-label="Coffees in Decaid's bean library" sx={{ mt: 0.5 }}>
          {options.map((option, index) => {
            const picked = choice?.kind === 'batch' && choice.batchId === option.batchId;
            // Another answer, or set aside: the row stays, in the muted ink, never faded.
            const setAside = locked && !picked;
            return (
              <Stack
                key={option.batchId}
                role="listitem"
                direction="row"
                spacing={1.5}
                aria-current={picked ? 'true' : undefined}
                sx={{
                  alignItems: 'center',
                  py: 0.75,
                  borderTop: index === 0 ? 0 : 1,
                  borderColor: 'divider',
                  color: setAside ? 'text.secondary' : 'text.primary',
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
                    {option.name}
                  </Typography>
                  {details(option) ? (
                    <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
                      {details(option)}
                    </Typography>
                  ) : null}
                </Box>
                {picked ? (
                  <Chosen label="Picked" />
                ) : (
                  <Button
                    variant={locked ? 'text' : 'contained'}
                    data-testid={TID.beanOption}
                    aria-label={pickLabel(option)}
                    disabled={blocked}
                    onClick={() => onPick(option.batchId)}
                    sx={{ minHeight: 48, flexShrink: 0, px: 2 }}
                  >
                    Use this
                  </Button>
                )}
              </Stack>
            );
          })}
        </Box>
      ) : null}
      <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        {choice?.kind === 'photo' ? (
          <Chosen label="Photo of the bag" />
        ) : (
          <Button
            variant="tonal"
            startIcon={<PhotoCameraRoundedIcon />}
            data-testid={TID.bagPhoto}
            disabled={blocked}
            loading={preparing}
            onClick={takePhoto}
            sx={{ minHeight: 48 }}
          >
            Photo of the bag
          </Button>
        )}
        {choice?.kind === 'other' ? (
          <Chosen label="Something else" />
        ) : (
          <Button variant="text" data-testid={TID.beanSomethingElse} disabled={blocked} onClick={onSomethingElse} sx={{ minHeight: 48 }}>
            Something else
          </Button>
        )}
      </Stack>
      {problem && !locked ? (
        <Box sx={{ mt: 1 }}>
          <Notice tone="warning" text={problem} />
        </Box>
      ) : null}
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-testid={TID.bagPhotoInput}
        onChange={(event) => void onFile(event)}
      />
    </Paper>
  );
}
