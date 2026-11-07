import { describe, expect, it } from 'vitest';
import { EXTRACT_BAG_PROMPT, extractBag, parseExtractedBag, type BagPhoto } from './extractBag.ts';
import { LlmError, type LlmProvider, type LlmRequest } from './types.ts';

const PHOTO: BagPhoto = { mediaType: 'image/jpeg', data: '/9j/4AAQSkZJRgABAQ==' };

const GOOD = {
  name: 'Kiambu AA',
  roaster: 'Square Mile',
  origin: 'Kenya, Kiambu',
  process: 'Washed',
  roastLevel: 'Light',
  roastDate: '2026-09-30',
  notes: 'blackcurrant, grapefruit, brown sugar',
  producer: 'Kiambu Farmers Cooperative',
  variety: 'SL28, SL34',
  altitude: '1,700-1,900 masl',
  other: 'Lot 42; harvest 2026',
};

/** A provider that answers one streamed turn with `text`, and keeps every request it got. */
function answering(text: string, requests: LlmRequest[] = []): LlmProvider {
  return {
    id: 'fake',
    async *stream(request) {
      requests.push(request);
      yield { type: 'message_start', id: 'msg-1', model: request.model };
      yield { type: 'text_delta', index: 1, text };
      yield {
        type: 'message_done',
        turn: {
          id: 'msg-1',
          model: request.model,
          content: [
            { type: 'thinking', thinking: '', signature: 'sig' },
            { type: 'text', text },
          ],
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      };
    },
  };
}

describe('parseExtractedBag', () => {
  it("reads the bag's details from the answer, as CafAI keeps them", () => {
    expect(parseExtractedBag(JSON.stringify(GOOD))).toEqual({ ...GOOD, roastLevel: 'light' });
  });

  it('finds the JSON inside a fenced or chatty answer', () => {
    expect(parseExtractedBag(`Here it is:\n\`\`\`json\n${JSON.stringify(GOOD)}\n\`\`\`\nEnjoy!`)).toMatchObject({ name: 'Kiambu AA' });
  });

  it('keeps what fits: a roast level of its own words, an unreadable date, blanks and odd values are null; long text is cut', () => {
    expect(
      parseExtractedBag(
        JSON.stringify({ name: `  ${'Kiambu AA Peaberry Reserve Lot 42 '.repeat(2)}`, roaster: '  ', origin: 7, process: null, roastLevel: 'City+', roastDate: '30/09/2026', notes: 'x'.repeat(400) }),
      ),
    ).toEqual({
      name: 'Kiambu AA Peaberry Reserve Lot 42 Kiambu',
      roaster: null,
      origin: null,
      process: null,
      roastLevel: null,
      roastDate: null,
      notes: 'x'.repeat(300),
      producer: null,
      variety: null,
      altitude: null,
      other: null,
    });
    expect(parseExtractedBag(JSON.stringify({ ...GOOD, roastLevel: 'medium dark' })).roastLevel).toBe('medium-dark');
  });

  it('reads the later details too, and an answer without them as not knowing them (D278)', () => {
    expect(
      parseExtractedBag(JSON.stringify({ name: 'Pink Bourbon', producer: '  El Paraíso ', variety: 'Pink Bourbon', altitude: '1,950 masl', other: 'Thermal shock' })),
    ).toMatchObject({ producer: 'El Paraíso', variety: 'Pink Bourbon', altitude: '1,950 masl', other: 'Thermal shock' });
    const { producer: _p, variety: _v, altitude: _a, other: _o, ...older } = GOOD;
    expect(parseExtractedBag(JSON.stringify(older))).toEqual({ ...older, roastLevel: 'light', producer: null, variety: null, altitude: null, other: null });
    expect(parseExtractedBag(JSON.stringify({ name: 'X', other: 'y'.repeat(600) })).other).toBe('y'.repeat(500));
  });

  it('refuses an answer with no details in it, with a sentence for the barista', () => {
    for (const answer of ['I cannot see a bag here.', '[1, 2]', '{"name": null, "roaster": null}', '{"name": "Kiambu', '']) {
      expect(() => parseExtractedBag(answer), answer).toThrow(LlmError);
    }
    expect(() => parseExtractedBag('{"name": null}')).toThrow("CafAI could not read the coffee's details in that photo. Try another one.");
  });
});

describe('extractBag (6.8)', () => {
  it("asks the coach's model once, with the photo and a short instruction, and no tools", async () => {
    const requests: LlmRequest[] = [];
    const bag = await extractBag({ provider: answering(JSON.stringify(GOOD), requests), model: 'claude-opus-5-5', photo: PHOTO });
    expect(bag).toMatchObject({ name: 'Kiambu AA', roastLevel: 'light', roastDate: '2026-09-30' });
    expect(requests).toHaveLength(1);
    const [request] = requests;
    // Nothing to cache: the photo is sent once. Counted as a bag photo, a reply of one call (D237).
    expect(request).toMatchObject({ model: 'claude-opus-5-5', system: '', tools: [], effort: 'low', cache: false, purpose: 'photo', call: 0 });
    expect(request!.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: PHOTO.data } },
          { type: 'text', text: EXTRACT_BAG_PROMPT },
        ],
      },
    ]);
  });

  it('asks for every field the confirm card shows, each null when the bag does not say', () => {
    for (const field of [
      '"name"',
      '"roaster"',
      '"origin"',
      '"process"',
      '"roastLevel"',
      '"roastDate"',
      '"notes"',
      '"producer"',
      '"variety"',
      '"altitude"',
      '"other"',
      'YYYY-MM-DD',
    ]) {
      expect(EXTRACT_BAG_PROMPT).toContain(field);
    }
    expect(EXTRACT_BAG_PROMPT).toMatch(/null for anything the bag does not show/);
    expect(EXTRACT_BAG_PROMPT).toMatch(/never guess/);
  });

  it('reads "Produced by" as the producer, and keeps the rest of what a barista would want in other (D278)', () => {
    expect(EXTRACT_BAG_PROMPT).toContain('for "Produced by El Paraíso", "El Paraíso"');
    expect(EXTRACT_BAG_PROMPT).toMatch(/other holds anything else printed that a barista would want/);
    expect(EXTRACT_BAG_PROMPT).toMatch(/never the roaster's address, a website, a story or a slogan/);
  });

  it('tells a roast date from the other dates on a bag, and leaves an unclear one out', () => {
    expect(EXTRACT_BAG_PROMPT).toMatch(/roastDate is the day the coffee was roasted, not a best-before, packed or sell-by date/);
    expect(EXTRACT_BAG_PROMPT).toMatch(/null when its day, month or year is not clear/);
  });

  it("passes the provider's own failure on", async () => {
    const failing: LlmProvider = {
      id: 'fake',
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new LlmError('overloaded', 'Anthropic is overloaded right now. Try again in a minute.', 529, true);
      },
    };
    await expect(extractBag({ provider: failing, model: 'claude-opus-5-5', photo: PHOTO })).rejects.toThrow('Anthropic is overloaded right now.');
  });

  it('refuses a reply that ended before the turn did', async () => {
    const cut: LlmProvider = {
      id: 'fake',
      async *stream(request) {
        yield { type: 'message_start', id: 'msg-1', model: request.model };
      },
    };
    await expect(extractBag({ provider: cut, model: 'claude-opus-5-5', photo: PHOTO })).rejects.toThrow(LlmError);
  });
});
