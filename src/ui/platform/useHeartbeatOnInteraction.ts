/**
 * Tell Decaid someone is at the machine whenever they touch the screen or type.
 *
 * Without it the DE1 goes to sleep N minutes after it last went idle even
 * while someone is reading the coach. Listeners sit on the window in the
 * capture phase so a control that stops propagation still counts; the
 * Heartbeat service throttles the actual requests (D15).
 */
import { useEffect } from 'react';
import type { Heartbeat } from '../../api/types.ts';

export function useHeartbeatOnInteraction(heartbeat: Heartbeat, target: Window = window): void {
  useEffect(() => {
    const onInput = () => heartbeat.notify();
    target.addEventListener('pointerdown', onInput, { capture: true, passive: true });
    target.addEventListener('keydown', onInput, { capture: true });
    return () => {
      target.removeEventListener('pointerdown', onInput, { capture: true });
      target.removeEventListener('keydown', onInput, { capture: true });
    };
  }, [heartbeat, target]);
}
