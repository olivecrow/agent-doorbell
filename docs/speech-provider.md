# Speech Providers

createSpeechProvider selects OpenAiSpeechProvider or GeminiSpeechProvider behind SpeechProvider. The selected adapter receives validated provider-specific settings and its CredentialReader; synthesize({ message, speech? }, signal?) receives the final sentence, ephemeral SpeechOptions, and optional cancellation signal. Selection is explicit, with no cross-provider fallback.

## OpenAI Request Mapping

The model is gpt-4o-mini-tts, the default voice is nova, and the response format is WAV for buffered playback or raw PCM with stream_format: audio for streaming. The adapter passes request speech.instructions directly as instructions and speech.speed as speed when supplied. A request voice overrides the saved default for that call. Omitted directions and speed are omitted from the API body. There is no preset mapping or secondary text-generation request.

The supported voice presets and free-text instructions follow the [official Speech API guide](https://developers.openai.com/api/docs/guides/text-to-speech). The 13-item voice list preserves official order while nova is the explicit application default.

Only the final message and per-call directions are included as speech content. source, full conversation, and agent configuration are not sent. The provider copies its settings on construction and normalizes fresh options per synthesis, preventing previous requests from changing later defaults.

Both adapters' check() inspects activation and credential availability without network access. It cannot establish key validity or quota. synthesize() checks prerequisites directly, validates the 1–120-character message and provider-specific options before reading its key once per synthesis. Invalid direct synthesis inputs return a safe failure without a credential read or network call.

## Gemini Request Mapping

GeminiSpeechProvider uses the official @google/genai 2.23.0 SDK to call Interactions. The 3.8 models use structured style metadata and return WAV. The 3.1 preview uses a prompt followed by the Transcript and returns raw PCM for WAV wrapping. The separate REST catalog adapter reads available models, voices, and stored designed-voice samples. Player preflight, temporary-file lifecycle, and sound fallback are shared. See [Gemini TTS](gemini-tts.md) for the request and [agent integration](agent-integration.md) for per-call options.

## Errors and Cancellation

- OpenAI uses fixed https://api.openai.com/v1, SDK logging off, and maxRetries: 0. Gemini uses fixed https://generativelanguage.googleapis.com/v1beta/interactions and maxRetries: 0.
- Missing/unavailable credentials fail safely without environment-variable or plaintext fallback.
- Buffered timeout is 15 seconds. Streaming allows 60 seconds because generation and consumption overlap; the PCM byte limit remains 60 seconds of audio.
- Combine caller, timeout, and stream cleanup signals. They remain attached throughout response consumption.
- Return safe reasons and optional HTTP status; never return remote error bodies, credentials, or authorization headers.
- Return nonempty WAV bytes as buffered audio. Gemini validates raw PCM metadata and wraps it in WAV with wavefile; file decoding and device output belong to the player.
- A synthesis failure is handled by notify's sound fallback, never another provider or repeated paid request.

OpenAI streaming returns an async PCM iterable with explicit 24 kHz/16-bit/signed/little-endian/mono metadata and a cancellation handle. At most one partial sample is retained for alignment; empty, truncated, or oversized streams fail. The player consumes chunks as they arrive, not after collecting the response.

Player and provider capabilities are checked before a paid request. Missing PCM support switches to buffered with a warning. Gemini's stream decoder exists and has fake-SSE coverage, but production streaming is disabled after local listening revealed severe gaps and measured arrival slower than playback. Gemini selects buffered before its single paid request. Once a streaming request starts, any failure goes directly to sound without another synthesis.

## Temporary Audio

Temporary speech lives under `~/.agent-doorbell/speech-tmp`, independently of OS TEMP/TMP/TMPDIR and `DOORBELL_CONFIG_DIR`. `DOORBELL_SPEECH_TEMP_DIR` may select an absolute path for isolated tests, subject to the same checks. Legacy OS temporary speech directories are never scanned, migrated, or automatically deleted.

`filesystem/private-directory.ts` validates the creation anchor and canonical ancestors before creating children. It rejects directory links and unsafe POSIX ownership/permissions, creating new directories with mode 0700. Existing permissions are never repaired. On Windows, `windows-directory-acl.ts` uses the built-in Windows PowerShell executable at its absolute system path and the .NET ACL API. It verifies private access for the selected root and prevents untrusted ancestor replacement. Current-user, SYSTEM, Administrators, and TrustedInstaller access are trusted; unrelated read/write grants, including inherited child grants, fail the private-directory check. Traverse/synchronize-only grants are harmless. Deny rules do not override this conservative allow-rule policy. Null or unreadable ACLs fail closed. This protects against other users, not administrators or processes already running as the same user.

The Windows check is read-only, has a five-second timeout, supports cancellation, loads no profiles or modules, and receives paths through environment data rather than interpolated commands. No new npm or native-build dependency is needed. `notify` checks private storage before a buffered synthesis request, including a streaming-to-buffered switch. Unsafe storage or unavailable ACL verification causes offline sound fallback without contacting the speech provider. Storage is checked again before creating a WAV. True PCM streaming creates no temporary WAV.

`playBufferedSpeech` checks format and nonempty bytes, creates a unique PID-prefixed directory within that verified root, writes only `speech.wav` with exclusive creation and mode 0600, awaits playback, and cleans up in `finally`. It records directory identities. Cleanup first renames the owned directory to a fresh random name inside the private root and rechecks identity, so a replaced source path cannot redirect deletion. It unlinks only the known regular WAV and removes the empty directory, without recursive deletion. Root/directory replacement, links, or unexpected contents cause a cleanup warning and preserve the suspect data. Concurrent calls use separate paths; cancellation reaches writing and playback but does not cancel cleanup.

`cleanupStaleSpeechFiles` applies the same deletion boundary only to entries at least 24 hours old whose PID is confirmed absent by ESRCH. Live/unknown PIDs, recent files, links, unexpected children, and non-regular audio remain untouched. A claimed directory carries the cleanup process PID so a second cleaner preserves it; if that process dies, the normal stale rule can recover it. PID reuse can delay cleanup. Forced termination can leave a private WAV until a subsequent notification after the age threshold. Cleanup failure does not reverse playback success.

The Windows permission behavior follows the [file rights API](https://learn.microsoft.com/en-us/dotnet/api/system.security.accesscontrol.filesystemrights) and [directory ACL inheritance](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createdirectoryw); mode 0600 alone does not establish a private Windows ACL.

## Evidence Boundary

The prior Windows / Node 24.15.0 development verification received HTTP 200 for buffered gpt-4o-mini-tts with coral, completed ffplay playback, deleted the WAV, returned exit 0, and received human listening confirmation. A subsequent real agent-authored Nova buffered notification with delivery instructions was heard and confirmed by the user on 2026-09-20.

Saved tests verify both providers' defaults, transient overrides, SDK requests, safe failures, single-request fallback, and temporary-file cleanup with fake credentials, responses, and players. Gemini tests also verify the default-format request, WAV header, exact signed PCM sample bytes, and HTTP status preservation. Automated tests do not prove acoustic quality or physical playback.

Gemini has separate Windows account-backed evidence: HTTP 200 with Kore and neutral delivery in the earlier listening check, 24 kHz mono PCM wrapped as WAV, successful ffplay speech delivery, temporary-file cleanup, and user listening confirmation. The call used the product notify API with a transient Gemini selection; saved settings were unchanged. See [Gemini TTS](gemini-tts.md) for the validated request contract.

OpenAI Nova streaming with omitted directions also completed and was heard. Gemini Puck streaming with a per-call prompt was audibly discontinuous; it is not a supported production mode. See [testing and release](testing-and-release.md) and the [development plan](development-plan.md) for current evidence and exclusions.
