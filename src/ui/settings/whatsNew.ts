/**
 * About > What's new (D248): the running version's section of CHANGELOG.md,
 * taken into the bundle when it is built (Vite's `?raw`, so it is there
 * offline and inside Decaid) and read here into headings, paragraphs and
 * bullet lists, without a markdown library: the changelog uses only those,
 * with **bold** and `code` in the words.
 *
 * A section is the lines under its heading, "## 0.1.3 (2026-10-23)", up to
 * the next "## "; a line that starts with "- " starts a bullet, and the
 * lines under it, up to a blank line or the next bullet, carry on its words,
 * as a paragraph's lines do. The version must be the heading's whole first
 * word: 0.1.3 is not 0.1.30, and the Unreleased section is no version's.
 */
import changelog from '../../../CHANGELOG.md?raw';

/** A run of words: plain, bold or code. */
export interface Span {
  text: string;
  strong?: true;
  code?: true;
}

export type NotesBlock =
  | { kind: 'heading'; spans: Span[] }
  | { kind: 'paragraph'; spans: Span[] }
  | { kind: 'list'; items: Span[][] };

export interface ReleaseNotes {
  version: string;
  /** The release's day, "2026-10-23", from its heading; null when the heading names none ("first release"). */
  date: string | null;
  blocks: NotesBlock[];
}

/** **bold**, `code` and [words](address), the address dropped: a link in the dialog would lead out of CafAI. */
const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\([^)\s]*\)/g;

export function inlineSpans(text: string): Span[] {
  const spans: Span[] = [];
  const plain = (words: string) => {
    if (!words) return;
    const last = spans[spans.length - 1];
    if (last && !last.strong && !last.code) last.text += words;
    else spans.push({ text: words });
  };
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    plain(text.slice(at, index));
    if (match[1] !== undefined) spans.push({ text: match[1], strong: true });
    else if (match[2] !== undefined) spans.push({ text: match[2], code: true });
    else plain(match[3] ?? '');
    at = index + match[0].length;
  }
  plain(text.slice(at));
  return spans;
}

/** A version's heading: its first word starts with a digit ("0.1.3"), so "## Unreleased" is none. */
const VERSION_HEADING = /^##\s+v?(\d\S*)/;
const DAY = /\((\d{4}-\d{2}-\d{2})\)/;

export function releaseNotes(markdown: string, version: string): ReleaseNotes | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => VERSION_HEADING.exec(line)?.[1] === version);
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && /^#{1,2}\s/.test(line));
  const section = lines.slice(start + 1, end < 0 ? lines.length : end);

  const blocks: NotesBlock[] = [];
  // What is being gathered: a paragraph's lines, or the current bullet's.
  let paragraph: string[] | null = null;
  let list: string[][] | null = null;
  let item: string[] | null = null;
  const close = () => {
    if (paragraph) blocks.push({ kind: 'paragraph', spans: inlineSpans(paragraph.join(' ')) });
    if (list) blocks.push({ kind: 'list', items: list.map((words) => inlineSpans(words.join(' '))) });
    paragraph = null;
    list = null;
    item = null;
  };

  for (const line of section) {
    const text = line.trim();
    if (!text) {
      // A blank line ends a paragraph and a bullet; the list goes on if another bullet follows.
      if (paragraph) close();
      item = null;
      continue;
    }
    const title = /^#{3,6}\s+(.*)$/.exec(text);
    if (title) {
      close();
      blocks.push({ kind: 'heading', spans: inlineSpans(title[1] ?? '') });
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (paragraph) close();
      item = [bullet[1] ?? ''];
      (list ??= []).push(item);
      continue;
    }
    // The lines under a bullet carry on its words, indented or not.
    if (item) {
      item.push(text);
      continue;
    }
    if (list) close();
    (paragraph ??= []).push(text);
  }
  close();

  if (blocks.length === 0) return null;
  const date = DAY.exec(lines[start] ?? '')?.[1] ?? null;
  return { version, date, blocks };
}

/** The running version's notes from the changelog built into CafAI, or null when it has no section. */
export function whatsNew(version: string): ReleaseNotes | null {
  return releaseNotes(changelog, version);
}
