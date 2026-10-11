// Questions for the guided setup. The answer in [brackets] is the default:
// Enter takes it. q (or Ctrl+C, or the end of the input) quits. `ask(question)`
// resolves with one line typed by the user; tests pass scripted answers.
import readline from 'node:readline/promises';
import { formatTime, parseTime } from './window.mjs';

/** Thrown when the user quits; setup ends without changing anything more. */
export class SetupQuit extends Error {
  constructor() {
    super('Setup stopped.');
    this.name = 'SetupQuit';
  }
}

async function answer(ask, question) {
  const text = String((await ask(question)) ?? '').trim();
  if (text.toLowerCase() === 'q') throw new SetupQuit();
  return text;
}

/**
 * Yes or no; Enter takes `fallback`.
 * @param {(question: string) => Promise<string>} ask
 * @param {string} question
 * @param {boolean} fallback
 */
export async function askYesNo(ask, question, fallback) {
  let prompt = `${question} ${fallback ? '[Y/n]' : '[y/N]'} `;
  for (;;) {
    const text = (await answer(ask, prompt)).toLowerCase();
    if (text === '') return fallback;
    if (text === 'y' || text === 'yes') return true;
    if (text === 'n' || text === 'no') return false;
    prompt = `Please type y or n. ${question} ${fallback ? '[Y/n]' : '[y/N]'} `;
  }
}

/**
 * One of numbered choices; Enter takes `fallback` (an index). Resolves with the index.
 * @param {(question: string) => Promise<string>} ask
 * @param {string} question
 * @param {string[]} choices
 * @param {number} [fallback]
 */
export async function askChoice(ask, question, choices, fallback = 0) {
  const listing = choices.map((choice, i) => `  ${i + 1}) ${choice}${i === fallback ? ' [default]' : ''}`).join('\n');
  let prompt = `${question}\n${listing}\nChoose 1-${choices.length} [${fallback + 1}]: `;
  for (;;) {
    const text = await answer(ask, prompt);
    if (text === '') return fallback;
    const n = Number(text);
    if (Number.isInteger(n) && n >= 1 && n <= choices.length) return n - 1;
    prompt = `Please type a number from 1 to ${choices.length} [${fallback + 1}]: `;
  }
}

/**
 * A time of day as "HH:MM"; Enter takes `fallback`.
 * @param {(question: string) => Promise<string>} ask
 * @param {string} question
 * @param {string} fallback  "05:00"
 */
export async function askTime(ask, question, fallback) {
  let prompt = `${question} [${fallback}]: `;
  for (;;) {
    const text = await answer(ask, prompt);
    if (text === '') return fallback;
    const minutes = parseTime(text);
    if (minutes !== null) return formatTime(minutes);
    prompt = `Please type a time such as 05:00. ${question} [${fallback}]: `;
  }
}

/** Wait for Enter (q quits). */
export async function pressEnter(ask, question) {
  await answer(ask, question);
}

/**
 * Questions on the terminal. `close()` lets the process end; Ctrl+C or the end
 * of the input makes the pending question quit setup.
 * @param {{ input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream }} [streams]
 */
export function terminalPrompt({ input = process.stdin, output = process.stdout } = {}) {
  let rl = null;
  let stop = null;
  return {
    ask: async (question) => {
      if (!rl) {
        rl = readline.createInterface({ input, output });
        stop = new AbortController();
        rl.on('SIGINT', () => stop.abort());
        rl.on('close', () => stop.abort());
      }
      try {
        return await rl.question(question, { signal: stop.signal });
      } catch {
        output.write('\n');
        throw new SetupQuit();
      }
    },
    close: () => {
      rl?.close();
      rl = null;
    },
  };
}
