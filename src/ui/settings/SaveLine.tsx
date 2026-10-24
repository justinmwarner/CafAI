/**
 * Saving at once (D234): every control applies when it changes, and the card
 * it sits in says what the change did in one line under it, "Saved." for
 * 3 s, or why it was not saved, in the error colour, with what to do, until
 * a later change saves. The line keeps its height, empty or not, so nothing
 * under it moves as it comes and goes.
 *
 * Also here, as the cards that save typed text share them: what CafAI says
 * when storage took a pasted API key out of a field (D37), and the test for
 * it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react';
import Typography from '@mui/material/Typography';
import { containsKeyLike } from '../../storage/redact.ts';
import type { Settings } from '../../storage/types.ts';

export const SAVED = 'Saved.';
/** How long "Saved." stays: long enough to be read from a step back. */
export const SAVED_FOR_MS = 3000;

/** Said when saving took a pasted API key out of a field, as the chat says it (D37). */
export const KEY_TAKEN_OUT = 'That looked like an API key, so CafAI took it out. Keys go in Settings > Coach.';

/** What the line says: nothing, "Saved.", or why a change was not saved. */
export type SaveNote = { tone: 'saved' } | { tone: 'error'; text: string } | null;

export interface SaveNoteControl {
  note: SaveNote;
  /** A change saved: "Saved.", for SAVED_FOR_MS. */
  saved(): void;
  /** A change did not save: why, until the next one saves. */
  failed(text: string): void;
}

/** Stop a pending clear of "Saved.". */
function stopTimer(timer: { current: ReturnType<typeof setTimeout> | null }): void {
  if (timer.current !== null) clearTimeout(timer.current);
  timer.current = null;
}

export function useSaveNote(): SaveNoteControl {
  const [note, setNote] = useState<SaveNote>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => stopTimer(timer), []);
  const saved = useCallback(() => {
    stopTimer(timer);
    setNote({ tone: 'saved' });
    timer.current = setTimeout(() => {
      timer.current = null;
      setNote(null);
    }, SAVED_FOR_MS);
  }, []);
  const failed = useCallback((text: string) => {
    stopTimer(timer);
    setNote({ tone: 'error', text });
  }, []);
  return useMemo(() => ({ note, saved, failed }), [note, saved, failed]);
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/** "Could not save the grinder: <why>. Try again.": what failed, why, and what to do. */
export function couldNotSave(what: string, error: unknown): string {
  const why = errorText(error).trim();
  return `Could not save ${what}: ${why}${/[.!?]$/.test(why) ? '' : '.'} Try again.`;
}

export interface SaveLineProps {
  note: SaveNote;
  testId?: string;
  /** For a card that brings its line into view (the grinder's, after a pick). */
  lineRef?: Ref<HTMLParagraphElement>;
}

/** The line under a card: one line kept even while empty, a polite status for assistive tech. */
export function SaveLine({ note, testId, lineRef }: SaveLineProps) {
  const error = note?.tone === 'error';
  return (
    <Typography
      ref={lineRef}
      variant="body2"
      role="status"
      data-testid={testId}
      sx={{ minHeight: '1.5em', mt: 1, color: error ? 'error.main' : 'success.main' }}
    >
      {note === null ? '' : note.tone === 'saved' ? SAVED : note.text}
    </Typography>
  );
}

/** Did saving take key-shaped text out of one of these typed fields? Storage does that (src/storage/settings.ts); this only tells. */
export function tookKeyOut(fields: ReadonlyArray<'model' | 'grinderName' | 'grinderSetting'>, sent: Partial<Settings>, saved: Settings): boolean {
  return fields.some((field) => {
    const value = sent[field];
    return typeof value === 'string' && containsKeyLike(value) && !containsKeyLike(saved[field] ?? '');
  });
}
