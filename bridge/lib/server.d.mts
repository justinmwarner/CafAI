// Types for server.mjs, for TypeScript callers (src/llm/live/bridge.live.ts).

export interface ClaudeInstall {
  path: string;
  version: string;
  command: string;
  args: string[];
}

export interface BridgeOptions {
  code: string;
  port?: number;
  host?: string;
  claudePath?: string | null;
  maxRuns?: number;
  idleMinutes?: number;
  allowApiKey?: boolean;
  workDir: string;
  version: string;
  log?: (line: string) => void;
  onShutdownRequest?: () => void;
  env?: Record<string, string | undefined>;
  timing?: { firstEventMs?: number; stallMs?: number; pingMs?: number; keepaliveMs?: number; authCacheMs?: number };
}

export interface BridgeHandle {
  readonly port: number;
  readonly host: string;
  readonly claude: ClaudeInstall | null;
  close(): Promise<void>;
}

export const PROTOCOL: number;
export function startBridgeServer(options: BridgeOptions): Promise<BridgeHandle>;
