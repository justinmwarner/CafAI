/**
 * Taste words and Need help? (D127): two prompts beside Stats while the taste
 * question is open. The coach never says what a shot should taste like, so
 * these help the barista find their own words: Taste words opens neutral
 * descriptors, one group of what to notice at a time, and a tapped word goes
 * into the message being written (nothing is sent until they send). Need
 * help? teaches how to taste, never what this coffee should taste like.
 *
 * The draft lives in x-chat's composer; ChatSurface hands it in, so this file
 * stays free of x-chat.
 */
import { useId, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import ExpandLessRounded from '@mui/icons-material/ExpandLessRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import HelpOutlineRounded from '@mui/icons-material/HelpOutlineRounded';
import { TID } from '../testIds.ts';
import { promptChipSx } from './promptChip.ts';
import { hasTasteWord, TASTE_GROUPS, toggleTasteWord } from './tasteWords.ts';

export interface TastePromptsProps {
  /** The message being written (the composer's draft). */
  draft: string;
  /** The draft with a word added or taken out. Never sends anything. */
  onDraft(next: string): void;
}

/**
 * A word chip as an option chip is drawn (48 px, radius 24). It stays
 * tappable once chosen, and a tap leaves :hover behind on a touch screen, so
 * hover keeps the resting colours: the accent, or no fill inside the line.
 */
const wordChipSx = { height: 48, minHeight: 48, borderRadius: 24, px: 0.5, fontSize: '1rem' } as const;
const chosenWordSx = { ...wordChipSx, '&.MuiChip-clickable:hover': { bgcolor: 'primary.main' } } as const;
const restingWordSx = { ...wordChipSx, borderColor: 'divider', '&.MuiChip-clickable:hover': { bgcolor: 'transparent' } } as const;

/** The disclosure's chevron after its label: up while the words are open. */
function labelWithChevron(label: string, open: boolean) {
  const Chevron = open ? ExpandLessRounded : ExpandMoreRounded;
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      {label}
      <Chevron aria-hidden sx={{ fontSize: 18, color: 'text.secondary', mr: -0.5 }} />
    </Box>
  );
}

/**
 * Taste words and Need help?, as items of the prompt row: the row wraps, so
 * the open words take a line of their own between the prompts and the
 * composer, right above where the tapped words land.
 */
export function TastePrompts({ draft, onDraft }: TastePromptsProps) {
  const [open, setOpen] = useState(false);
  const [helping, setHelping] = useState(false);
  const panelId = useId();
  return (
    <>
      <Chip
        variant="outlined"
        label={labelWithChevron('Taste words', open)}
        data-testid={TID.tastePrompt}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((was) => !was)}
        sx={promptChipSx}
      />
      <Chip
        variant="outlined"
        icon={<HelpOutlineRounded />}
        label="Need help?"
        aria-haspopup="dialog"
        data-testid={TID.tasteHelp}
        onClick={() => setHelping(true)}
        sx={promptChipSx}
      />
      {open ? <TasteWords id={panelId} draft={draft} onDraft={onDraft} /> : null}
      <TasteHelp open={helping} onClose={() => setHelping(false)} />
    </>
  );
}

export interface TasteWordsProps extends TastePromptsProps {
  id?: string;
}

/**
 * The words, one group of what to notice at a time: a tab per group, its
 * question, and its words. A word in the draft shows chosen, and a second
 * tap takes it out again.
 */
export function TasteWords({ id, draft, onDraft }: TasteWordsProps) {
  const [index, setIndex] = useState(0);
  const tabsId = useId();
  const group = TASTE_GROUPS[index] ?? TASTE_GROUPS[0]!;
  const panelId = `${tabsId}-panel`;
  const tabId = (i: number) => `${tabsId}-tab-${i}`;
  return (
    <Box
      id={id}
      role="region"
      aria-label="Taste words"
      data-testid={TID.tasteWords}
      sx={{
        flexBasis: '100%',
        minWidth: 0,
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: '12px',
        px: 1,
        pb: 1,
      }}
    >
      <Tabs
        value={index}
        onChange={(_event, next: number) => setIndex(next)}
        variant="scrollable"
        scrollButtons={false}
        aria-label="What to notice"
        sx={{ minHeight: 48 }}
      >
        {TASTE_GROUPS.map((each, i) => (
          <Tab
            key={each.id}
            label={each.label}
            id={tabId(i)}
            aria-controls={panelId}
            data-testid={TID.tasteGroup(each.id)}
            sx={{ px: 1.5, minWidth: 0, fontSize: '0.9375rem', fontWeight: 600 }}
          />
        ))}
      </Tabs>
      <Box role="tabpanel" id={panelId} aria-labelledby={tabId(index)} sx={{ px: 0.5, pt: 1 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
          {group.notice}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {group.words.map((taste) => {
            const chosen = hasTasteWord(draft, taste);
            return (
              <Chip
                key={taste.label}
                label={taste.label}
                data-testid={TID.tasteWord(taste.label)}
                aria-pressed={chosen}
                onClick={() => onDraft(toggleTasteWord(draft, taste))}
                color={chosen ? 'primary' : 'default'}
                variant={chosen ? 'filled' : 'outlined'}
                icon={chosen ? <CheckIcon /> : undefined}
                sx={chosen ? chosenWordSx : restingWordSx}
              />
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

/** How to taste, in a few lines: what to notice, that no answer is wrong, and that the last shot is the guide. */
export function TasteHelp({ open, onClose }: { open: boolean; onClose(): void }) {
  const titleId = useId();
  const notice: Array<[string, string]> = [
    ['Acidity', 'does it make your mouth water?'],
    ['Sweetness', 'is there any, and how much?'],
    ['Bitterness', 'does it linger after the sip?'],
    ['Astringency', 'does your mouth feel dry or rough, as after strong tea?'],
    ['Body', 'how heavy does it feel on your tongue?'],
    ['Finish', 'what stays after you swallow, and for how long?'],
  ];
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby={titleId} data-testid={TID.tasteHelpDialog}>
      <DialogTitle id={titleId}>How to taste</DialogTitle>
      <DialogContent>
        <Typography variant="body1">Take a small sip and let it cover your tongue. Then notice:</Typography>
        <Box component="ul" sx={{ pl: 2.5, my: 1, display: 'grid', gap: 0.5 }}>
          {notice.map(([what, question]) => (
            <Typography key={what} component="li" variant="body1">
              <Box component="span" sx={{ fontWeight: 600 }}>
                {what}
              </Box>
              : {question}
            </Typography>
          ))}
        </Box>
        <Typography variant="body1" sx={{ mt: 1.5 }}>
          There are no wrong answers. Say what you notice, in any words.
        </Typography>
        <Typography variant="body1" sx={{ mt: 1 }}>
          Your last shot is the best guide: compare the two, and say what changed.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="contained" onClick={onClose} sx={{ minHeight: 48, px: 3 }}>
          Got it
        </Button>
      </DialogActions>
    </Dialog>
  );
}
