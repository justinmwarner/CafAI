/**
 * Reading a photo of the bag (6.8): one request to the coach's model with
 * the photo and a short instruction, answered as JSON with the bag's
 * details, each null when the bag does not show it. CafAI's client only
 * streams, so the reply is collected from the stream; zod checks it before
 * anything uses it, keeping what fits and dropping the rest.
 *
 * The photo goes into this one request and nowhere else: nothing here
 * stores, logs or returns it.
 */
import { z } from 'zod';
import { BAG_LIMITS, toRoastLevel, type RoastLevel } from '../coach/contract.ts';
import { writtenDate } from '../coach/roastAge.ts';
import { extractJsonObject } from './parse.ts';
import { contentText } from './runner.ts';
import { LlmError, type ImageBlock, type LlmProvider, type LlmRequest } from './types.ts';

/** The photo as it is sent: base64 without a data URL's prefix (src/ui/chat/bagPhoto.ts makes it). */
export interface BagPhoto {
  mediaType: ImageBlock['source']['media_type'];
  data: string;
}

/** The bag's details as read from the photo; null where the bag does not say. */
export interface ExtractedBag {
  name: string | null;
  roaster: string | null;
  origin: string | null;
  process: string | null;
  roastLevel: RoastLevel | null;
  /** YYYY-MM-DD. */
  roastDate: string | null;
  notes: string | null;
  /** The farm or producer, the varieties and the altitude as printed (D278). */
  producer: string | null;
  variety: string | null;
  altitude: string | null;
  /** Anything else of note printed on the bag that none of the fields hold. */
  other: string | null;
}

export const EXTRACT_BAG_PROMPT = [
  'This photo should show a bag of coffee beans. Read what is printed on it and answer with only this JSON object, no other text:',
  '{"name":string|null,"roaster":string|null,"origin":string|null,"process":string|null,"roastLevel":"light"|"medium-light"|"medium"|"medium-dark"|"dark"|null,"roastDate":"YYYY-MM-DD"|null,"notes":string|null,"producer":string|null,"variety":string|null,"altitude":string|null,"other":string|null}',
  `name is the coffee's short name as printed (at most ${BAG_LIMITS.name} characters, e.g. "Kiambu AA"); origin the country and region; process e.g. "washed"; notes the tasting notes, comma separated. producer is the farm, estate, cooperative or producer (for "Produced by El Paraíso", "El Paraíso"); variety the varieties, comma separated (e.g. "Castillo, Caturra"); altitude as printed, with its unit (e.g. "1,950 masl"). other holds anything else printed that a barista would want and none of the fields hold, in a few words each, separated by "; " (e.g. a lot number, the harvest, the importer, a fermentation, decaf, a recommended recipe), at most ${BAG_LIMITS.other} characters; never the roaster's address, a website, a story or a slogan. roastDate is the day the coffee was roasted, not a best-before, packed or sell-by date, and null when its day, month or year is not clear. Use null for anything the bag does not show; never guess. If the photo is not of a coffee bag, answer with every field null.`,
].join('\n');

/** Room for the JSON and the model's own thinking. */
const MAX_TOKENS = 4096;
const UNREADABLE = "CafAI could not read the coffee's details in that photo. Try another one.";

/** Text cut to what CafAI keeps; blank, or not text, is null. */
const detail = (max: number) =>
  z
    .string()
    .transform((value) => value.trim().slice(0, max).trim() || null)
    .nullable()
    .catch(null);

const AnswerSchema = z.object({
  name: detail(BAG_LIMITS.name),
  roaster: detail(BAG_LIMITS.roaster),
  origin: detail(BAG_LIMITS.origin),
  process: detail(BAG_LIMITS.process),
  // Caught too: zod refuses a key left out of the answer even where any value would do, and that sank the whole card.
  roastLevel: z.unknown().transform(toRoastLevel).catch(null),
  roastDate: z
    .unknown()
    .transform((value) => (typeof value === 'string' ? writtenDate(value) : null))
    .catch(null),
  notes: detail(BAG_LIMITS.notes),
  // Like every field, one left out of the answer is unknown (detail's catch): the rest still fill the card (D278).
  producer: detail(BAG_LIMITS.producer),
  variety: detail(BAG_LIMITS.variety),
  altitude: detail(BAG_LIMITS.altitude),
  other: detail(BAG_LIMITS.other),
});

/** The model's answer as CafAI keeps it. Throws an LlmError with a sentence when it holds no details at all. */
export function parseExtractedBag(answer: string): ExtractedBag {
  const json = extractJsonObject(answer);
  let raw: unknown;
  try {
    raw = json === null ? null : JSON.parse(json);
  } catch {
    raw = null;
  }
  const parsed = AnswerSchema.safeParse(raw);
  if (!parsed.success || Object.values(parsed.data).every((value) => value === null)) throw new LlmError('protocol', UNREADABLE);
  return parsed.data;
}

export interface ExtractBagOptions {
  provider: LlmProvider;
  /** The coach's model, as chosen in Settings. */
  model: string;
  photo: BagPhoto;
  signal?: AbortSignal;
}

/** Ask the model to read the bag in `photo`: one request, no tools, the reply collected from the stream. */
export async function extractBag(options: ExtractBagOptions): Promise<ExtractedBag> {
  const request: LlmRequest = {
    model: options.model,
    system: '',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: options.photo.mediaType, data: options.photo.data } },
          { type: 'text', text: EXTRACT_BAG_PROMPT },
        ],
      },
    ],
    tools: [],
    maxTokens: MAX_TOKENS,
    effort: 'low',
    // Sent once: caching it would only bill a cache write.
    cache: false,
    // The coach's usage counts it as a bag photo (D237).
    purpose: 'photo',
    call: 0,
  };
  if (options.signal) request.signal = options.signal;
  let answer: string | null = null;
  for await (const event of options.provider.stream(request)) {
    if (event.type === 'message_done') answer = contentText(event.turn.content);
  }
  if (answer === null) throw new LlmError('protocol', "The coach's reply ended early. Try again.");
  return parseExtractedBag(answer);
}
