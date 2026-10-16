/**
 * A fun fact keeps to the coffee (D199, narrowing D127): it may say where a
 * note on the bag comes from, which the barista has read already, but never
 * what this cup, this shot or "your coffee" tastes like, or will. CafAI reads
 * every fact in its list for it (facts.test.ts) and sends back a coach's
 * share_fun_fact that does it, as it does a proposal's words.
 */

/** A taste foretold: "should taste", "will taste", "you'll taste", "you may notice", "expect". */
const CUP_FORETOLD = [
  String.raw`\b(?:should|will|would|could|might|may|must|ought\s+to|going\s+to)\s+(?:\w+\s+){0,2}?tast(?:e|es|ing)\b`,
  String.raw`\b\w+['’]ll\s+(?:\w+\s+)?tast(?:e|es|ing)\b`,
  String.raw`\byou(?:['’]ll|['’]d|\s+will|\s+would|\s+may|\s+might|\s+should|\s+can|\s+could)\s+(?:\w+\s+){0,2}?(?:tast|notic|detect|smell|sens)\w*`,
  String.raw`\bexpect\w*`,
];

/** What a cup, a shot or a drink is but the barista's own. */
const DRINK = String.raw`(?:cups?|shots?|espressos?|drinks?)\b(?!\s+(?:machines?|makers?|baskets?|glass(?:es)?|timers?|times?|scales?)\b)`;

/** The barista's cup named: "this cup", "this shot", "your cup", "your coffee tastes". */
const CUP_NAMED = [String.raw`\b(?:this|that)\s+${DRINK}`, String.raw`\byour\s+${DRINK}`, String.raw`\byour\s+coffee\s+(?:\w+\s+){0,2}?(?:tast|smell)\w*`];

const CUP = new RegExp([...CUP_FORETOLD, ...CUP_NAMED].join('|'), 'i');

/** A sentence for the coach when a fact says how the barista's cup tastes, naming the words; null when it keeps to the coffee. */
export function factWordingError(text: string): string | null {
  const found = CUP.exec(text);
  if (!found) return null;
  return (
    `The fact foretells or describes the barista's cup ("${found[0]}"). Call share_fun_fact again with a fact about the coffee itself ` +
    '(where it grows, who grows or roasts it, how it is processed, where the notes on its bag come from), never what this cup ' +
    "tastes like or will: the taste is the barista's to find."
  );
}
