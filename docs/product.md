# Product Contract

Agent Doorbell is a local notification CLI called by an AI agent when a person must act. The agent writes a short message; the CLI attempts speech when enabled, then the packaged sound on failure. It does not classify requests into a fixed event union or turn terminal output into successful audio delivery.

## Responsibility Boundaries

| Layer            | Owns                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| Calling agent    | Request wording, optional source, per-call speech directions and controls, text fallback          |
| User settings    | Speech activation, selected provider, each provider's model/default voice, and playback mode      |
| Credential store | API-key registration, replacement, removal, and reads                                             |
| notify           | Message and provider-specific option validation, player preflight, synthesis/playback composition |
| Speech provider  | One request to the selected OpenAI or Gemini API and safe synthesis results                       |
| Audio player     | File decoding, PCM consumption, and device output through ffplay                                  |
| Delivery policy  | Speech then sound, stop after success, no fallback after cancellation                             |

AttentionRequest contains message, source?, and speech?. Message length is 1–120 UTF-16 code units after trimming. SpeechOptions contains optional voice, OpenAI instructions/speed, or Gemini prompt. Text directions allow up to 2000 code units. Options are validated against the saved provider before credentials or playback and are never persisted.

## Defaults and Configuration

- OpenAI is the default provider, using gpt-4o-mini-tts with default voice nova and 13 presets.
- Gemini uses gemini-3.1-flash-tts-preview with default voice Kore and 30 presets. Each provider retains its own model/voice profile when switching; lists preserve official order independently of defaults.
- Speaking style is authored by the agent on each call from its current personality. No saved tone or personality setup exists; legacy tones are ignored and stripped on the next settings save.
- A request can override voice for one call. Otherwise the saved voice applies. Omitted directions cause no custom personality instruction. Provider, model, activation, and playback mode remain user settings.
- Agent instructions are delivered by doorbell agent-instructions; the CLI does not inspect private agent configuration.
- Speech starts disabled. Explicit --enable can use all other defaults. Provider/default-voice edits and API-key registration do not activate it.
- configure api-key and configure speech have separate dependencies and persistence. Keys have distinct provider accounts. Missing credentials cause sound fallback without trying another provider.
- Only the final message and bounded delivery directions are sent as synthesis content; source, full agent/system prompts, and conversations are not sent.

## Delivery and Platform Constraints

The default mode is buffered WAV: receive all bytes, create a unique temporary file, await playback, and clean up in finally. OpenAI returns WAV; Gemini PCM is validated and wrapped as WAV by wavefile. The packaged offline sound is MP3. OpenAI additionally supports incremental PCM streaming. Unsupported player capabilities and unvalidated Gemini streaming select buffered with a warning before synthesis.

The current player is ffplay on Windows, macOS, and Linux, invoked through ProcessRunner with shell disabled. Only Windows has real playback evidence. WAV/MP3 decoding and device output remain the player's responsibility.

Each provider uses its injected OS credential, a fixed official HTTPS endpoint, safe errors, and zero automatic retries. Speech failure cannot trigger another cloud provider. Cancellation stops further delivery attempts.

## Scope

v0.1 supports explicitly selected OpenAI and Gemini speech. OS TTS, local model TTS, voice UI automation, subscription token reuse, custom voice cloning, and a daemon are outside scope.

Diagnostics, a shared inter-process FIFO queue, Codex/Claude hook adapters, OpenAI streaming, and a local Codex MCP plugin are implemented. The [development plan](development-plan.md) and [testing and release](testing-and-release.md) separate implemented behavior from verification and release gates.
