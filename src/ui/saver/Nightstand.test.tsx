// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ServicesProvider } from '../../app/services.tsx';
import type { CoachUiMessage } from '../../app/types.ts';
import { paletteFor } from '../appearance.ts';
import { KIAMBU, sampleSummary } from '../chat/testing/fixtures.ts';
import { TID } from '../testIds.ts';
import { createFakeServicesShowing } from '../testing/displayServices.ts';
import { createFakeServices } from '../testing/fakeServices.ts';
import { clockText, lastShotSummary, Nightstand, nightstandPlace, shotLine, shotNumbers, wakeLine } from './Nightstand.tsx';

const PALETTE = paletteFor({ mode: 'dark', tint: 'crema' }, false);

function shotMessage(id: string, durationS: number): CoachUiMessage {
  return { id, role: 'system', parts: [{ kind: 'shot', shotId: id, summary: sampleSummary({ shotId: id, durationS }) }] } as CoachUiMessage;
}

describe('the lines', () => {
  it('finds the newest shot in the conversation', () => {
    const text = { id: 't', role: 'assistant', parts: [{ kind: 'text', text: 'Nice.' }] } as CoachUiMessage;
    expect(lastShotSummary([])).toBeNull();
    expect(lastShotSummary([text])).toBeNull();
    expect(lastShotSummary([shotMessage('a', 25), text, shotMessage('b', 31), text])?.shotId).toBe('b');
  });

  it('writes the last shot in one line, as History does', () => {
    expect(shotLine(sampleSummary())).toBe('Last shot: 27.8 s · 18.0 g → 36.4 g · 1:2.0 · peak 8.9 bar');
  });

  it("gives Brew Rain the shot's peak pressure, yield and time, and nothing without a shot", () => {
    expect(shotNumbers(sampleSummary())).toEqual(['8.9', '36.4', '28']);
    expect(shotNumbers(sampleSummary({ peakPressureBar: null, yieldG: null }))).toEqual(['28']);
    expect(shotNumbers(null)).toEqual([]);
  });

  it('says when the machine wakes: the time within a day, the day too beyond it', () => {
    const now = new Date(2026, 9, 22, 22, 15);
    expect(wakeLine(new Date(2026, 9, 23, 6, 0), now, '24h')).toBe('Wakes at 06:00');
    expect(wakeLine(new Date(2026, 9, 25, 6, 30), now, '24h')).toBe('Wakes Sunday at 06:30');
    expect(wakeLine(new Date(2026, 9, 23, 6, 0), now, '12h')).toBe('Wakes at 6:00 am');
    expect(wakeLine(new Date(2026, 9, 25, 6, 30), now, '12h')).toBe('Wakes Sunday at 6:30 am');
  });

  it('writes the time in the clock chosen: 24-hour, or 12-hour with am or pm (D245)', () => {
    expect(clockText(new Date(2026, 9, 22, 6, 5), '24h')).toBe('06:05');
    expect(clockText(new Date(2026, 9, 22, 21, 40), '24h')).toBe('21:40');
    expect(clockText(new Date(2026, 9, 22, 6, 5), '12h')).toBe('6:05 am');
    expect(clockText(new Date(2026, 9, 22, 21, 40), '12h')).toBe('9:40 pm');
  });
});

describe('nightstandPlace', () => {
  const area = { width: 962, height: 602 };
  const block = { width: 300, height: 200 };

  it('keeps the block a tenth of the screen from every edge', () => {
    for (let minute = 0; minute < 200; minute += 1) {
      const { left, top } = nightstandPlace(20_383, minute, area, block);
      expect(left).toBeGreaterThanOrEqual(96);
      expect(left + block.width).toBeLessThanOrEqual(962 - 96 + 1);
      expect(top).toBeGreaterThanOrEqual(60);
      expect(top + block.height).toBeLessThanOrEqual(602 - 60 + 1);
    }
  });

  it('is the same place for the same seed and minute, and moves from minute to minute', () => {
    expect(nightstandPlace(5, 100, area, block)).toEqual(nightstandPlace(5, 100, area, block));
    const places = new Set(Array.from({ length: 10 }, (_, minute) => JSON.stringify(nightstandPlace(5, minute, area, block))));
    expect(places.size).toBeGreaterThan(5);
    expect(nightstandPlace(6, 100, area, block)).not.toEqual(nightstandPlace(5, 100, area, block));
  });

  it('centres a block too big for the margins', () => {
    expect(nightstandPlace(5, 1, { width: 400, height: 300 }, { width: 380, height: 290 })).toEqual({ left: 10, top: 5 });
  });
});

describe('Nightstand', () => {
  const sizes = { clientWidth: 962, clientHeight: 602, offsetWidth: 300, offsetHeight: 200 };
  const saved = new Map<string, PropertyDescriptor | undefined>();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date(2026, 9, 22, 22, 15, 30));
    for (const [name, value] of Object.entries(sizes)) {
      saved.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value });
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    }
  });

  function renderNightstand(services = createFakeServices()) {
    const onPainted = vi.fn();
    const view = render(
      <ServicesProvider services={services}>
        <Nightstand palette={PALETTE} seed={20_383} onPainted={onPainted} />
      </ServicesProvider>,
    );
    return { ...view, onPainted, services };
  }

  it('shows the time, the next wake, the bag on the machine and the last shot', async () => {
    const services = createFakeServices({
      coach: { activeBag: KIAMBU, messages: [shotMessage('s1', 28.1)] },
    });
    services.decaid.presence = {
      ...services.decaid.presence,
      schedules: [{ id: 'w1', time: '06:00', daysOfWeek: [], enabled: true }],
    };
    const { onPainted } = renderNightstand(services);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId(TID.nightstandTime)).toHaveTextContent('22:15');
    const block = screen.getByTestId(TID.nightstand);
    expect(block).toHaveTextContent('Wakes at 06:00');
    expect(block).toHaveTextContent(KIAMBU.name);
    expect(block).toHaveTextContent('Last shot: 28.1 s · 18.0 g → 36.4 g · 1:2.0 · peak 8.9 bar');
    expect(onPainted).toHaveBeenCalledTimes(1);
  });

  it('shows the time alone when nothing else is known', async () => {
    const services = createFakeServices();
    services.decaid.failNext('getPresenceSettings', new Error('Decaid is away'));
    renderNightstand(services);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId(TID.nightstand).textContent).toBe('22:15');
  });

  it('moves the time on and jumps to a new place each minute', async () => {
    renderNightstand();
    await act(async () => {
      await Promise.resolve();
    });
    const block = screen.getByTestId(TID.nightstandTime).parentElement!;
    const place = () => `${getComputedStyle(block).left} ${getComputedStyle(block).top}`;
    const first = place();
    expect(first).toMatch(/^\d+px \d+px$/);
    // The minute turns 30 s on: the clock follows it, a moment after it begins.
    act(() => void vi.advanceTimersByTime(30_100));
    expect(screen.getByTestId(TID.nightstandTime)).toHaveTextContent('22:16');
    const second = place();
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.getByTestId(TID.nightstandTime)).toHaveTextContent('22:17');
    const third = place();
    expect(new Set([first, second, third]).size).toBeGreaterThan(1);
    expect([second, third]).toEqual([
      ((p) => `${p.left}px ${p.top}px`)(nightstandPlace(20_383, Math.floor(new Date(2026, 9, 22, 22, 16).getTime() / 60_000), { width: 962, height: 602 }, { width: 300, height: 200 })),
      ((p) => `${p.left}px ${p.top}px`)(nightstandPlace(20_383, Math.floor(new Date(2026, 9, 22, 22, 17).getTime() / 60_000), { width: 962, height: 602 }, { width: 300, height: 200 })),
    ]);
  });

  it('draws outside a ServicesProvider too, with the time alone', () => {
    render(<Nightstand palette={PALETTE} seed={1} />);
    expect(screen.getByTestId(TID.nightstand).textContent).toBe('22:15');
  });

  it('on the 12-hour clock writes the time with am or pm, the half smaller, and the wake that way (D245)', async () => {
    const services = createFakeServicesShowing({ clock: '12h' });
    services.decaid.presence = { ...services.decaid.presence, schedules: [{ id: 'w1', time: '06:00', daysOfWeek: [], enabled: true }] };
    renderNightstand(services);
    await act(async () => {
      await Promise.resolve();
    });
    const time = screen.getByTestId(TID.nightstandTime);
    expect(time).toHaveTextContent('10:15 pm');
    // The machine-readable time stays 24-hour.
    expect(time).toHaveAttribute('datetime', '22:15');
    expect(screen.getByText('pm').tagName).toBe('SPAN');
    expect(screen.getByTestId(TID.nightstand)).toHaveTextContent('Wakes at 6:00 am');
  });
});
