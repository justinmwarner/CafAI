// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';
import { TID } from '../testIds.ts';
import { createFakeServices } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { createFakeServicesIn } from '../testing/temperatureServices.ts';
import { MachineReadouts } from './MachineStatus.tsx';

afterEach(() => cleanup());

describe("the stats card's readouts in the barista's unit (D-TEMP-4)", () => {
  it('reads the group to one decimal of °F, its target too, and steam in whole °F', () => {
    renderWithServices(<MachineReadouts columns={4} />, createFakeServicesIn('fahrenheit'));
    // The fake machine: group 92.4 °C, its target 92.5 °C, steam 140 °C.
    expect(screen.getByTestId(TID.groupTemp)).toHaveTextContent('198.3 °F');
    expect(screen.getByTestId(TID.groupTemp)).toHaveTextContent('target 198.5');
    expect(screen.getByTestId(TID.steamTemp)).toHaveTextContent('284 °F');
  });

  it('reads °C as before when nobody chose', () => {
    renderWithServices(<MachineReadouts columns={4} />, createFakeServices());
    expect(screen.getByTestId(TID.groupTemp)).toHaveTextContent('92.4 °C');
    expect(screen.getByTestId(TID.groupTemp)).toHaveTextContent('target 92.5');
    expect(screen.getByTestId(TID.steamTemp)).toHaveTextContent('140 °C');
  });

  it('changes at once when the unit does, and follows the machine in it', async () => {
    const { services } = renderWithServices(<MachineReadouts columns={4} />, createFakeServices());
    await act(() => services.temperatureUnit.set('fahrenheit'));
    expect(screen.getByTestId(TID.groupTemp)).toHaveTextContent('198.3 °F');
    act(() => services.telemetry.setState({ machine: { ...services.telemetry.getState().machine!, groupTemperature: 93.06 } }));
    expect(screen.getByTestId(TID.groupTemp)).toHaveTextContent('199.5 °F');
    await act(() => services.temperatureUnit.set('celsius'));
    expect(screen.getByTestId(TID.groupTemp)).toHaveTextContent('93.1 °C');
  });

  it('a reading Decaid did not send is a dash in °F too', () => {
    const services = createFakeServicesIn('fahrenheit');
    services.telemetry.setState({ machine: { ...services.telemetry.getState().machine!, groupTemperature: null, targetGroupTemperature: null } });
    renderWithServices(<MachineReadouts columns={4} />, services);
    expect(screen.getByTestId(TID.groupTemp)).toHaveTextContent(/^Group—\s*$/);
  });
});
