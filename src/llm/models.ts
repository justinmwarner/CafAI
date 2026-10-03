// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/advice/provider.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: Opus 5.5 default, prices, effort and fallback support.
import type { ModelInfo } from './types.ts';

/**
 * The models worth offering, so nobody has to guess an exact id.
 *
 * Ids are listed exactly as Anthropic publishes them (never with a date
 * suffix): a wrong id in a picker is worse than a blank field, because it
 * looks authoritative. Prices are USD per million tokens, for the cost hint.
 */
export const MODELS: readonly ModelInfo[] = [
  {
    id: 'claude-opus-5-5',
    label: 'Opus 5.5',
    note: 'Recommended. The best coaching for the price.',
    inputPerMTok: 4,
    outputPerMTok: 20,
    supportsEffort: true,
  },
  {
    id: 'claude-opus-5',
    label: 'Opus 5',
    note: 'The previous Opus. Similar advice, costs a little more.',
    inputPerMTok: 5,
    outputPerMTok: 25,
    supportsEffort: true,
  },
  {
    id: 'claude-sonnet-5',
    label: 'Sonnet 5',
    note: 'Strong and cheaper than Opus.',
    inputPerMTok: 2,
    outputPerMTok: 10,
    supportsEffort: true,
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Haiku 4.5',
    note: 'Cheapest and quickest. Fine for straightforward dial-in.',
    inputPerMTok: 1,
    outputPerMTok: 5,
    // Haiku 4.5 answers an effort setting with an error.
    supportsEffort: false,
  },
  {
    id: 'claude-fable-5-1',
    label: 'Fable 5.1',
    note: 'Most capable, and the most expensive.',
    inputPerMTok: 10,
    outputPerMTok: 50,
    supportsEffort: true,
  },
];

export const DEFAULT_MODEL = 'claude-opus-5-5';

/**
 * Models whose safety classifiers can decline a request and that accept the
 * server-side `fallbacks` parameter. Sending it to any other model is an error.
 */
const REFUSAL_FALLBACK_MODELS: readonly string[] = ['claude-opus-5', 'claude-fable-5-1'];

/** A blank setting means the default; anything else is used as typed (trimmed). */
export function resolveModel(id: string | null | undefined): string {
  const trimmed = (id ?? '').trim();
  return trimmed === '' ? DEFAULT_MODEL : trimmed;
}

/**
 * Describe a model id. An id we do not know (typed by hand, or newer than this
 * build) gets a generic entry that never sends `effort`, the one setting an
 * unknown model might reject. Its prices are 0, meaning "not known".
 */
export function modelInfo(id: string): ModelInfo {
  const trimmed = id.trim();
  const known = MODELS.find((m) => m.id === trimmed);
  if (known) return known;
  return {
    id: trimmed,
    label: trimmed,
    note: 'A model id typed by hand. Check it is one your account can use.',
    inputPerMTok: 0,
    outputPerMTok: 0,
    supportsEffort: false,
  };
}

export function supportsRefusalFallbacks(id: string): boolean {
  return REFUSAL_FALLBACK_MODELS.includes(id.trim());
}
