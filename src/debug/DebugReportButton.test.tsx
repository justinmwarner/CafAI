// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DebugReportButton } from './DebugReportButton.tsx';
import type { DebugSession } from './session.ts';

function fakeSession(on: boolean, said = 'Report sent to CafAI Bridge at 192.168.1.90:8877, and a copy kept in Decaid.') {
  let enabled = on;
  const listeners = new Set<() => void>();
  const session: DebugSession = {
    enabled: () => enabled,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    report: vi.fn(async () => said),
    stop() {},
  };
  return {
    session,
    turnOn() {
      enabled = true;
      for (const listener of listeners) listener();
    },
  };
}

describe('DebugReportButton', () => {
  it('shows nothing while the DEBUG flag is off, and appears when it turns on', () => {
    const { session, turnOn } = fakeSession(false);
    render(<DebugReportButton debug={session} stage={() => null} buttonStyle={{}} noteStyle={{}} />);
    expect(screen.queryByTestId('start-debug-report')).toBeNull();
    act(() => turnOn());
    expect(screen.getByTestId('start-debug-report')).toHaveTextContent('Send debug report');
  });

  it('sends a report with the probe and what the start waits on, and says where it went', async () => {
    const { session } = fakeSession(true);
    render(<DebugReportButton debug={session} stage={() => "opening the coach's chat"} buttonStyle={{}} noteStyle={{}} />);
    await userEvent.click(screen.getByTestId('start-debug-report'));
    expect(session.report).toHaveBeenCalledWith('manual', { stage: "opening the coach's chat", probe: true });
    expect(await screen.findByText('Report sent to CafAI Bridge at 192.168.1.90:8877, and a copy kept in Decaid.')).toBeInTheDocument();
    expect(screen.getByTestId('start-debug-report')).toBeEnabled();
  });
});
