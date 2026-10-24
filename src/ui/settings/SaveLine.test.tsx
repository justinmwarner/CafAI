// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, screen } from '@testing-library/react';
import { renderThemed } from '../chat/testing/render.tsx';
import { couldNotSave, SAVED, SAVED_FOR_MS, SaveLine, useSaveNote } from './SaveLine.tsx';

afterEach(() => {
  vi.useRealTimers();
});

describe('the line under a card (D234)', () => {
  it('says "Saved." for 3 s, then nothing', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSaveNote());
    expect(result.current.note).toBeNull();
    act(() => result.current.saved());
    expect(result.current.note).toEqual({ tone: 'saved' });
    act(() => vi.advanceTimersByTime(SAVED_FOR_MS - 1));
    expect(result.current.note).toEqual({ tone: 'saved' });
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.note).toBeNull();
  });

  it('says why a change did not save until a later one does, and a save cut short by a failure never clears it', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSaveNote());
    act(() => result.current.saved());
    act(() => result.current.failed('Could not save the grinder: disk full. Try again.'));
    act(() => vi.advanceTimersByTime(SAVED_FOR_MS * 2));
    expect(result.current.note).toEqual({ tone: 'error', text: 'Could not save the grinder: disk full. Try again.' });
    act(() => result.current.saved());
    expect(result.current.note).toEqual({ tone: 'saved' });
  });

  it('keeps its height while empty, and is a polite status in the success or error colour', () => {
    const { rerender } = renderThemed(<SaveLine note={null} testId="line" />);
    const line = screen.getByTestId('line');
    expect(line).toHaveAttribute('role', 'status');
    expect(line).toHaveTextContent('');
    // One line of body-small: 15 px at line height 1.5.
    expect(getComputedStyle(line).minHeight).toBe('22.5px');
    rerender(<SaveLine note={{ tone: 'saved' }} testId="line" />);
    expect(line).toHaveTextContent(SAVED);
    rerender(<SaveLine note={{ tone: 'error', text: 'Could not save that.' }} testId="line" />);
    expect(line).toHaveTextContent('Could not save that.');
  });

  it('says what failed, why and what to do, with one full stop', () => {
    expect(couldNotSave('the grinder', new Error('disk full'))).toBe('Could not save the grinder: disk full. Try again.');
    expect(couldNotSave('the grinder', new Error('Storage is full.'))).toBe('Could not save the grinder: Storage is full. Try again.');
    expect(couldNotSave('the model', 'blocked')).toBe('Could not save the model: blocked. Try again.');
  });
});
