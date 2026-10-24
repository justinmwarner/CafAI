/**
 * Settings > Coach > Model and replies: the model the coach runs on, with
 * what it suits and costs, and where fun facts come from (FunFactsRow.tsx,
 * D198). Each applies as it changes (D234): saved, then the coach re-reads
 * its settings, as Save settings did, and the line under the card says
 * "Saved." or why not. Fun facts are written only once chosen on this
 * device, so a restore can still fill a device that never chose (D198).
 * A model this build no longer offers stays chosen, listed as no longer
 * offered, until another is picked.
 *
 * A card a row at a time: How the coach replies (D243) takes its place
 * between the model and fun facts.
 */
import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DEFAULT_FUN_FACTS, type FunFactsSource } from '../../coach/facts/types.ts';
import type { ModelInfo } from '../../llm/types.ts';
import { useServices } from '../../app/services.tsx';
import type { Settings } from '../../storage/types.ts';
import { TID } from '../testIds.ts';
import { useCoachRunsOnComputer } from './coachSourceView.ts';
import { FunFactsRow } from './FunFactsRow.tsx';
import { couldNotSave, KEY_TAKEN_OUT, SaveLine, tookKeyOut, useSaveNote } from './SaveLine.tsx';
import { Section } from './Section.tsx';

export const MODEL_CARD_TITLE = 'Model and replies';

function price(model: ModelInfo): string {
  return `$${model.inputPerMTok} in / $${model.outputPerMTok} out per million tokens`;
}

const fieldSx = { '& .MuiInputBase-root': { minHeight: 48 } } as const;
/** A native select opens only from the select element itself, so it is the 48 px target. */
const selectSx = { ...fieldSx, '& .MuiNativeSelect-select': { py: '12.5px' } } as const;

interface ModelForm {
  model: string;
  /** Null while none was chosen on this device (D198): shown as DEFAULT_FUN_FACTS, and not saved. */
  funFacts: FunFactsSource | null;
}

const formFrom = (settings: Settings): ModelForm => ({ model: settings.model, funFacts: settings.funFacts ?? null });

/** What a change writes: the model, and fun facts once chosen here, so a later change carries an earlier one that failed. */
function patchOf(form: ModelForm): Partial<Settings> {
  return { model: form.model, ...(form.funFacts !== null ? { funFacts: form.funFacts } : {}) };
}

export function ModelCard() {
  const { storage, coach, models } = useServices();
  const onComputer = useCoachRunsOnComputer();
  const [form, setForm] = useState<ModelForm | null>(null);
  const [keyNotice, setKeyNotice] = useState(false);
  const save = useSaveNote();
  const { failed } = save;
  // Only the newest change speaks: one made after another carries it.
  const latest = useRef(0);

  useEffect(() => {
    let live = true;
    storage.settings
      .get()
      .then((settings) => {
        if (live) setForm(formFrom(settings));
      })
      .catch((error: unknown) => {
        if (live) failed(`Could not read the settings: ${error instanceof Error ? error.message : String(error)}`);
      });
    return () => {
      live = false;
    };
  }, [storage, failed]);

  const change = async (patch: Partial<ModelForm>) => {
    if (form === null) return;
    const next = { ...form, ...patch };
    setForm(next);
    const ticket = ++latest.current;
    const sent = patchOf(next);
    try {
      const saved = await storage.settings.update(sent);
      if (ticket !== latest.current) return;
      // The fields show what was really saved, not what was picked (a key is never a model).
      setForm(formFrom(saved));
      setKeyNotice(tookKeyOut(['model'], sent, saved));
      save.saved();
      await coach.refresh();
    } catch (error) {
      if (ticket === latest.current) save.failed(couldNotSave('the model and fun facts', error));
    }
  };

  const selected = models.find((m) => m.id === form?.model);
  const loading = form === null;

  return (
    <Section title={MODEL_CARD_TITLE}>
      <Box sx={{ display: 'grid', gap: 2 }}>
        <TextField
          select
          size="small"
          label="Model"
          value={form?.model ?? ''}
          disabled={loading}
          onChange={(event) => void change({ model: event.target.value })}
          helperText={selected ? `${selected.note} ${price(selected)}.` : ' '}
          sx={selectSx}
          slotProps={{
            select: { native: true },
            htmlInput: { 'data-testid': TID.modelSelect },
            inputLabel: { shrink: true },
          }}
        >
          {form && !selected ? <option value={form.model}>{form.model} (no longer offered)</option> : null}
          {loading ? <option value="">Loading…</option> : null}
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} · ${model.inputPerMTok} / ${model.outputPerMTok} per MTok
            </option>
          ))}
        </TextField>
        {onComputer ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: -1 }}>
            The prices do not apply while the coach runs on your computer: it uses your Claude plan.
          </Typography>
        ) : null}
        <FunFactsRow
          value={form ? (form.funFacts ?? DEFAULT_FUN_FACTS) : null}
          onComputer={onComputer}
          disabled={loading}
          onChange={(funFacts) => void change({ funFacts })}
        />
      </Box>
      <SaveLine note={save.note} testId={TID.settingsSaved('model')} />
      {keyNotice ? (
        <Alert severity="info" sx={{ mt: 1 }} onClose={() => setKeyNotice(false)}>
          {KEY_TAKEN_OUT}
        </Alert>
      ) : null}
    </Section>
  );
}
