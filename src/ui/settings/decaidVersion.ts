/**
 * The Decaid version Settings shows (About) and the traffic log's header
 * carries (D139): what Decaid's WebView says, or else GET /api/v1/info,
 * asked once per Decaid client at a time. The last answer is kept per
 * client, so the log's Share, Email and Copy (which build their text in the
 * tap itself, without waiting) know it once Settings has asked.
 */
import { useEffect, useState } from 'react';
import type { DecaidClient } from '../../api/types.ts';
import { useServices } from '../../app/services.tsx';

const known = new WeakMap<DecaidClient, string>();
const asking = new WeakMap<DecaidClient, Promise<string | null>>();

/** Decaid's version by GET /api/v1/info, one request at a time per client; null when it cannot say. */
function askDecaid(decaid: DecaidClient): Promise<string | null> {
  const pending = asking.get(decaid);
  if (pending) return pending;
  const request = decaid
    .getInfo()
    .then((info) => {
      const version = info.fullVersion || info.version || null;
      if (version) known.set(decaid, version);
      else known.delete(decaid);
      return version;
    })
    .catch(() => {
      known.delete(decaid);
      return null;
    })
    .finally(() => asking.delete(decaid));
  asking.set(decaid, request);
  return request;
}

/** The version last known for this client, without asking. */
export function knownDecaidVersion(decaid: DecaidClient): string | null {
  return known.get(decaid) ?? null;
}

/**
 * The running Decaid's version, or null while it is unknown (not connected).
 * `ask`: ask Decaid when its WebView did not say (About does, each time it
 * opens); without it, only what is known already.
 */
export function useDecaidVersion({ ask = true }: { ask?: boolean } = {}): string | null {
  const { host, decaid } = useServices();
  const [version, setVersion] = useState<string | null>(() => host.hostVersion ?? knownDecaidVersion(decaid));
  useEffect(() => {
    if (host.hostVersion || !ask) return;
    let live = true;
    void askDecaid(decaid).then((answer) => {
      if (live) setVersion(answer);
    });
    return () => {
      live = false;
    };
  }, [decaid, host.hostVersion, ask]);
  return host.hostVersion ?? version;
}
