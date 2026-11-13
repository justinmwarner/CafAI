import { useState, useSyncExternalStore, type CSSProperties } from 'react';
import type { DebugSession } from './session.ts';

/**
 * "Send debug report" on the start screen, while the DEBUG flag is on (docs/DEBUG.md): the IndexedDB probe, then a
 * report of what the start waits on to CafAI Bridge and Decaid. The sentence under it says where it went.
 */
export function DebugReportButton({
  debug,
  stage,
  buttonStyle,
  noteStyle,
}: {
  debug: DebugSession;
  /** What the start waits on now. */
  stage: () => string | null;
  buttonStyle: CSSProperties;
  noteStyle: CSSProperties;
}) {
  const enabled = useSyncExternalStore(debug.subscribe, debug.enabled);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!enabled) return null;
  const send = async () => {
    setSending(true);
    setNote('Checking the storage and sending the report…');
    try {
      setNote(await debug.report('manual', { stage: stage(), probe: true }));
    } catch (error) {
      setNote(`The report could not be sent: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSending(false);
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <button type="button" data-testid="start-debug-report" disabled={sending} onClick={() => void send()} style={buttonStyle}>
        Send debug report
      </button>
      {note ? (
        <div data-testid="start-debug-note" role="status" style={noteStyle}>
          {note}
        </div>
      ) : null}
    </div>
  );
}
