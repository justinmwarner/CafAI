/**
 * The cleaning guide (D151, D155): Decent's routine for the DE1 by how often,
 * each step with a line on how and, where Decent's video shows it, its moment
 * there. The words are CafAI's own, from the video ("How often/to clean DE1",
 * Decent Espresso Tech, 2022) and Decent's current pages, read on 2026-10-15;
 * each step's sources are in the comment above it. Where the video and the
 * pages differ, the step follows the pages and its note says so. Nothing here
 * reaches the network: the screen builds the video's addresses on a tap.
 */
import type { RoutineId } from './routines.ts';

export interface CareLink {
  /** What the link says: "Decent's descaling steps". */
  label: string;
  /** Always one of Decent's pages (careGuide.test.ts checks). */
  url: string;
}

export interface CareStep {
  /** Unique in the guide, and never a routine's id: the step's test ids use it. */
  id: string;
  title: string;
  /** When, where the routine alone does not say: "After the day's last shot". */
  when?: string;
  how: string;
  /** Where to run what CafAI cannot run yet: "From streamline for now: …". */
  where?: string;
  /** Where the video and Decent's pages differ, or a thing worth knowing. */
  note?: string;
  link?: CareLink;
  /** Where the video shows it, in seconds. */
  moment?: number;
}

export interface CareRoutine {
  id: RoutineId;
  /** The segment's word, and the routine's heading. */
  label: string;
  /** How often, as a sentence: "Once a week." */
  cadence: string;
  /** The routine's own part of the video, in seconds. */
  moment?: number;
  steps: readonly CareStep[];
}

/** Decent's video, as YouTube lists it. */
export const CARE_VIDEO = {
  id: '0cm1JxB_6bI',
  title: 'How often/to clean DE1',
  channel: 'Decent Espresso Tech',
  year: 2022,
  /** Its length: 22:33. */
  seconds: 1353,
} as const;

/** "22 min". */
export const CARE_VIDEO_MINUTES = `${Math.floor(CARE_VIDEO.seconds / 60)} min`;

/** The line at the end of every routine. */
export const CARE_SOURCES =
  "From Decent's video (March 2022) and Decent's own pages. Where they differ, the steps follow the pages and say so.";

const DESCALING_PAGE = 'https://decentespresso.com/docs/de1_descaling_instructions';
const STEAM_TIP_PAGE = 'https://decentespresso.com/docs/how_to_replace_your_steam_tip';
const INTAKE_FILTER_PAGE = 'https://decentespresso.com/docs/the_actual_flow_rate_has_become_lower_than_the_machines_reading';

export const ROUTINES: readonly CareRoutine[] = [
  {
    id: 'daily',
    label: 'Daily',
    cadence: 'On days you pull shots.',
    moment: 20,
    steps: [
      // Quick start p.25 (take the jug away; "in a couple of seconds, a burst of pressure will clear the wand. Just point the
      // wand towards the drip tray") and the group head controller page ("Remove the milk jug before it does!").
      {
        id: 'purge-wand',
        title: 'Purge and wipe the steam wand',
        when: 'Each time you steam',
        how: 'Take the jug away as steam stops and point the wand at the drip tray: the DE1 clears it a moment later. Then wipe it with a damp cloth.',
      },
      // Quick start p.34 (daily with clean water, no detergent; "Use the Forward Flush x5 preset or the Flush button", at
      // least twice) and the video at 1:48 (a blind basket, Forward Flush x5 twice).
      {
        id: 'flush-group',
        title: 'Flush the group head',
        when: "After the day's last shot",
        how: 'Blind basket in, then Flush at least twice. Water only.',
        note: "Decent's Forward Flush x5 profile does the same in pulses, as in the video; streamline can run it.",
        moment: 108,
      },
      // Quick start pp.35-36 (wipe the shower screen; flush again with a coffee basket; rinse the portafilter).
      {
        id: 'wipe-screen',
        title: 'Wipe the shower screen',
        when: 'After the flush',
        how: 'Wipe the screen under the group head with a damp cloth. Then a coffee basket in, one more Flush, and rinse the portafilter.',
      },
      // Quick start p.37 (wipe the wand and steam clean water at the day's end; after a lot of milk, an ounce of Rinza, the tip
      // soaked about 10 minutes, "Do not steam!").
      {
        id: 'rinse-wand',
        title: 'Rinse the steam wand',
        when: "When you're done for the day",
        how: 'Wipe it, and steam a jug of clean water through. After a lot of milk, first soak the tip in a little Rinza for about 10 minutes, without steaming it.',
      },
    ],
  },
  {
    id: 'weekly',
    label: 'Weekly',
    cadence: 'Once a week.',
    moment: 460,
    steps: [
      // The Forward Flush x5 profile's own notes (Decaid's assets/defaultProfiles/Cleaning__Forward_Flush_x5_2.json: 3 g,
      // half a teaspoon; run it; portafilter off and Flush until the water goes clear; the profile again without detergent;
      // Flush for 20 seconds) and the video at 7:53 (3 g); quick start pp.40-41 (a tablespoon of Cafiza; never detergent in
      // the tank). Clean: Decent's app tour at 26:23 (a blind basket, a spoonful, Clean).
      {
        id: 'detergent-clean',
        title: 'Clean the group head with detergent',
        how: '3 g (half a teaspoon) of espresso machine detergent in the blind basket, then the Forward Flush x5 profile. Portafilter off, Flush until the water runs clear; rinse the basket and run the profile again without detergent. Last, Flush for 20 seconds. Never put detergent in the tank.',
        where: 'From streamline for now: the profile, or its Clean (Settings > Maintenance).',
        note: "Decent's quick start says a tablespoon; the profile's notes and the video, half a teaspoon.",
        moment: 473,
      },
      // Quick start p.39, "an alternate approach to soaking" (about 30 ml in 500 ml, or one tablet; "Steam the jug with the
      // Rinza-and-water solution"; then clean water twice) and the video at 11:11.
      {
        id: 'rinza',
        title: 'Steam Rinza through the wand',
        how: '30 ml of Rinza in 500 ml of water (or one tablet): steam the jug with it, then steam clean water through, twice.',
        note: "Decent's quick start gives steaming this diluted mix as the other way to the soak; Rinza any stronger is only soaked.",
        moment: 671,
      },
      // Quick start p.38 (weekly, soap and water; a refill kit turned off before the tank comes out) and the video at 6:52
      // (daily for hygiene; the tank, tray and cover in a dishwasher).
      {
        id: 'tank-tray',
        title: 'Wash the water tank and drip tray',
        how: 'The tank, the drip tray and its cover, with soap and water. With a refill kit, turn it off before you take the tank out.',
        note: "The video washes them every day, in a dishwasher; Decent's pages say weekly, with soap and water.",
        moment: 412,
      },
      // Decent's "The actual flow rate has become lower than the machine's reading" (photos of V1 and V2; V1: citric acid,
      // weekly or fortnightly; V2: baking soda, at least monthly, a pipe cleaner if clogged), the video at 15:04 (5% citric
      // acid, about 30 minutes; the time that page links in the video) and its description (V2: baking soda, 30 minutes to an
      // hour, then scrub gently).
      {
        id: 'intake-filter',
        title: 'Clean the intake filter',
        how: "The filter at the tank's intake (the thimble); Decent's page shows which one you have. V1: soak it in citric acid for about 30 minutes, every week or two. V2: in baking soda for 30 minutes to an hour, at least monthly, then scrub it gently (a pipe cleaner if it's clogged).",
        link: { label: "Decent's intake filter page", url: INTAKE_FILTER_PAGE },
        moment: 904,
      },
    ],
  },
  {
    id: 'monthly',
    label: 'Monthly',
    cadence: 'Every two to four weeks.',
    moment: 996,
    steps: [
      // Quick start pp.42-45 (machine off; the centre screw, then three; mind the temperature probe; 15 g of detergent in
      // about 500 g of hot water, overnight; the inner diffuser back first); the video at 16:56 (every two weeks, switched
      // off at the back); the v1.44 blog and Decent's group head upgrade video (Torx: T20 in the centre, T10 for the three).
      {
        id: 'group-parts',
        title: "Soak the group head's parts",
        how: 'Machine off and cool. The centre screw frees the shower screen and a diffuser, three more the inner one (mind the temperature probe). Soak them overnight in 15 g of detergent in 500 ml of hot water, rinse them in fresh water, and refit the inner diffuser first.',
        note: 'The video does this every two weeks. Since v1.44 (2023) the screws are Torx: T20 in the centre, T10 for the three.',
        moment: 1016,
      },
      // Decent's gasket page ("A dirty gasket is just as bad as a tired one") and its gasket video (water beading round the
      // portafilter; don't leave the portafilter locked in).
      {
        id: 'gasket',
        title: 'Look at the group gasket',
        how: 'While the parts are off, wipe the gasket. Hard, cracked, or water beading round the portafilter in a shot: time for a new one. Between sessions, leave the portafilter out.',
      },
    ],
  },
  {
    id: 'asNeeded',
    label: 'As needed',
    cadence: 'When your water, the steam or a move calls for it.',
    steps: [
      // The water page (under 30 ppm never; 30 to 120 ppm yearly; over 120 ppm at least twice a year); the descaling page
      // (under 120 ppm every year or two; citric acid only; the steam heater off and down to 60 °C, up to an hour; 80 g in
      // 1,540 ml; the steam tip off; 7 to 8 litres to rinse); the app tour (steam starting to oscillate); the video at 21:36
      // (hardly needed with 60 to 120 ppm water).
      {
        id: 'descale',
        title: 'Descale',
        when: 'Water under 30 ppm: never. 30 to 120 ppm: every year or two. Over 120 ppm: twice a year or more. Sooner if the steam starts to pulse.',
        how: "Citric acid only. Steam heater off until it's down to 60 °C (up to an hour), steam tip off, then the DE1's Descale with 80 g of citric acid in 1.5 litres of water. Rinse well: plan on 7 to 8 litres.",
        where: 'From streamline for now: Settings > Maintenance > Machine Descaling.',
        note: "The video says water of 60 to 120 ppm hardly needs it; Decent's pages say every year or two.",
        link: { label: "Decent's descaling steps", url: DESCALING_PAGE },
        moment: 1296,
      },
      // Quick start p.37 ("For stubborn clogs, unscrew the wand tip, soak it, and run a needle through the hole") and the
      // steam tip page (off and cool; a spoon on the inner tube so it is not pulled out; both O-rings); the video at 5:10
      // (every night).
      {
        id: 'steam-tip',
        title: 'Unclog the steam tip',
        when: 'When it clogs',
        how: 'Machine off and cool. Unscrew the tip, pressing a spoon on the tube inside so it stays put; soak the tip in hot water, push a needle through, check both O-rings, refit.',
        note: "The video takes the tip off every night; Decent's pages, only for a stubborn clog.",
        link: { label: "Decent's steam tip page", url: STEAM_TIP_PAGE },
        moment: 310,
      },
      // Decent's app tour at 36:41 (the tank forward; a minute or two; the water into the tank) and de1app ("You can turn
      // your machine off once it is out of water").
      {
        id: 'transport',
        title: 'Empty the machine to move it',
        when: 'Before a move, or a long time unused',
        how: "The DE1's Transport: with the water tank pulled forward, it empties its water into the tank in a minute or two. Then turn it off.",
        where: 'From streamline for now: Settings > Maintenance > Transport Mode.',
      },
    ],
  },
];

export function routineOf(id: RoutineId): CareRoutine {
  return ROUTINES.find((routine) => routine.id === id) ?? ROUTINES[0]!;
}

/** The units the guide's sentences use, as they follow a number. */
const UNIT_AFTER_NUMBER = /(\d) (g|ml|°C|ppm|litres|minutes|seconds)(?=[\s.,;:)]|$)/g;

/**
 * A number and its unit never part at a line's end ("60 °C", "500 ml"): the
 * space between them becomes a no-break space. CafAI's readouts are too short
 * to wrap; the guide's sentences are not.
 */
export function keepUnits(text: string): string {
  return text.replace(UNIT_AFTER_NUMBER, '$1 $2');
}

/** A moment as the video's own clock shows it: "1:48", "16:56". */
export function formatMoment(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** YouTube's player from its privacy-enhanced domain, at the moment, playing (D154). */
export function embedUrl(seconds: number): string {
  const start = Math.max(0, Math.floor(seconds));
  return `https://www.youtube-nocookie.com/embed/${CARE_VIDEO.id}?start=${start}&autoplay=1&rel=0&playsinline=1`;
}

/** The video on YouTube, at the moment (none for the start). */
export function watchUrl(seconds = 0): string {
  const start = Math.max(0, Math.floor(seconds));
  const page = `https://www.youtube.com/watch?v=${CARE_VIDEO.id}`;
  return start > 0 ? `${page}&t=${start}s` : page;
}
