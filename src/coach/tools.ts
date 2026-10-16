/**
 * Model-facing tool descriptions. The input schemas live in contract.ts; these
 * say what each tool is for and the rules the coach validators enforce, so a
 * call is right the first time instead of bouncing back as an error.
 */
import { TEMPLATE_IDS, TOOL, type ToolName } from './contract.ts';
import { FACT_TOPICS } from './facts/types.ts';
import { DOSE_RULES, GRIND_MAX_STEPS } from './validator.ts';

const SHOT_REF = 'shot: "latest", "previous", or a shotId from get_bag_history.';

export const COACH_TOOL_SPECS: Record<ToolName, { description: string; kind: 'ui' | 'auto' }> = {
  [TOOL.saveBagDetails]: {
    kind: 'auto',
    description:
      'Save what the user told you about this bag: a short name used in profile titles (e.g. "Kiambu AA", at most 40 characters), roaster, origin, roast level (light, medium-light, medium, medium-dark or dark), process, tasting notes and roast date (YYYY-MM-DD). Use null for anything the user has not told you; never guess. Call it once at intake, before propose_templates, and again only when the user corrects a detail: then send every detail as it was saved (your earlier call, or the intake\'s "bag") with the correction, because each call replaces all of them. Answers {"saved":true}.',
  },
  [TOOL.proposeTemplates]: {
    kind: 'ui',
    description: `Show 2-5 profile templates as cards, best first, each at most once. templateId must be a catalog id: ${TEMPLATE_IDS.join(', ')}. confidence is low, medium or high; reason is one or two short sentences on why it suits this bag: what the profile does with a coffee like it (soak, pressure, flow), never how the cup will taste. The user's tap loads that template as version 1 and comes back as the tool result; wait for it.`,
  },
  [TOOL.askUser]: {
    kind: 'ui',
    description:
      'Ask one short question with 2-5 short options (each at most 60 characters) for the user to tap. Never include "Other"; the app adds it as the last option, where the user can type. Set multiSelect true when several answers can apply. Use it after every shot to ask how it tasted, with the word "taste" in the question (e.g. "How did it taste?") and neutral options that cover the range, never a guess from the numbers: only the answer to a question that mentions taste is saved as the shot\'s taste, so leave the word out of other questions. Use it too for any choice the user should tap rather than type.',
  },
  [TOOL.proposeAdjustment]: {
    kind: 'ui',
    description: `Propose the next change: ONE variable. "profile" moves one lever of the current template: lever ids and bounds from the template catalog, value is the new absolute value. "grind" is a move at the grinder: direction, amount in the grinder's own dial steps (more than 0, at most ${GRIND_MAX_STEPS}) and/or the absolute setting as written on the grinder. "dose" is the new dose in grams (${DOSE_RULES.min}-${DOSE_RULES.max} g, at most ${DOSE_RULES.maxDelta} g per change). "none" keeps everything, to lock in a good shot. Fields the variable does not use are null. summary is one imperative line; rationale cites the shot data and the user's own taste words; expectedEffect says only what the change does at the machine (flow, time, pressure, extraction), never how the shot will taste; tips holds up to 3 reminders that change nothing. The user sees a before/after diff and confirms; a value outside the bounds comes back as an error to fix.`,
  },
  [TOOL.offerGrinder]: {
    kind: 'ui',
    description:
      'Offer to add the user\'s grinder to Decaid\'s grinder library, where CafAI reads its dial steps. Call it once, with no other card in the reply, when the user names the grinder they use and the context\'s grinder is not linked or is another one. model: the make and model as they said it (e.g. "Mazzer Philos"). burrs, settingType ("numeric": a numbered dial; "preset": a list of settings), smallStep and bigStep (a numbered dial\'s steps) and values (a preset grinder\'s settings, finest first): only as they said them, else null; never guess. The user taps Add or Not now on a card: nothing is added without the tap, and a grinder Decaid already has is linked, not added twice. The result is {"added":true,"alreadyInDecaid":true|false,"grinder":{as in the context}}, linked from then on, or {"added":false}; wait for it.',
  },
  [TOOL.getShotSummary]: {
    kind: 'auto',
    description: `Aggregates of one shot: dose, yield, ratio, time to first drop, preinfusion end, peak pressure, mean pour flow (pump and scale), temperature, resistance trend, channeling flags, stop reason, and the phases (preheat, then each profile step by name). Times are seconds from shot start, preheat included. ${SHOT_REF}`,
  },
  [TOOL.getShotSeries]: {
    kind: 'auto',
    description: `One metric of one shot at about one point per second: pressure (bar), flow (pump, ml/s), weight (g), weightFlow (scale, g/s), temperature (group, °C), targetPressure (bar), targetFlow (ml/s) or resistance (pressure / flow², bar·s²/ml²). fromS and toS bound the window in seconds from shot start; null means the whole shot. Prefer a window to the whole shot. ${SHOT_REF}`,
  },
  [TOOL.getPhaseStats]: {
    kind: 'auto',
    description: `Per phase of one shot (preheat, then each profile step): duration, mean and max pressure and flow, weight gained, temperature and targets; plus the read of the pre-pour stall: stall pressure with a verdict ("choking" means grind coarser; "under-pressured" means the profile holds low and the grind can stay). ${SHOT_REF}`,
  },
  [TOOL.compareShots]: {
    kind: 'auto',
    description:
      'Two shots side by side: their aggregates, B minus A for every number, whether they ran the same profile, and the profile changes between them. shotA and shotB: "latest", "previous", or shotIds from get_bag_history.',
  },
  [TOOL.getBagHistory]: {
    kind: 'auto',
    description:
      "This bag's profile versions (with each lever change) and its recent iterations, oldest first: shot ids, taste feedback, what was proposed and whether it was applied, declined, kept or undone. Check it before repeating a change, and to find shot ids.",
  },
  [TOOL.getRecentSetups]: {
    kind: 'auto',
    description:
      'Setups DYE2 (a Decaid plugin) recorded for this coffee: its batch in Decaid\'s bean library and earlier batches of the same bean, else its name and roaster. Answers {"available":true,"setups":[{"kind","sameBatch","profileTitle","grindSetting","doseG","yieldG","rpm","basket","date"}],"equipment":[...],"baskets":[...]} (null where DYE2 recorded nothing; equipment and basket names DYE2 knows), or {"available":false} without DYE2. kind "recent" is one DYE2 saw used lately, which says nothing about how it tasted; "favourite" and "recipe" are ones the user saved. sameBatch is false for an earlier batch of the same bean, null when unknown. Read-only. Call it at intake when the coffee came from Decaid\'s bean library or was brewed before; for a bag described in words, after save_bag_details, as it has no name to match before.',
  },
  [TOOL.shareFunFact]: {
    kind: 'auto',
    description: `Share one fun fact about this bag, shown in a quiet block of its own under your reply: topic (${FACT_TOPICS.join(', ')}), about (a short label, at most 80 characters, e.g. "Kenya's SL28"), fact (one or two plain sentences, at most 280 characters, true as written) and source (the https address of the page you read it on, else null). Only when you are sure of it and it is about this bag; never what this cup tastes like or will. CafAI sends back a fact that says how the cup tastes, with the reason. Answers {"shown":true}; at most one per reply.`,
  },
};
