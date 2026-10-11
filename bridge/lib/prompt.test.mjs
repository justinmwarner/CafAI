import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { SetupQuit, askChoice, askTime, askYesNo, pressEnter, terminalPrompt } from './prompt.mjs';

/** An ask that answers from a list and records the questions. */
function scripted(...answers) {
  const ask = vi.fn(async () => {
    if (answers.length === 0) throw new Error('no answer left');
    return answers.shift();
  });
  return ask;
}

describe('the setup questions', () => {
  it('take Enter as the default in brackets, and y or n in any case', async () => {
    expect(await askYesNo(scripted(''), 'Keep it awake?', true)).toBe(true);
    expect(await askYesNo(scripted(''), 'Keep it awake?', false)).toBe(false);
    expect(await askYesNo(scripted('N'), 'Keep it awake?', true)).toBe(false);
    expect(await askYesNo(scripted('YES'), 'Keep it awake?', false)).toBe(true);
    const ask = scripted('maybe', 'y');
    expect(await askYesNo(ask, 'Keep it awake?', false)).toBe(true);
    expect(ask.mock.calls.map((call) => call[0])).toEqual(['Keep it awake? [y/N] ', 'Please type y or n. Keep it awake? [y/N] ']);
  });

  it('number the choices and mark the default', async () => {
    const ask = scripted('', '2', '9', '1');
    expect(await askChoice(ask, 'Where?', ['here', 'there'])).toBe(0);
    expect(ask.mock.calls[0][0]).toBe('Where?\n  1) here [default]\n  2) there\nChoose 1-2 [1]: ');
    expect(await askChoice(ask, 'Where?', ['here', 'there'], 1)).toBe(1);
    expect(await askChoice(ask, 'Where?', ['here', 'there'], 1)).toBe(0);
    expect(ask.mock.calls[3][0]).toBe('Please type a number from 1 to 2 [2]: ');
  });

  it('read a time of day as HH:MM', async () => {
    expect(await askTime(scripted(''), 'Start at', '05:00')).toBe('05:00');
    expect(await askTime(scripted('6:30'), 'Start at', '05:00')).toBe('06:30');
    const ask = scripted('25:00', '07:00');
    expect(await askTime(ask, 'Start at', '05:00')).toBe('07:00');
    expect(ask.mock.calls[1][0]).toBe('Please type a time such as 05:00. Start at [05:00]: ');
  });

  it('quit on q', async () => {
    await expect(askYesNo(scripted('q'), 'Go on?', true)).rejects.toBeInstanceOf(SetupQuit);
    await expect(askChoice(scripted('Q'), 'Where?', ['here'])).rejects.toBeInstanceOf(SetupQuit);
    await expect(askTime(scripted('q'), 'Start at', '05:00')).rejects.toBeInstanceOf(SetupQuit);
    await expect(pressEnter(scripted('q'), 'Press Enter')).rejects.toBeInstanceOf(SetupQuit);
    await expect(pressEnter(scripted(''), 'Press Enter')).resolves.toBeUndefined();
  });
});

describe('terminalPrompt', () => {
  it('reads one line per question, and quits when the input ends', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const prompt = terminalPrompt({ input, output });
    const first = prompt.ask('Name? ');
    input.write('Barista\n');
    expect(await first).toBe('Barista');
    const second = prompt.ask('More? ');
    input.end();
    await expect(second).rejects.toBeInstanceOf(SetupQuit);
    prompt.close();
  });
});
