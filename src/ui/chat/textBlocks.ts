/**
 * A deliberately tiny reading of the model's markdown: paragraphs, line
 * breaks, lists, headings, **bold**, *emphasis* and `code`. Everything else
 * stays literal text and is rendered as React text nodes, so model output
 * can never become HTML, links or images (a link would navigate the
 * WebView away from the skin; an image would fetch from the network).
 */
export type RichInline = { kind: 'text' | 'strong' | 'em' | 'code'; text: string };

export type RichBlock =
  | { kind: 'paragraph'; lines: RichInline[][] }
  | { kind: 'heading'; inlines: RichInline[] }
  | { kind: 'list'; ordered: boolean; items: RichInline[][] };

// Markers need a non-space character on the inside of each delimiter, so
// "2 * 3 * 4" stays arithmetic. Underscores are never markup: snake_case
// flag names appear in coach text.
const INLINE = /\*\*(?=\S)([^*\n]*?\S)\*\*|\*(?=[^\s*])([^*\n]*?[^\s*])?\*|`([^`\n]+)`/g;

export function parseInline(text: string): RichInline[] {
  const out: RichInline[] = [];
  let last = 0;
  INLINE.lastIndex = 0;
  for (let match = INLINE.exec(text); match; match = INLINE.exec(text)) {
    if (match.index > last) out.push({ kind: 'text', text: text.slice(last, match.index) });
    const [whole, strong, em, code] = match;
    if (strong !== undefined) out.push({ kind: 'strong', text: strong });
    else if (code !== undefined) out.push({ kind: 'code', text: code });
    else out.push({ kind: 'em', text: em ?? whole.slice(1, -1) });
    last = match.index + whole.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

export function parseRichText(text: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  let paragraph: RichInline[][] | null = null;
  let list: { ordered: boolean; items: RichInline[][] } | null = null;

  const flush = () => {
    if (paragraph) blocks.push({ kind: 'paragraph', lines: paragraph });
    if (list) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items });
    paragraph = null;
    list = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.trim() === '') {
      flush();
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      const ordered = numbered !== null;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push(parseInline(item[1] ?? ''));
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', inlines: parseInline(heading[1] ?? '') });
      continue;
    }
    if (list) flush();
    if (!paragraph) paragraph = [];
    paragraph.push(parseInline(line.trim()));
  }
  flush();
  return blocks;
}
