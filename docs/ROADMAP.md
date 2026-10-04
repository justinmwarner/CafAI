# CafAI roadmap

Things the owner wants next that are not built yet. Each item says why, the
shape of the work, and what has to be checked first. Decisions that put an
item here are in [DECISIONS.md](../DECISIONS.md).

## Run the coach from your own computer, without API tokens (D56)

**Why.** Today every coaching turn is a metered Anthropic API call with the
user's own key. The owner wants the option CafAI's ancestor Crema has: a
small server on the user's Mac (or PC) that answers the coach through the
user's Claude subscription instead (QUESTIONS #2).

**What Crema does.** `crema/server/advisor` is a FastAPI app on the Mac that
shells out to `claude -p` (Claude Code's headless mode, signed in with the
user's subscription; `CLAUDE_CODE_OAUTH_TOKEN` for a LaunchAgent). It exposes
`/health`, an Anthropic-shaped `/v1/messages` and an OpenAI-shaped
`/v1/chat/completions`, both text-only and non-streaming, and the skin finds
it again on the LAN by sweeping the saved IP's /24 (`crema/web/src/advice/discover.ts`).

**Why CafAI cannot just point at that.** CafAI's coach relies on things a
text-only wrapper drops: streamed replies, nine strict tools with
`tool_choice: auto`, and an append-only transcript whose thinking blocks are
replayed unchanged (D24, D25, `docs/briefs/ENGINE_PROTOCOL.md`).

**Shape of the work.**

1. A companion app ("CafAI Local") on the computer, built on the Claude Agent
   SDK rather than `claude -p` text, so the coach's tools can be declared as
   real tools (an in-process MCP server) and the turn can stream.
2. A CafAI-specific HTTP endpoint on the LAN (CORS open to the skin's
   origin): request = the bag's transcript and the latest user turn; response
   = a stream of CafAI's own events (text deltas, tool calls). The
   companion, not the tablet, keeps the subscription credentials.
3. A second `LlmProvider` in CafAI (the seam exists: `src/llm/types.ts`),
   chosen in Settings ("Anthropic API key" or "My computer"), with the
   computer's address entered once and re-found the way Crema does.
4. The same guard rails: every tool input is still validated with zod and the
   template bounds on the tablet, whatever produced it.

**Check first.**

- Whether Anthropic's terms allow a subscription to serve an app like this
  (personal use on one's own machine, as Crema does), and the subscription's
  rate limits during a morning of dial-in.
- Whether the Agent SDK's transcript can be replayed across turns the way
  CafAI's append-only conversations need, or whether the companion keeps the
  conversation and CafAI keeps only its UI copy.
- The tablet reaching the computer: same LAN, plain HTTP from the skin's
  `http://` origin (no mixed-content block), and the computer asleep.

## Smaller items carried from MORNING.md

- Teaching mode, personas, cross-user learning, bag photos (an `image`
  content block exists in the LLM types), voice.
- Steam and hot-water parameter editors, device-connect screens (the client
  has `connectKind()`), a screensaver.
- Linking Decaid's bean and batch entities (only coffee name and roaster
  travel today).
