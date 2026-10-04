import { useId, useState, type FormEvent } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import EditIcon from '@mui/icons-material/Edit';
import { OTHER_OPTION } from '../../../coach/contract.ts';
import { TID } from '../../testIds.ts';

export interface OptionChipsProps {
  question: string;
  options: readonly string[];
  multiSelect: boolean;
  answer: { selected: string[]; otherText: string | null } | null;
  /** True while the coach is working; blocks a second answer. */
  disabled?: boolean;
  /** The barista typed instead, or pulled another shot: the question is closed. */
  expired?: boolean;
  onAnswer(selected: string[], otherText: string | null): void;
}

const chipSx = { height: 48, minHeight: 48, borderRadius: 24, px: 0.75, fontSize: '1rem' } as const;

/**
 * A question with tappable answers. Single-select answers on tap;
 * multi-select toggles and then sends. "Other" is always last and opens a
 * short text field, because the listed answers never cover every cup.
 */
export function OptionChips({ question, options, multiSelect, answer, disabled = false, expired = false, onAnswer }: OptionChipsProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState('');
  const questionId = useId();

  // The engine already appends "Other" last; keep it last even if it did not.
  const listed = options.filter((o) => o !== OTHER_OPTION);
  const ordered = [...listed, OTHER_OPTION];
  const answered = answer !== null;
  const locked = answered || disabled || expired;
  const trimmedOther = otherText.trim();

  const isChosen = (option: string) =>
    answered
      ? answer.selected.includes(option) || (option === OTHER_OPTION && answer.otherText !== null)
      : option === OTHER_OPTION
        ? otherOpen
        : selected.includes(option);

  const tap = (option: string) => {
    if (locked) return;
    if (option === OTHER_OPTION) {
      setOtherOpen((open) => !open);
      return;
    }
    if (multiSelect) {
      setSelected((current) => (current.includes(option) ? current.filter((o) => o !== option) : [...current, option]));
    } else {
      onAnswer([option], null);
    }
  };

  const canSend = !locked && (otherOpen ? trimmedOther !== '' : selected.length > 0);

  const send = (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    if (multiSelect) {
      // In the order the coach listed them, not the order they were tapped.
      const picked = listed.filter((option) => selected.includes(option));
      onAnswer(otherOpen ? [...picked, OTHER_OPTION] : picked, otherOpen ? trimmedOther : null);
    } else {
      onAnswer([OTHER_OPTION], trimmedOther);
    }
  };

  const showSend = !answered && (multiSelect || otherOpen);

  return (
    <Box component="form" onSubmit={send} sx={{ my: 0.5 }} aria-labelledby={questionId}>
      <Typography id={questionId} variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        {question}
      </Typography>
      <Stack
        direction="row"
        useFlexGap
        role={multiSelect ? 'group' : 'radiogroup'}
        aria-labelledby={questionId}
        sx={{ flexWrap: 'wrap', gap: 1 }}
      >
        {ordered.map((option) => {
          const chosen = isChosen(option);
          const isOther = option === OTHER_OPTION;
          return (
            <Chip
              key={option}
              label={option}
              data-testid={TID.optionChip(option)}
              role={multiSelect || isOther ? 'checkbox' : 'radio'}
              aria-checked={chosen}
              aria-disabled={locked || undefined}
              clickable={!locked}
              disabled={locked && !chosen}
              onClick={locked ? undefined : () => tap(option)}
              color={chosen ? 'primary' : 'default'}
              variant={chosen ? 'filled' : 'outlined'}
              icon={chosen ? <CheckIcon /> : isOther ? <EditIcon /> : undefined}
              sx={chipSx}
            />
          );
        })}
      </Stack>
      {answered && answer.otherText ? (
        <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
          Other: “{answer.otherText}”
        </Typography>
      ) : null}
      {!answered && otherOpen ? (
        <TextField
          autoFocus
          fullWidth
          size="small"
          label="Describe it in your words"
          value={otherText}
          onChange={(event) => setOtherText(event.target.value)}
          disabled={locked}
          slotProps={{ htmlInput: { 'data-testid': TID.otherInput, maxLength: 300 } }}
          sx={{ mt: 1.5, '& .MuiInputBase-root': { minHeight: 48 } }}
        />
      ) : null}
      {showSend ? (
        <Button
          type="submit"
          variant="contained"
          data-testid={TID.optionsSubmit}
          disabled={!canSend}
          sx={{ mt: 1.5, minHeight: 48, px: 3 }}
        >
          Send
        </Button>
      ) : null}
    </Box>
  );
}
