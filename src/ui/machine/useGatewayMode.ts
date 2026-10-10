/**
 * Decaid's gateway mode (spec 5.1, D98). In Full, Decaid leaves stopping a
 * shot at the target weight to the skin, and CafAI does not stop shots, so
 * they would run on past the target: the machine alert says so, with a
 * one-tap fix that asks Decaid for Tracking. CafAI never changes Decaid's
 * settings by itself.
 *
 * Read on mount, each time the machine connects and when the page comes
 * back into view. A read that fails keeps the last answer; a reply that
 * names no mode is no mode, so the alert never says what it is not sure of.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DecaidSettings } from '../../api/types.ts';
import { useServices, useTelemetry } from '../../app/services.tsx';

export interface GatewayMode {
  /** Decaid's gatewayMode: "full", "tracking", "disabled" or one CafAI does not know; null until read. */
  mode: string | null;
  /** The fix is on its way. */
  fixing: boolean;
  /** Why the last fix did not take, as a sentence; null otherwise. */
  error: string | null;
  /** Asks Decaid for Tracking, and follows the settings it reads back. */
  fix(): void;
}

const KEPT = "Decaid kept its setting. Set Gateway Mode to Tracking in Decaid's settings.";

const modeOf = (settings: DecaidSettings): string | null => (typeof settings.gatewayMode === 'string' ? settings.gatewayMode : null);

export function useGatewayMode(): GatewayMode {
  const { decaid } = useServices();
  const connected = useTelemetry((s) => s.machineConnected);
  const [mode, setMode] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  /** Counts the reads and fixes sent: only the latest one's answer lands. */
  const latest = useRef(0);
  const fixInFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const read = useCallback(() => {
    const id = ++latest.current;
    decaid.getSettings().then(
      (settings) => {
        if (!mounted.current || id !== latest.current) return;
        const next = modeOf(settings);
        setMode(next);
        if (next !== 'full') setError(null);
      },
      () => {
        // Keep the last answer: Decaid out of reach is the alert's to say.
      },
    );
  }, [decaid]);

  useEffect(() => read(), [read]);

  const wasConnected = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnected.current) read();
    wasConnected.current = connected;
  }, [connected, read]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') read();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [read]);

  const fix = useCallback(() => {
    if (fixInFlight.current) return;
    fixInFlight.current = true;
    const id = ++latest.current;
    setFixing(true);
    setError(null);
    decaid
      .updateSettings({ gatewayMode: 'tracking' })
      .then(
        (settings) => {
          if (!mounted.current) return;
          const next = modeOf(settings);
          if (id === latest.current) setMode(next);
          setError(next === 'full' ? KEPT : null);
        },
        (cause: unknown) => {
          if (!mounted.current) return;
          // GatewayError.message is already a sentence a barista can act on.
          const detail = cause instanceof Error && cause.message.trim() ? cause.message.trim() : 'Try again.';
          setError(`Couldn't change Decaid's setting. ${detail}`);
        },
      )
      .finally(() => {
        fixInFlight.current = false;
        if (mounted.current) setFixing(false);
      });
  }, [decaid]);

  return { mode, fixing, error, fix };
}
