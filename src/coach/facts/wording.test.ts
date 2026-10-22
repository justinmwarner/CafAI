import { describe, expect, it } from 'vitest';
import { factWordingError } from './wording.ts';

describe('factWordingError: a fact never says how the cup tastes (D127, D199)', () => {
  it("passes a fact about the coffee, a flavour's source included", () => {
    for (const text of [
      "Kenya's SL28 was selected in the 1930s.",
      'Damascenone is linked to notes described as rose.',
      'Many washed Kenyans are fermented for 24 to 48 hours before drying on raised beds.',
      'The first roasters in Yemen shipped through the port of Mocha.',
      'Humans can taste bitterness at lower levels than sweetness.',
      'Milk proteins start to unfold above 60 °C, which is why steamed milk foams.',
      'Backflushing your espresso machine every week keeps the group screen clear.',
      'A shot timer starts with the pump, not with the first drop.',
      'Your grinder can be cleaned with a brush and rice-based tablets.',
      'Coffee cherries ripen unevenly, so pickers pass the same tree many times.',
    ]) {
      expect(factWordingError(text), text).toBeNull();
    }
  });

  it("sends back a fact that foretells or describes the barista's cup, naming the words", () => {
    const cases: Array<[string, string]> = [
      ['This coffee should taste of blackcurrant.', 'should taste'],
      ['A light roast will taste brighter.', 'will taste'],
      ["You'll taste the grapefruit first.", "You'll taste"],
      ['You can taste the altitude in it.', 'You can taste'],
      ['You may notice jasmine as it cools.', 'You may notice'],
      ['Expect a sweet finish.', 'Expect'],
      ['The blackcurrant in this cup comes from the soil.', 'this cup'],
      ['This shot shows the variety at its best.', 'This shot'],
      ['Your coffee tastes of blackcurrant because of SL28.', 'Your coffee tastes'],
      ['The sweetness in your cup comes from the slow ripening.', 'your cup'],
      ['Washed Kenyans are expected to be juicy.', 'expected'],
    ];
    for (const [text, words] of cases) {
      const error = factWordingError(text);
      expect(error, text).toContain(`("${words}")`);
      expect(error).toMatch(/Call share_fun_fact again with a fact about the coffee itself/);
      expect(error).toMatch(/never what this cup tastes like or will/);
    }
  });

  it('names the first of several in reading order', () => {
    expect(factWordingError('Expect jasmine: this cup should taste floral.')).toContain('("Expect")');
  });
});
