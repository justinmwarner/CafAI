// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TID } from '../testIds.ts';
import { TapGuard } from './TapGuard.tsx';

afterEach(() => {
  vi.useRealTimers();
});

function Pane({ until, onClick, onPointerDown }: { until: number | null; onClick?: () => void; onPointerDown?: () => void }) {
  return (
    <div onClick={onClick} onPointerDown={onPointerDown} style={{ position: 'relative' }}>
      <button type="button">Sour / sharp</button>
      <TapGuard until={until} />
    </div>
  );
}

describe('TapGuard', () => {
  it('takes the taps that land on it, and gives the pane back when it runs out', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const onClick = vi.fn();
    const onPointerDown = vi.fn();
    render(<Pane until={Date.now() + 350} onClick={onClick} onPointerDown={onPointerDown} />);
    const guard = screen.getByTestId(TID.tapGuard);
    expect(guard).toHaveAttribute('aria-hidden', 'true');

    // false: the default action was prevented (no focus move, no click from the touch).
    expect(fireEvent.pointerDown(guard)).toBe(false);
    expect(fireEvent.touchStart(guard)).toBe(false);
    expect(fireEvent.click(guard)).toBe(false);
    // And nothing above it heard them.
    expect(onPointerDown).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(349));
    expect(screen.getByTestId(TID.tapGuard)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId(TID.tapGuard)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sour / sharp' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is not there without a time, or with one already past', () => {
    const { rerender } = render(<Pane until={null} />);
    expect(screen.queryByTestId(TID.tapGuard)).not.toBeInTheDocument();
    rerender(<Pane until={Date.now() - 1} />);
    expect(screen.queryByTestId(TID.tapGuard)).not.toBeInTheDocument();
  });

  it('a new time is a new guard', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { rerender } = render(<Pane until={Date.now() + 350} />);
    act(() => vi.advanceTimersByTime(350));
    expect(screen.queryByTestId(TID.tapGuard)).not.toBeInTheDocument();

    rerender(<Pane until={Date.now() + 350} />);
    expect(screen.getByTestId(TID.tapGuard)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(350));
    expect(screen.queryByTestId(TID.tapGuard)).not.toBeInTheDocument();
  });
});
