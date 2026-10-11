/**
 * Where the coach's requests go (Settings > Where the coach runs): to
 * Anthropic with the API key, or to CafAI Bridge on the user's own Mac or PC
 * with its pairing code, which answers through the user's Claude plan
 * (docs/superpowers/specs/2026-10-11-local-claude-design.md). Both speak the
 * Anthropic Messages API, so one provider serves both; it reads the saved
 * choice at every request, so a change in Settings applies to the next turn.
 */
import {
  computerWording,
  createAnthropicProvider,
  LlmError,
  type AnthropicProviderOptions,
  type LlmProvider,
  type RetryContext,
} from '../llm/index.ts';
import { normalizeAddress, normalizeCode, type CoachSource, type CoachSourceStore } from '../storage/coachSource.ts';
import type { SecretStore, Storage } from '../storage/types.ts';

type SourceReader = Pick<CoachSourceStore, 'get'>;
type KeyReader = Pick<SecretStore, 'getApiKey'>;

const NO_ADDRESS = 'Add the address CafAI Bridge shows on your computer in Settings.';
/** CafAI Bridge sends its first byte (a ping) as soon as a run takes the request; Anthropic's 60 s is for the internet. */
const BRIDGE_FIRST_BYTE_MS = 30_000;

export interface CoachProviderOptions {
  secrets: KeyReader;
  coachSource: SourceReader;
  fetch?: typeof globalThis.fetch;
  /** Retries before anything has streamed. Default 2; a photo of the bag goes once (0). */
  maxRetries?: number;
  /** For tests: the provider's retry delay and timeouts. */
  retryBaseMs?: number;
  timeouts?: AnthropicProviderOptions['timeouts'];
}

/**
 * What CafAI asks CafAI Bridge again: a bridge it could not reach, or one
 * that said every run is busy (503). Nothing else. Once its reply began, the
 * bridge has run Claude Code (which retries Anthropic's own hiccups itself)
 * and its sentence says what to do; a plan's limit or a lockout for wrong
 * codes does not lift in a second; and a bridge that sent nothing at all in
 * time is asleep or behind a firewall, which another wait would not change.
 */
export function retryOnComputer(error: LlmError, context: RetryContext): boolean {
  if (context.streamOpened || context.timedOut) return false;
  return error.kind === 'network' || error.status === 503;
}

/** The provider for the source saved now. Throws LlmError when the computer has no usable address. */
function providerFor(source: CoachSource, options: CoachProviderOptions): LlmProvider {
  const common = {
    fetch: options.fetch,
    maxRetries: options.maxRetries,
    retryBaseMs: options.retryBaseMs,
    timeouts: options.timeouts,
  };
  if (source.kind !== 'computer') return createAnthropicProvider({ ...common, getApiKey: () => options.secrets.getApiKey() });
  const address = normalizeAddress(source.address);
  if (!address.ok) throw new LlmError('no_api_key', NO_ADDRESS);
  const code = normalizeCode(source.code);
  return createAnthropicProvider({
    ...common,
    baseUrl: address.baseUrl,
    // No code: the provider says so in the bridge's words, and sends nothing.
    getApiKey: async () => (code.ok ? code.code : null),
    // Its sentences name the address, never the code; the bridge's own are shown as they come.
    wording: computerWording(address.display),
    timeouts: options.timeouts ?? { firstByteMs: BRIDGE_FIRST_BYTE_MS },
    shouldRetry: retryOnComputer,
  });
}

/** The coach's provider: Anthropic or CafAI Bridge, whichever Settings says at each request. */
export function createCoachProvider(options: CoachProviderOptions): LlmProvider {
  return {
    id: 'anthropic',
    async *stream(request) {
      yield* providerFor(await options.coachSource.get(), options).stream(request);
    },
  };
}

/**
 * What the saved source needs before the coach can be asked anything: the
 * API key, or, for the computer, the bridge's code once both the address and
 * the code are valid. Null when it is missing.
 */
export async function activeCredential(secrets: KeyReader, coachSource: SourceReader): Promise<string | null> {
  const source = await coachSource.get();
  if (source.kind !== 'computer') return secrets.getApiKey();
  const code = normalizeCode(source.code);
  return normalizeAddress(source.address).ok && code.ok ? code.code : null;
}

/**
 * The storage the engine sees: the same, except that "is a key stored"
 * (secrets.getApiKey) asks for what the selected source needs, so the coach
 * waits for the bridge's code when it runs on the computer and needs no API
 * key then. Saving and forgetting the key still go to the real store. Without
 * the store (this device's storage refused it), the coach runs on Anthropic.
 */
export function withCoachCredential(storage: Storage, coachSource: SourceReader | undefined): Storage {
  if (!coachSource) return storage;
  const secrets = storage.secrets;
  return { ...storage, secrets: { ...secrets, getApiKey: () => activeCredential(secrets, coachSource) } };
}
