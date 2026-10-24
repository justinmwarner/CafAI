/**
 * Settings > Grinder > Your grinder: the grinder the coach turns, linked to
 * Decaid's grinder library where it is listed, whose step size the coach
 * then uses (GrinderFields.tsx, grinderPicker.ts), or named by hand; its
 * current setting; which way is finer on it (GrinderDirectionRow.tsx, D241,
 * which reads and saves its own setting for the grinder as saved); Add a
 * grinder for one the library lacks (AddGrinder.tsx); and what the coach does
 * with it.
 *
 * Everything applies as it changes (D234): a pick from Decaid's list saves at
 * once (grinderPatch, as Save did), so it links at once, and so does a
 * preset grinder's setting, a list; the typed name and setting save when
 * the field is left and on Enter, as the drinks' steppers take a typed
 * value, and a value left as it was saves nothing. Each save sends the
 * whole grinder, so a later one carries an earlier one that failed; the
 * coach re-reads its settings after it, and the line under the card says
 * "Saved." or why not. A pick brings the setting and that line into view,
 * scrolling the group's own column. A key pasted into a typed field never
 * becomes a setting: storage takes it out (src/storage/settings.ts), the
 * field shows what was saved, and the card says why (D37).
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FocusEvent, type KeyboardEvent } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { addOrFindGrinder, listGrinders, type Grinder } from '../../api/grinders.ts';
import { PLUGIN } from '../../api/plugins.ts';
import { useServices } from '../../app/services.tsx';
import { grinderDirectionKey } from '../../storage/settings.ts';
import type { Settings } from '../../storage/types.ts';
import { TID } from '../testIds.ts';
import { AddGrinder, type AddedGrinder } from './AddGrinder.tsx';
import { dye2GrindersUrl } from './addGrinder.ts';
import { GrinderDirectionRow } from './GrinderDirectionRow.tsx';
import { GrinderFields } from './GrinderFields.tsx';
import {
  canAddGrinder,
  grinderLabel,
  grinderPatch,
  grinderView,
  libraryAfterError,
  NOT_LISTED,
  withGrinder,
  type GrinderForm,
  type GrinderLibrary,
} from './grinderPicker.ts';
import { useGroupScroll } from './groupLayout.tsx';
import { revealInColumn } from './reveal.ts';
import { couldNotSave, KEY_TAKEN_OUT, SaveLine, tookKeyOut, useSaveNote } from './SaveLine.tsx';
import { Section } from './Section.tsx';

export const GRINDER_CARD_TITLE = 'Your grinder';

/** Decaid answers in well under a second when it is there; do not hold the picker longer than this. */
const GRINDER_LIST_TIMEOUT_MS = 5000;

type SavedGrinder = Pick<Settings, 'grinderId' | 'grinderName'>;
type GrinderFieldsSaved = Pick<Settings, 'grinderId' | 'grinderName' | 'grinderSetting'>;

function formFrom(settings: GrinderFieldsSaved): GrinderForm {
  return { pick: settings.grinderId ?? NOT_LISTED, name: settings.grinderName ?? '', setting: settings.grinderSetting ?? '' };
}

/** The grinder as storage holds it, to tell a change from a field left as it was. */
const keyOf = (fields: GrinderFieldsSaved) => JSON.stringify([fields.grinderId ?? null, fields.grinderName ?? null, fields.grinderSetting ?? null]);

/**
 * What a field shows once its save is back: what was saved (trimmed, a key
 * taken out), unless the barista has typed into it since, which is kept. A
 * linked grinder is saved under its model's name: the free-text name, which
 * shows again with "Not in Decaid's list", stays as it was typed.
 */
function afterSave(current: GrinderForm, sent: GrinderForm, saved: GrinderForm): GrinderForm {
  const linked = saved.pick !== NOT_LISTED;
  return {
    pick: current.pick === sent.pick ? saved.pick : current.pick,
    name: current.name === sent.name && !linked ? saved.name : current.name,
    setting: current.setting === sent.setting ? saved.setting : current.setting,
  };
}

/** What the card says once Add a grinder has a grinder in Decaid's list: picked, so saved at once. */
export function pickedNote(grinder: Grinder, added: boolean): string {
  const label = grinderLabel(grinder);
  return added ? `Added ${label} to Decaid's grinders, and picked it.` : `Decaid already has ${label}, so CafAI picked it.`;
}

export function GrinderCard() {
  const { storage, coach, decaid, plugins } = useServices();
  const column = useGroupScroll();
  const [form, setForm] = useState<GrinderForm | null>(null);
  const [saved, setSaved] = useState<SavedGrinder>({ grinderId: null, grinderName: null });
  const [library, setLibrary] = useState<GrinderLibrary>({ status: 'loading' });
  const [keyNotice, setKeyNotice] = useState(false);
  // What the last Add a grinder said, until the next change.
  const [addNote, setAddNote] = useState<string | null>(null);
  // DYE2's Grinders page edits Decaid's grinders; it is there only while Decaid runs DYE2 (D103).
  const dye2Loaded = useSyncExternalStore(plugins.subscribe, () => plugins.isLoaded(PLUGIN.dye2));
  // Picks so far: each brings the setting control and the line under the card into view.
  const [picks, setPicks] = useState(0);
  const settingRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLParagraphElement>(null);
  const note = useSaveNote();
  const { failed } = note;
  // Only the newest save speaks; and what storage holds, or what is on its way there, is not sent again.
  const latest = useRef(0);
  const stored = useRef<string | null>(null);
  const sending = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    storage.settings
      .get()
      .then((settings) => {
        if (!live) return;
        stored.current = keyOf(settings);
        setSaved({ grinderId: settings.grinderId ?? null, grinderName: settings.grinderName });
        setForm(formFrom(settings));
      })
      .catch((error: unknown) => {
        if (live) failed(`Could not read the settings: ${error instanceof Error ? error.message : String(error)}`);
      });
    return () => {
      live = false;
    };
  }, [storage, failed]);

  // Decaid's grinder library, read each time the card opens. An empty list
  // is an answer too (a link it lacks is kept and says so); while Decaid
  // cannot be reached the free-text fields show.
  useEffect(() => {
    let live = true;
    listGrinders(decaid, { timeoutMs: GRINDER_LIST_TIMEOUT_MS })
      .then((grinders) => {
        if (live) setLibrary({ status: 'ready', grinders });
      })
      .catch((error: unknown) => {
        if (live) setLibrary(libraryAfterError(error));
      });
    return () => {
      live = false;
    };
  }, [decaid]);

  // Before paint: at 962x602 the setting and the line under it can sit below the fold.
  useLayoutEffect(() => {
    if (picks === 0 || !column?.current || !settingRef.current) return;
    revealInColumn(column.current, settingRef.current, lineRef.current);
  }, [picks, column]);

  const commit = async (next: GrinderForm, lib: GrinderLibrary = library) => {
    // Only CafAI's own settings: the engine carries the grinder to Decaid's workflow.
    const patch = grinderPatch(next, lib, saved);
    const key = keyOf(patch);
    if (key === (sending.current ?? stored.current)) return;
    sending.current = key;
    const ticket = ++latest.current;
    try {
      const result = await storage.settings.update(patch);
      if (ticket !== latest.current) return;
      sending.current = null;
      stored.current = keyOf(result);
      setSaved({ grinderId: result.grinderId ?? null, grinderName: result.grinderName });
      setForm((current) => (current ? afterSave(current, next, formFrom(result)) : current));
      setKeyNotice(tookKeyOut(['grinderName', 'grinderSetting'], patch, result));
      note.saved();
      await coach.refresh();
    } catch (error) {
      if (ticket !== latest.current) return;
      sending.current = null;
      note.failed(couldNotSave('the grinder', error));
    }
  };

  const change = (patch: Partial<GrinderForm>) => {
    if (form === null) return;
    const next = { ...form, ...patch };
    setForm(next);
    setAddNote(null);
    if (patch.pick !== undefined) {
      setPicks((count) => count + 1);
      void commit(next);
    } else if (patch.setting !== undefined && grinderView(next, library).setting === 'preset') {
      // A preset grinder's setting is picked from its list: saved at once, as a pick is.
      void commit(next);
    }
  };
  // Typed text is saved when its field is left, and on Enter.
  const onBlur = (_event: FocusEvent<HTMLDivElement>) => {
    if (form !== null) void commit(form);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement) || form === null) return;
    event.preventDefault();
    void commit(form);
  };
  // Added to Decaid's library (or found there): in the list and picked, so linked at once like any pick.
  const grinderAdded = ({ grinder, added }: AddedGrinder) => {
    const lib = withGrinder(library, grinder);
    setLibrary(lib);
    if (form === null) return;
    const next = { ...form, pick: grinder.id };
    setForm(next);
    setPicks((count) => count + 1);
    setAddNote(pickedNote(grinder, added));
    void commit(next, lib);
  };
  const disabled = form === null;

  return (
    <Section title={GRINDER_CARD_TITLE}>
      <Box sx={{ display: 'grid', gap: 2 }}>
        <Box onBlur={onBlur} onKeyDown={onKeyDown} sx={{ display: 'grid', gap: 2 }}>
          <GrinderFields
            form={form}
            library={library}
            savedName={saved.grinderName}
            disabled={disabled}
            onChange={change}
            settingRef={settingRef}
          />
        </Box>
        {/* Which way is finer on the grinder as saved, the one the coach turns (D241). */}
        <GrinderDirectionRow grinderKey={grinderDirectionKey(saved)} disabled={disabled} />
        <AddGrinder
          canAdd={canAddGrinder(library)}
          dye2Url={dye2Loaded ? dye2GrindersUrl(decaid.httpOrigin) : null}
          initialModel={form && form.pick === NOT_LISTED ? form.name : ''}
          disabled={disabled}
          note={addNote}
          add={(request) => addOrFindGrinder(decaid, request)}
          onAdded={grinderAdded}
        />
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: -1 }}>
          The coach uses your grinder and its dial setting to say how far to turn it.
        </Typography>
      </Box>
      <SaveLine note={note.note} testId={TID.settingsSaved('grinder')} lineRef={lineRef} />
      {keyNotice ? (
        <Alert severity="info" sx={{ mt: 1 }} onClose={() => setKeyNotice(false)}>
          {KEY_TAKEN_OUT}
        </Alert>
      ) : null}
    </Section>
  );
}
