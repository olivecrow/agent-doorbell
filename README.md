# Agent Doorbell

A local CLI that lets AI agents request human attention with a short spoken message. When speech is disabled or unavailable, it plays a bundled notification sound. If audio delivery fails, it returns an error to the calling agent.

See the [development plan](docs/development-plan.md) for deferred platform verification and release gates.

## Installation

Download `agent-doorbell-1.0.0.tgz` from the [GitHub v1.0.0 release](https://github.com/olivecrow/agent-doorbell/releases/tag/v1.0.0), then install the downloaded archive:

```sh
npm install --global /absolute/path/agent-doorbell-1.0.0.tgz
doorbell doctor
```

Node.js 24 or newer and ffplay are required. Windows has native verification; macOS/Linux validation remains pending. This release is distributed through GitHub; it is not published to the npm registry. See the [Codex plugin guide](docs/codex-plugin.md) for plugin installation.

## Development

Requires Node.js 24 and ffplay in an absolute PATH directory for local audio playback. Doorbell excludes the current working directory from player discovery and pins the resolved executable for diagnosis and playback.

Buffered speech uses private storage under `~/.agent-doorbell/speech-tmp`. On Windows, the built-in Windows PowerShell and .NET ACL APIs verify directory access before synthesis. If storage permissions cannot be verified, Doorbell uses the offline sound without a paid speech request. See [temporary audio security](docs/speech-provider.md#temporary-audio).

```sh
npm install
npm test
npm run dev -- --help
```

The development launcher uses this repository's ignored .doorbell-dev/ directory and separate OS credential entries. Use `npm run dev -- <command>` for the commands below during development. A linked or installed doorbell command uses ~/.agent-doorbell/ unless DOORBELL_CONFIG_DIR explicitly selects another absolute path.

## Configuration

API keys and speech preferences are configured independently:

```sh
doorbell configure api-key
doorbell configure speech --enable
```

The first command uses hidden input and the OS credential store for OpenAI. Selecting set and submitting a valid key saves it immediately, without an extra confirmation. It does not change speech settings. The second explicitly enables the selected provider, using defaults for every preference you have not set. A fresh setup uses OpenAI, gpt-4o-mini-tts, nova, and buffered playback. You do not need to choose a voice or create a personality profile.

To use Gemini instead:

```sh
doorbell configure api-key --provider gemini
doorbell configure speech --provider gemini --enable
doorbell configure speech --list-voices --provider gemini
doorbell configure speech --voice Puck
```

Gemini uses `gemini-3.1-flash-tts-preview`, with Kore as the default and 30 built-in voices. It uses the Gemini API, not Vertex AI or a subscription login. The model is a preview; see Google's [model reference](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-tts-preview) and [speech guide](https://ai.google.dev/gemini-api/docs/speech-generation).

Each provider has its own key and remembered voice. `doorbell configure speech --provider openai` switches back without losing either voice or changing activation. Speaking style comes from the calling agent on each notification. The API-key command defaults to OpenAI even when Gemini is selected, so specify `--provider gemini` to manage the Gemini key.

Optional customization:

```sh
doorbell configure speech --show
doorbell configure speech --playback-mode streaming
doorbell configure speech --volume 1.5
doorbell configure speech --disable
```

Run doorbell configure speech without options for interactive settings. Provider and default voice preferences are preserved. Legacy saved tones are ignored and removed on the next settings save. Removing a key preserves those preferences, while notifications fall back to the bundled sound. Registering a key does not enable speech.

Local speech volume accepts a gain from 0.25 to 4, with 1 preserving the original level. It applies to both providers, uses peak limiting when adjusted, and does not change system volume or the packaged notification sound.

Speech is AI-generated. Enabling it sends the notification text and applicable speaking instructions to the selected provider and may incur API charges. API keys are not stored in speech.json. See [credentials](docs/credentials.md) for storage boundaries.

## Notifications

```sh
doorbell notify --message "Please review the preview before I continue." --source "preview"
doorbell ring
```

Messages are limited to 120 UTF-16 code units after trimming. Per-call instructions or prompts allow up to 2000 code units. Built-in guidance is English; supplied messages and directions are preserved after outer whitespace trimming.

Agents speak in the language the user is using in the conversation unless the user explicitly requested or configured another spoken language. Doorbell forwards the agent's sentence without translating it.

Calling agents should run `doorbell agent-instructions`. It prints current non-secret configuration plus [agent integration](docs/agent-integration.md), including official TTS manual links and provider-specific examples. OpenAI calls accept `--instructions`, `--speed`, and `--voice`; Gemini calls accept `--prompt` and `--voice`. These controls are never saved, so the agent can reflect its current personality immediately. Omitted voice uses the saved default; omitted directions use no custom personality instructions.

Speech failure falls back to the packaged MP3 without another paid request. Exit code 0 means audio playback succeeded; 1 means delivery failed; 2 means invalid arguments. Cancellation uses 130 for SIGINT and 143 for SIGTERM.

## Implementation Status

Buffered OpenAI and Gemini synthesis, temporary-file playback/cleanup, offline fallback, cancellation, separate configuration commands, provider-specific OS credentials and voices, and per-call performance controls are implemented. Existing OpenAI settings are read compatibly and upgraded to provider profiles only when saved.

OpenAI buffered and streaming playback have Windows listening confirmation, including Nova and per-call delivery instructions. Gemini buffered Kore has account-backed listening evidence. Gemini streaming was evaluated and produced severe audible gaps; it is disabled, with a reported switch to buffered before a paid request.

`doorbell doctor [--json] [--play-sound]` provides silent diagnosis and an optional offline playback test. All production entrypoints share a cross-process FIFO queue. Native [Codex/Claude hooks](docs/hooks.md) and a [Codex plugin with MCP tools](docs/codex-plugin.md) are available. macOS/Linux remain unverified.

The fallback asset, assets/notification.mp3, is the user's recording of C and E piano notes. The owner licensed it under MIT separately from the code; see [audio license](assets/LICENSE.md) and [code license](LICENSE). Public publication still requires an explicit request.

## Documentation

Start at the [documentation map](docs/README.md). Feature documents describe current behavior; the development plan records unfinished work.
