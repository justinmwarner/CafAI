import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inlineSpans, releaseNotes, whatsNew } from './whatsNew.ts';

const CHANGELOG = `# Changelog

What changed in each release, newest first. Settings > About shows the
version you run.

## Unreleased

### The coach

- Something not released yet.

## 0.2.0 (2026-11-02)

A paragraph before the first heading,
over two lines.

### The coach

- **Settings > Coach > How the coach
  replies**: Quicker, Balanced or Thorough.
- Prices from \`src/llm/models.ts\`, read on
  [Anthropic's page](https://example.com/pricing).

- A bullet after a blank line stays in the list.

### Decaid

- One more.

## 0.1.0 (first release)

The first version.
`;

describe('releaseNotes (D248)', () => {
  it("finds the version's section by its heading, with its day, up to the next version's", () => {
    const notes = releaseNotes(CHANGELOG, '0.2.0');
    expect(notes?.version).toBe('0.2.0');
    expect(notes?.date).toBe('2026-11-02');
    const words = JSON.stringify(notes);
    expect(words).not.toContain('not released yet');
    expect(words).not.toContain('The first version.');
  });

  it('reads headings, paragraphs and bullet lists, joining the lines a paragraph or a bullet wraps over', () => {
    expect(releaseNotes(CHANGELOG, '0.2.0')?.blocks).toEqual([
      { kind: 'paragraph', spans: [{ text: 'A paragraph before the first heading, over two lines.' }] },
      { kind: 'heading', spans: [{ text: 'The coach' }] },
      {
        kind: 'list',
        items: [
          [{ text: 'Settings > Coach > How the coach replies', strong: true }, { text: ': Quicker, Balanced or Thorough.' }],
          [
            { text: 'Prices from ' },
            { text: 'src/llm/models.ts', code: true },
            { text: ", read on Anthropic's page." },
          ],
          [{ text: 'A bullet after a blank line stays in the list.' }],
        ],
      },
      { kind: 'heading', spans: [{ text: 'Decaid' }] },
      { kind: 'list', items: [[{ text: 'One more.' }]] },
    ]);
  });

  it('has no day for a heading that names none', () => {
    const notes = releaseNotes(CHANGELOG, '0.1.0');
    expect(notes?.date).toBeNull();
    expect(notes?.blocks).toEqual([{ kind: 'paragraph', spans: [{ text: 'The first version.' }] }]);
  });

  it('finds nothing for a version without a section, a near miss or the unreleased changes', () => {
    expect(releaseNotes(CHANGELOG, '0.1.3')).toBeNull();
    expect(releaseNotes(CHANGELOG, '0.2')).toBeNull();
    expect(releaseNotes(CHANGELOG, '0.2.0.1')).toBeNull();
    expect(releaseNotes(CHANGELOG, '0.1.0-test')).toBeNull();
    expect(releaseNotes(CHANGELOG, 'Unreleased')).toBeNull();
    // A version's dots are dots, not any character.
    expect(releaseNotes(CHANGELOG.replace('## 0.2.0 (', '## 0x2y0 ('), '0.2.0')).toBeNull();
  });

  it('finds nothing in a section with nothing in it', () => {
    expect(releaseNotes('## 0.3.0 (2026-12-01)\n\n## 0.2.0 (2026-11-02)\n\n- Something.\n', '0.3.0')).toBeNull();
  });

  it('reads a changelog saved with Windows line ends', () => {
    expect(releaseNotes(CHANGELOG.replace(/\n/g, '\r\n'), '0.2.0')?.blocks[0]).toEqual({
      kind: 'paragraph',
      spans: [{ text: 'A paragraph before the first heading, over two lines.' }],
    });
  });
});

describe('inlineSpans', () => {
  it('takes bold and code out of the words, and a link as its words', () => {
    expect(inlineSpans('Tap **TDS · Add**, then `drinkTds` on [Visualizer](https://visualizer.coffee).')).toEqual([
      { text: 'Tap ' },
      { text: 'TDS · Add', strong: true },
      { text: ', then ' },
      { text: 'drinkTds', code: true },
      { text: ' on Visualizer.' },
    ]);
  });

  it('leaves a lone star or backtick as it is', () => {
    expect(inlineSpans('5 * 2 is 10, and a ` alone')).toEqual([{ text: '5 * 2 is 10, and a ` alone' }]);
  });
});

describe("the changelog in the bundle (CHANGELOG.md through Vite's ?raw)", () => {
  it("has a section for package.json's version, so About always has What's new to show", () => {
    const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string };
    const notes = whatsNew(version);
    expect(notes?.version).toBe(version);
    expect(notes?.blocks.length).toBeGreaterThan(0);
  });
});
