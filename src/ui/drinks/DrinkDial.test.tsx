// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { useMemo, useSyncExternalStore } from 'react';
import { describe, expect, it } from 'vitest';
import { act, render, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { formatLocalTimestamp } from '../../../mock/decaid/clock.ts';
import type { MachineFrame } from '../../api/types.ts';
import { ServicesProvider, useServices } from '../../app/services.tsx';
import { buildPalette, namedTint } from '../palette.ts';
import { TID } from '../testIds.ts';
import { createFakeServices, IDLE_TELEMETRY, SAMPLE_WORKFLOW } from '../testing/fakeServices.ts';
import { createCafaiTheme } from '../theme.ts';
import { DrinkDial } from './DrinkDial.tsx';
import type { DrinkPresets } from './drinkModel.ts';
import { drinkTraceFor } from './drinkTrace.ts';
import type { DrinkKind } from './kinds.ts';
import { css, paletteColorSource, sceneColors, warmthColor } from './scenes/colors.ts';

const PRESETS: DrinkPresets = { steamSettings: SAMPLE_WORKFLOW.steamSettings, hotWaterData: SAMPLE_WORKFLOW.hotWaterData, rinseData: SAMPLE_WORKFLOW.rinseData };

let seconds = 0;
const frame = (state: string, substate = 'pouring', values: Partial<MachineFrame> = {}): MachineFrame => ({
  ...IDLE_TELEMETRY.machine!,
  timestamp: formatLocalTimestamp(new Date(2026, 9, 22, 8).getTime() + (seconds += 0.5) * 1000),
  state: { state, substate },
  ...values,
});

interface DialProps {
  kind: DrinkKind;
  scene: string;
  target: number | null;
  presets?: DrinkPresets;
}

/** The dial as the view shows it: its drink's run from the recording, re-rendered when a run starts or ends. */
function Dial({ kind, scene, target, presets = PRESETS }: DialProps) {
  const { telemetry } = useServices();
  const trace = useMemo(() => drinkTraceFor(telemetry), [telemetry]);
  useSyncExternalStore(trace.subscribe, trace.getState);
  return <DrinkDial kind={kind} run={trace.runOf(kind)} target={target} size={272} scene={scene} presets={presets} />;
}

function mount(props: DialProps, mode: 'dark' | 'light' = 'dark') {
  const services = createFakeServices();
  drinkTraceFor(services.telemetry);
  const palette = buildPalette(mode, namedTint('crema'));
  const { container } = render(
    <ThemeProvider theme={createCafaiTheme(palette)}>
      <ServicesProvider services={services}>
        <Dial {...props} />
      </ServicesProvider>
    </ThemeProvider>,
  );
  const send = (f: MachineFrame) => act(() => services.telemetry.setState({ machine: f }));
  const dial = within(container).getByTestId(TID.drinkDial);
  return {
    services,
    send,
    dial,
    palette,
    colors: sceneColors(paletteColorSource(palette)),
    arc: dial.querySelector<SVGCircleElement>('.arc')!,
    dot: dial.querySelector<SVGCircleElement>('.tip circle')!,
    figures: within(container).getByTestId(TID.drinkDialOf).parentElement!,
  };
}

/** A colour as the page writes it back, to compare with what the dial set. */
function asWritten(color: string): string {
  const probe = document.createElement('i');
  probe.style.stroke = color;
  return probe.style.stroke;
}

describe('DrinkDial', () => {
  it('draws its scene on a canvas under the ring, and nothing of it in the ring’s drawing', () => {
    const { dial } = mount({ kind: 'steam', scene: 'whirlpool', target: 50 });
    const canvas = dial.querySelector(':scope > canvas');
    expect(canvas).toHaveAttribute('aria-hidden', 'true');
    expect(canvas!.nextElementSibling!.tagName).toBe('svg');
    expect(dial.querySelector('svg clipPath, svg mask, svg path')).toBeNull();
    expect(dial).toHaveAttribute('data-scene', 'whirlpool');
  });

  it('colours the arc and its tip with the milk’s warmth, cold as the steam starts and warmer with its time', () => {
    const { send, arc, dot, colors } = mount({ kind: 'steam', scene: 'spray', target: 10 });
    send(frame('steam'));
    expect(arc.style.stroke).toBe(asWritten(css(colors.warmCold)));
    expect(dot.style.fill).toBe(asWritten(css(colors.warmCold)));
    for (let i = 0; i < 10; i += 1) send(frame('steam'));
    // 5 s of a 10 s steam.
    expect(arc.style.stroke).toBe(asWritten(css(warmthColor(colors, 0.5))));
    expect(dot.style.fill).toBe(asWritten(css(warmthColor(colors, 0.5))));
    expect(arc.style.stroke).not.toBe(asWritten(css(colors.warmCold)));
  });

  it('colours hot water’s ring by its temperature set, cool tea water blue and an americano’s warm', () => {
    const at = (targetTemperature: number) => {
      const presets = { ...PRESETS, hotWaterData: { ...PRESETS.hotWaterData, targetTemperature } };
      const { send, arc, colors } = mount({ kind: 'hotWater', scene: 'pour', target: 200, presets });
      send(frame('hotWater', 'pouring', { flow: 8 }));
      send(frame('hotWater', 'pouring', { flow: 8 }));
      return { stroke: arc.style.stroke, colors };
    };
    const tea = at(40);
    expect(tea.stroke).toBe(asWritten(css(tea.colors.warmCold)));
    const americano = at(95);
    expect(americano.stroke).toBe(asWritten(css(americano.colors.warmHot)));
  });

  it('keeps a finished hot water’s colour when the temperature is set for the next one', () => {
    const presets = { ...PRESETS, hotWaterData: { ...PRESETS.hotWaterData, targetTemperature: 95 } };
    const { services, send, arc, colors } = mount({ kind: 'hotWater', scene: 'pour', target: 200, presets });
    send(frame('hotWater', 'pouring', { flow: 8 }));
    send(frame('hotWater', 'pouring', { flow: 8 }));
    send(frame('idle', 'idle'));
    const warm = asWritten(css(colors.warmHot));
    expect(arc.style.stroke).toBe(warm);
    act(() =>
      services.telemetry.setState({
        shotSettings: {
          steamSetting: 0,
          targetSteamTemp: 150,
          targetSteamDuration: 50,
          targetHotWaterTemp: 40,
          targetHotWaterVolume: 200,
          targetHotWaterDuration: 30,
          targetShotVolume: 36,
          groupTemp: 93,
        },
      }),
    );
    send(frame('idle', 'idle'));
    expect(arc.style.stroke).toBe(warm);
  });

  it('sets the done check above the figures without moving them, centred where the scene cuts out its circle', () => {
    const { send, dial } = mount({ kind: 'steam', scene: 'spray', target: 50 });
    send(frame('steam'));
    send(frame('idle', 'idle'));
    const check = dial.querySelector('.done-check')!;
    const style = getComputedStyle(check);
    expect(style.position).toBe('absolute');
    // 75 of the 272 box is where the scenes cut out the check's circle (scenes/canvas.ts).
    expect(style.top).toBe('calc(27.57% - 14px)');
    expect(style.left).toBe('calc(50% - 14px)');
  });

  it('gives the figures a halo of crema on the rosetta in dark mode, where they sit on white milk', () => {
    const { figures, palette } = mount({ kind: 'steam', scene: 'rosetta', target: 50 });
    const shadows = getComputedStyle(figures).textShadow.split(',');
    expect(shadows).toHaveLength(5);
    expect(shadows.every((shadow) => shadow.includes(palette.scene.crema))).toBe(true);
  });

  it('gives them none in light mode, where dark figures read on the light milk, nor on another scene', () => {
    // As an element with no shadow of its own reads.
    const none = getComputedStyle(document.body).textShadow;
    expect(getComputedStyle(mount({ kind: 'steam', scene: 'rosetta', target: 50 }, 'light').figures).textShadow).toBe(none);
    expect(getComputedStyle(mount({ kind: 'steam', scene: 'whirlpool', target: 50 }).figures).textShadow).toBe(none);
  });
});
