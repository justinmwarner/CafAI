import { Fragment, useMemo } from 'react';
import Box from '@mui/material/Box';
import { parseRichText, withoutOpenMarkers, type RichInline } from './textBlocks.ts';

function Inline({ inlines }: { inlines: RichInline[] }) {
  return (
    <>
      {inlines.map((inline, i) => {
        switch (inline.kind) {
          case 'strong':
            return <strong key={i}>{inline.text}</strong>;
          case 'em':
            return <em key={i}>{inline.text}</em>;
          case 'code':
            return <code key={i}>{inline.text}</code>;
          case 'text':
            return <Fragment key={i}>{inline.text}</Fragment>;
        }
      })}
    </>
  );
}

const richTextSx = {
  // '&&' doubles the class: the chat bubble's own p, ul and ol margins would
  // otherwise win on specificity and run the paragraphs together.
  '&& > *': { m: 0 },
  // A paragraph or list break reads as one, unlike a wrapped line; a single
  // line break stays a <br> inside its paragraph.
  '&& > * + *': { mt: 1.5 },
  '& ul, & ol': { pl: 2.5 },
  '& li + li': { mt: 0.25 },
  '& code': { fontFamily: 'monospace', fontSize: '0.9em' },
} as const;

/**
 * Model text as React text nodes: never HTML, links or images (see textBlocks.ts).
 * While `streaming`, markup that has not closed yet shows without its markers.
 */
export function RichText({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const blocks = useMemo(() => parseRichText(streaming ? withoutOpenMarkers(text) : text), [text, streaming]);
  return (
    <Box sx={richTextSx}>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'paragraph':
            return (
              <p key={i}>
                {block.lines.map((line, j) => (
                  <Fragment key={j}>
                    {j > 0 ? <br /> : null}
                    <Inline inlines={line} />
                  </Fragment>
                ))}
              </p>
            );
          case 'heading':
            return (
              <p key={i}>
                <strong>
                  <Inline inlines={block.inlines} />
                </strong>
              </p>
            );
          case 'list': {
            const List = block.ordered ? 'ol' : 'ul';
            return (
              <List key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Inline inlines={item} />
                  </li>
                ))}
              </List>
            );
          }
        }
      })}
    </Box>
  );
}
