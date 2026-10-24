// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/advice/provider.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: Opus 5.5 default, prices, effort and fallback support.
import type { ModelInfo } from './types.ts';

/**
 * The day the prices below were read from Anthropic's pricing page
 * (https://platform.claude.com/docs/en/about-claude/pricing), cache rates
 * included (D242). The usage card names it; a cost is worked out with the
 * prices of the day it was counted, so a later change never rewrites a past
 * month (D237).
 */
export const PRICES_AS_OF = '2026-10-24';

/** Anthropic's web search costs the same whatever the model: $10 per 1,000 searches (D237). */
export const WEB_SEARCH_USD_PER_1000 = 10;

/**
 * The models worth offering, so nobody has to guess an exact id.
 *
 * Ids are listed exactly as Anthropic publishes them (never with a date
 * suffix): a wrong id in a picker is worse than a blank field, because it
 * looks authoritative. Prices are USD per million tokens: the input, the
 * output, a write to the 5-minute prompt cache CafAI asks for (1.25x the
 * input) and a read from it (per model, from the pricing page).
 */
export const MODELS: readonly ModelInfo[] = [
  {
    id: 'claude-opus-5-5',
    label: 'Opus 5.5',
    note: 'Recommended. The best coaching for the price.',
    inputPerMTok: 4,
    outputPerMTok: 20,
    cacheWritePerMTok: 5,
    cacheReadPerMTok: 0.2,
    supportsEffort: true,
  },
  {
    id: 'claude-opus-5',
    label: 'Opus 5',
    note: 'The previous Opus. Similar advice, costs a little more.',
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheWritePerMTok: 6.25,
    cacheReadPerMTok: 0.5,
    supportsEffort: true,
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Sonnet 5.5',
    note: 'Quicker, at half the price of Opus 5.5. Good for most dial-ins.',
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheWritePerMTok: 2.5,
    cacheReadPerMTok: 0.1,
    supportsEffort: true,
  },
  {
    id: 'claude-haiku-5-5',
    label: 'Haiku 5.5',
    note: 'Fastest and cheapest; for a simple dial-in.',
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cacheWritePerMTok: 0.125,
    cacheReadPerMTok: 0.01,
    // Anthropic prices a Haiku 5.5 prompt of more than 100,000 tokens five times higher.
    longPrompt: { aboveTokens: 100_000, inputPerMTok: 0.5, outputPerMTok: 2.5, cacheWritePerMTok: 0.625, cacheReadPerMTok: 0.05 },
    supportsEffort: true,
  },
  {
    id: 'claude-fable-5-1',
    label: 'Fable 5.1',
    note: 'Most capable, and the most expensive.',
    inputPerMTok: 10,
    outputPerMTok: 50,
    cacheWritePerMTok: 12.5,
    cacheReadPerMTok: 0.25,
    supportsEffort: true,
  },
];

/**
 * Models CafAI offered before (D242): Sonnet 5.5 and Haiku 5.5 took their
 * places. A device that chose one keeps it (Settings lists it as no longer
 * offered), so its requests are still built right and its cost still known.
 */
export const FORMER_MODELS: readonly ModelInfo[] = [
  {
    id: 'claude-sonnet-5',
    label: 'Sonnet 5',
    note: 'Strong and cheaper than Opus.',
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheWritePerMTok: 2.5,
    cacheReadPerMTok: 0.2,
    supportsEffort: true,
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Haiku 4.5',
    note: 'Cheapest and quickest. Fine for straightforward dial-in.',
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheWritePerMTok: 1.25,
    cacheReadPerMTok: 0.1,
    // Haiku 4.5 answers an effort setting with an error.
    supportsEffort: false,
  },
];

/** Every model CafAI knows the rules and prices of: those it offers, then those it offered. */
export const KNOWN_MODELS: readonly ModelInfo[] = [...MODELS, ...FORMER_MODELS];

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
 * Describe a model id: one offered, or one offered before. An id we do not
 * know (typed by hand, or newer than this build) gets a generic entry that
 * never sends `effort`, the one setting an unknown model might reject. Its
 * prices are 0, meaning "not known".
 */
export function modelInfo(id: string): ModelInfo {
  const trimmed = id.trim();
  const known = KNOWN_MODELS.find((m) => m.id === trimmed);
  if (known) return known;
  return {
    id: trimmed,
    label: trimmed,
    note: 'A model id typed by hand. Check it is one your account can use.',
    inputPerMTok: 0,
    outputPerMTok: 0,
    cacheWritePerMTok: 0,
    cacheReadPerMTok: 0,
    supportsEffort: false,
  };
}

export function supportsRefusalFallbacks(id: string): boolean {
  return REFUSAL_FALLBACK_MODELS.includes(id.trim());
}

/** A price per million tokens as people read one: "$4", "$0.10", "$12.50", and "$0.125" where cents are not enough. */
export function priceText(usd: number): string {
  if (Number.isInteger(usd)) return `$${usd}`;
  return Number.isInteger(Math.round(usd * 100000) / 1000) ? `$${usd.toFixed(2)}` : `$${usd.toFixed(3)}`;
}
