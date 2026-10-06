import { describe, expect, it } from 'vitest';
import { parseInline, parseRichText, withoutOpenMarkers } from './textBlocks.ts';

const t = (text: string) => ({ kind: 'text', text });

describe('parseRichText', () => {
  it('keeps plain text as one paragraph', () => {
    expect(parseRichText('Pull a shot when you are ready.')).toEqual([
      { kind: 'paragraph', lines: [[t('Pull a shot when you are ready.')]] },
    ]);
  });

  it('keeps single line breaks inside a paragraph and splits on blank lines', () => {
    expect(parseRichText('Line one\r\nLine two\n\n\nNext paragraph')).toEqual([
      { kind: 'paragraph', lines: [[t('Line one')], [t('Line two')]] },
      { kind: 'paragraph', lines: [[t('Next paragraph')]] },
    ]);
  });

  it('turns dash, star and bullet lines into a list', () => {
    expect(parseRichText('Try this:\n- grind finer\n* same dose\n• same tamp')).toEqual([
      { kind: 'paragraph', lines: [[t('Try this:')]] },
      { kind: 'list', ordered: false, items: [[t('grind finer')], [t('same dose')], [t('same tamp')]] },
    ]);
  });

  it('turns numbered lines into an ordered list', () => {
    expect(parseRichText('1. Purge\n2) Pull')).toEqual([
      { kind: 'list', ordered: true, items: [[t('Purge')], [t('Pull')]] },
    ]);
  });

  it('starts a new list when the kind changes', () => {
    const blocks = parseRichText('- a\n1. b');
    expect(blocks.map((b) => b.kind === 'list' && b.ordered)).toEqual([false, true]);
  });

  it('renders markdown headings as emphasized lines', () => {
    expect(parseRichText('## Next step\nGrind finer')).toEqual([
      { kind: 'heading', inlines: [t('Next step')] },
      { kind: 'paragraph', lines: [[t('Grind finer')]] },
    ]);
  });

  it('drops empty input', () => {
    expect(parseRichText('')).toEqual([]);
    expect(parseRichText('\n  \n')).toEqual([]);
  });
});

describe('parseInline', () => {
  it('finds bold, emphasis and code', () => {
    expect(parseInline('**Sour** means *under*, see `temp`.')).toEqual([
      { kind: 'strong', text: 'Sour' },
      t(' means '),
      { kind: 'em', text: 'under' },
      t(', see '),
      { kind: 'code', text: 'temp' },
      t('.'),
    ]);
  });

  it('leaves unclosed markers and arithmetic alone', () => {
    expect(parseInline('**still streaming')).toEqual([t('**still streaming')]);
    expect(parseInline('2 * 3 * 4')).toEqual([t('2 * 3 * 4')]);
  });

  it('never interprets underscores, so snake_case survives', () => {
    expect(parseInline('pressure_dip_after_peak')).toEqual([t('pressure_dip_after_peak')]);
  });

  it('keeps HTML as literal text', () => {
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([t('<img src=x onerror=alert(1)>')]);
  });
});

describe('withoutOpenMarkers (a reply still streaming)', () => {
  it('leaves out the marker of bold, emphasis or code that has not closed yet', () => {
    expect(withoutOpenMarkers('That usually means **under-extr')).toBe('That usually means under-extr');
    expect(withoutOpenMarkers('Pour it *slow')).toBe('Pour it slow');
    expect(withoutOpenMarkers('See `get_phase')).toBe('See get_phase');
  });

  it('leaves out a marker that has only just arrived', () => {
    expect(withoutOpenMarkers('That usually means **')).toBe('That usually means ');
    expect(withoutOpenMarkers('That usually means *')).toBe('That usually means ');
    expect(withoutOpenMarkers('See `')).toBe('See ');
  });

  it('leaves out the first half of a closing pair together with its opener', () => {
    expect(withoutOpenMarkers('means **under-extraction*')).toBe('means under-extraction');
  });

  it('keeps complete spans, arithmetic and list markers as they are', () => {
    for (const text of ['means **under-extraction**', '**Sour** means *under*, see `temp`.', '2 * 3', '* same dose', '`a **b`']) {
      expect(withoutOpenMarkers(text), text).toBe(text);
    }
  });

  it('leaves out every marker still open on the last line, around complete spans', () => {
    expect(withoutOpenMarkers('**Grind** finer, then *taste')).toBe('**Grind** finer, then taste');
    expect(withoutOpenMarkers('- **Grind fin')).toBe('- Grind fin');
    expect(withoutOpenMarkers('Keep **bold `code')).toBe('Keep bold code');
  });

  it('keeps a code span that is still arriving as it is typed', () => {
    expect(withoutOpenMarkers('Use `2*dose')).toBe('Use 2*dose');
  });

  it('changes only the last line: earlier lines are complete', () => {
    expect(withoutOpenMarkers('Keep **this\nand **that')).toBe('Keep **this\nand that');
  });
});
