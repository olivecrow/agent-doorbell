# CLI

src/cli.ts compiles to dist/cli.js, exposed as doorbell by package.json. All built-in help, prompts, and errors are English.

## Commands

| Command                                                    | Behavior                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| --help, -h, no arguments                                   | Print help                                                                                             |
| configure, configure --help                                | Print configuration command usage                                                                      |
| configure api-key [--provider openai\|gemini]              | Interactively set or remove that provider's OS-stored key, or cancel; defaults to OpenAI               |
| configure speech                                           | Interactively edit provider, activation, playback mode, default voice, and speech volume               |
| configure speech --provider openai / gemini                | Select a provider and restore its remembered voice                                                     |
| configure speech --enable / --disable                      | Change activation only, with defaults for missing preferences                                          |
| configure speech --voice NAME                              | Change the voice without changing activation or credentials                                            |
| configure speech --volume NUMBER                           | Set local speech gain from 0.25 to 4; default 1; leave activation and credentials unchanged            |
| configure speech --show                                    | Print effective non-secret settings as JSON; no writes or credential access                            |
| configure speech --list-voices [--provider openai\|gemini] | List voices and the default for the active or specified provider, without writes                       |
| agent-instructions                                         | Print current non-secret configuration, bundled agent instructions, and official provider manual links |
| notify --message TEXT [--source NAME] [--voice NAME]       | Attempt speech, then packaged sound; optional voice override for this call                             |
| notify ... --instructions TEXT [--speed NUMBER]            | OpenAI delivery instructions and speed from 0.25 to 4.0                                                |
| notify ... --prompt TEXT                                   | Gemini delivery prompt, followed by the message as Transcript                                          |
| ring [--event NAME] [--message TEXT]                       | Play the packaged MP3                                                                                  |
| doctor                                                     | Silent environment and credential-status checks; optional --json and explicit --play-sound             |

`configure speech --playback-mode buffered|streaming` sets the preferred mode. `hook codex [JSON]` accepts the native appended JSON argument (or stdin); `hook claude` reads Notification JSON from stdin.

Speech update flags can be combined, except enable/disable. --show is exclusive; --list-voices can only be combined with --provider. Voice validation uses the provider supplied in the same command, or the saved active provider when omitted. Invalid options, unsupported voices, missing option values, and oversized text are rejected without echoing argument values. A mismatch with the saved provider is a configuration failure (exit 1); invalid explicit argument combinations return 2.

configure api-key accepts a provider option, never a key argument. It requires a TTY and hidden input, and never loads speech.json. It defaults to OpenAI even when Gemini is selected for speech. Prompts name the targeted provider. The action menu offers cancel, set, and remove, with cancel selected by default. Cancel performs no credential operation or further prompts, reports cancellation, and exits 130 without printing a completion message. Set saves the validated key immediately after hidden input is submitted, without an additional save confirmation. Removal still requires confirmation. Cancelling key entry before submission preserves the existing key; credential operations cannot guarantee rollback once started.

configure speech has no credential dependency and works before a key exists. Its option form is noninteractive; the interactive form selects a provider before offering that provider's voices and confirms before saving. Invalid existing settings are reported, never silently reset. Provider or voice edits preserve activation and playback mode. Each provider retains its default voice. --playback-mode accepts buffered or streaming; the interactive form includes that choice. There is no tone question or saved personality setting; configure --tone/--reset-tone and notify --agent-tone are rejected.

## Per-Call Speech and Notification Flow

notify trims and validates message (1-120 UTF-16 code units) and optional directions (at most 2000 code units). Speech options are passed separately to synthesize({ message, speech }, signal?). They never modify saved settings or carry over to the next request. Legacy style.tone is ignored. Read [agent integration](agent-integration.md) for provider mappings, default behavior, examples, and official manuals.

OpenAI accepts instructions, speed, and voice; Gemini accepts prompt and voice. Gemini input contains fixed synthesis guidance, the optional prompt verbatim after outer trimming, and the final Transcript. Omitted voice uses the saved default. Blank directions omit custom instructions. Invalid types, ranges, unknown fields, unsupported voices, and wrong-provider controls return exit 2 before credentials, cleanup, network requests, or playback. Core notify validates options before player access too.

The CLI loads settings using the same captured application paths used for the credential service, then supplies only the selected provider's key reader to its adapter. notify accepts no provider/model/activation overrides. It performs conservative stale-file cleanup before notification. Invalid settings emit a warning and fall back to sound.

Saved playbackVolume is applied locally to buffered and streaming speech, with peak limiting when adjusted. It is not a notify option or provider API parameter. `--volume` may be combined with other speech updates but not --show/--list-voices; invalid values fail before reading credentials or playing audio.

For speech, notify checks WAV support and player availability before creating the provider. A streaming selection checks provider and PCM player capability before synthesis; unsupported modes use buffered with a warning. OpenAI streams PCM, while Gemini currently selects buffered after failed continuous-playback validation. Synthesis, file preparation, playback, and cleanup precede any sound fallback. No second paid synthesis or alternate provider is attempted.

The legacy ring event/message arguments are parsed but do not affect playback. Codex and Claude hooks use the shared runtime and FIFO delivery queue. See [hooks](hooks.md) and [delivery coordination](delivery-coordination.md).

## Output and Cancellation

| Exit | Meaning                                                   |
| ---- | --------------------------------------------------------- |
| 0    | Help/configuration succeeded, or audio delivery succeeded |
| 1    | Configuration or audio delivery failed                    |
| 2    | Invalid command or arguments                              |
| 130  | Interactive cancellation or SIGINT                        |
| 143  | SIGTERM                                                   |

Failed speech may appear on stderr while successful sound fallback still returns 0. Cleanup warnings do not turn a successful playback into a failed delivery.

SIGINT and SIGTERM feed one AbortController through the provider, temporary-file writer, and player. The CLI waits for cleanup and removes signal listeners. Cancellation prevents sound fallback. Native processes may still need their cleanup grace interval; see [process runner](process-runner.md).

The saved regression suite and remaining real-environment checks are described in [testing and release](testing-and-release.md).

## MCP

`doorbell-mcp` exposes get_instructions, notify, ring, and doctor over stdio. It uses the same runtime and queue as this CLI. See [Codex plugin](codex-plugin.md).
