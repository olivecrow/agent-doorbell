# Speech Settings

parseSpeechSettings(input: unknown) validates non-secret settings, applies defaults, and returns a new object without mutating its input. It does not perform I/O or access credentials.

| Field                  | Accepted value               | Default                      |
| ---------------------- | ---------------------------- | ---------------------------- |
| enabled                | boolean                      | false                        |
| provider               | openai or gemini             | openai                       |
| providers.openai.model | gpt-4o-mini-tts              | gpt-4o-mini-tts              |
| providers.openai.voice | One of the 13 OpenAI presets | nova                         |
| providers.gemini.model | gemini-3.1-flash-tts-preview, gemini-3.8-flash-tts, or gemini-3.8-flash-lite-tts | gemini-3.1-flash-tts-preview |
| providers.gemini.voice | Case-sensitive preset for 3.1, or a catalog voice ID for 3.8 | Kore |
| playbackMode           | buffered or streaming        | buffered                     |
| playbackVolume         | Finite number from 0.25 to 4 | 1 (original level)           |

Missing fields use defaults. Null, invalid types, unsupported values, and unknown fields are rejected with static errors. API keys, message, source, and per-call speech controls cannot be saved in this object. Voice names are case-sensitive. Settings validation checks 3.8 voice ID syntax offline. The online picker validates availability with Gemini before saving.

Existing flat OpenAI settings with root model/voice and no provider remain valid, including explicit alloy. A legacy style object with an optional string tone is accepted for migration but discarded in the parsed result; it never affects synthesis. Loading never rewrites a file. Saving writes the canonical providers object with both profiles and preserves activation, mode, and explicit voice choices. It omits the legacy style field. Flat model/voice are also accepted for an explicitly selected provider, but cannot be mixed with providers. This prevents ambiguous voice ownership.

```json
{
  "enabled": true,
  "provider": "gemini",
  "providers": {
    "openai": { "model": "gpt-4o-mini-tts", "voice": "nova" },
    "gemini": { "model": "gemini-3.1-flash-tts-preview", "voice": "Kore" }
  },
  "playbackMode": "buffered",
  "playbackVolume": 1
}
```

Provider switches retain both profiles. Activation, playback mode, and playback volume are shared. selectSpeechSettings projects the active profile into a discriminated settings value for the selected adapter; adapters never receive another provider's profile. Playback volume is local gain, never a provider API parameter. Existing files without it read as 1 without being rewritten.

## Request Controls

The calling agent reads [agent integration](agent-integration.md) and authors directions from its current personality for each request. OpenAI uses notify --instructions and optional --speed; Gemini uses --prompt. Both accept a one-call --voice override. Omitted voice uses the saved provider default, while omitted directions mean no custom personality instructions. No delivery controls are persisted.

Agent requests cannot override provider, model, activation, credentials, playback mode, or playback volume. There is no separate text-rewriting request and no personality setup flow. The legacy --agent-tone, configure --tone, and --reset-tone flags are removed.

## Separate Commands

configure api-key [--provider openai|gemini] only accesses that provider's OS credentials; its default is always OpenAI. configure speech only accesses speech.json. Neither command requires the other store to be available.

`configure gemini` is the account-backed model and voice picker. It uses the Gemini key for catalog reads and applies a confirmed selection through the same atomic settings writer. See [Gemini TTS](gemini-tts.md).

configure speech --enable enables speech with default preferences on a fresh setup. --provider selects the synthesis provider; --voice updates that provider's voice. --playback-mode buffered|streaming changes the preferred mode. Unsupported streaming is reported and replaced with buffered before a request; Gemini currently follows that path. --provider, --voice, and --playback-mode leave activation unchanged. --show reads effective settings without creating a file. --list-voices lists the active provider's catalog, or the explicit --provider catalog without changing selection. Removing a key preserves speech settings; notify subsequently falls back to sound until that provider has a usable key.

`configure speech --volume 1.5` changes local speech gain without touching activation, voices, or keys. The interactive settings flow also offers numeric volume input. Values outside 0.25-4, non-finite values, and invalid types are rejected. Adjusted gain uses the player's peak limiter for buffered WAV and streaming PCM; the packaged sound and system volume are unchanged. See [audio player](audio-player.md).

## Paths and Persistence

getAppPaths() uses ~/.agent-doorbell by default or the absolute DOORBELL_CONFIG_DIR path. Relative paths and Windows drive-relative/root-relative paths are rejected. The resolved path determines both speech.json and the SHA-256-derived credential service name; Windows identity is case-normalized.

scripts/dev.mjs sets DOORBELL_CONFIG_DIR to this repository's .doorbell-dev/ directory. CWD and npm link do not identify development mode.

The loader accepts UTF-8 with an optional BOM. ENOENT means default settings; other read failures, invalid JSON, or invalid fields produce safe failure results.

The writer validates before writing, creates the parent directory, and uses write-file-atomic. It serializes only parsed settings with requested POSIX modes 0700/0600. These modes do not manage Windows ACLs. It checks cancellation before starting the atomic replacement, then awaits completion. Atomic replacement is not a cross-process edit lock.

The saved tests use temporary directories, not real user settings or credentials.
