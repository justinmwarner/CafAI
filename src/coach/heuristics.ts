/**
 * PLACEHOLDER coffee heuristics for the system prompt.
 *
 * This block is deliberately separate from prompt.ts: it is the one part of
 * the coach's knowledge that is not derived from verified sources. It restates
 * docs/RESEARCH.md section 8 (bean -> template, taste symptom -> lever, in
 * priority order), which is general espresso practice that no one has
 * reviewed for these templates yet. Replace `COACH_HEURISTICS` (or pass
 * `buildSystemPrompt(templates, { heuristics })`) once a coffee professional
 * has written the real rules; nothing else needs to change.
 */

export interface CoachHeuristics {
  /** "placeholder" until a coffee professional has reviewed the text. */
  status: 'placeholder' | 'reviewed';
  /** Plain lines for the system prompt. */
  text: string;
}

export const COACH_HEURISTICS: CoachHeuristics = {
  status: 'placeholder',
  text: [
    'Starting points from general espresso practice, not verified rules. The shot data and the user\'s taste always win.',
    'Choosing a template:',
    '- Light roasts, especially washed and high-grown: blooming-espresso, ratio about 1:2.5-1:4.',
    '- Medium roasts: d-flow (blooming-espresso also works), ratio about 1:2-1:2.5.',
    '- Dark roasts: londonium, ratio about 1:1.8-1:2.2.',
    '- Naturals and anaerobics usually want 1-2 °C less than a washed coffee of the same roast.',
    'Taste to next move, in this order, one per shot:',
    '- Sour, thin: grind 1 step finer; then brew temperature +1-2 °C; then a longer ratio (more yield).',
    '- Bitter, harsh: a shorter ratio (less yield); then brew temperature -1-2 °C; then grind coarser.',
    '- Sour and bitter together, or astringent: check the channeling flags and suggest better puck prep or a longer bloom or soak; then a lower peak pressure.',
    '- Too strong: a longer ratio.',
    '- Weak, watery: a shorter ratio, or grind finer.',
    '- Muted, flat: brew temperature +1 °C, or a longer bloom or soak.',
    '- Lacks sweetness: move the ratio toward the middle of its range; then temperature.',
    'Expect 3-5 shots to dial in a bag.',
  ].join('\n'),
};
