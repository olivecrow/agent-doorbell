# Agent Instructions

## Development Workflow

- This is an implementation project. The learning phase is complete; implement authorized product changes directly, including TypeScript, tests, build scripts, and documentation.
- Batch builds, regression checks, and documentation validation by feature. Do not stop at individual checklist items or ask the user to run automatable checks.
- Keep explanations focused on responsibility boundaries, dependency direction, and meaningful tradeoffs.
- Prefer suitable maintained packages, then place small adapters behind project contracts. Check platform prerequisites and completion, failure, and cancellation semantics before selecting a package.
- Preserve unrelated work. Commit, push, publish, and release only when requested.
- All built-in CLI prompts, help, errors, examples, and active documentation must be English.
- Remaining verification and release gates are in [docs/development-plan.md](docs/development-plan.md).

## Product Contracts

- The caller is an AI agent. A failed audio notification returns stderr and exit code 1. BEL/TTY output is not successful human notification; the calling agent must still deliver its text request.
- AttentionRequest contains a required message, an optional source, and optional per-call speech options. Hook event names belong only to their adapters, not to a closed core event taxonomy.
- The agent owns the request wording, the speech provider owns synthesis, and the local player owns audio output.
- Support the explicitly selected OpenAI or Gemini provider. OS/local TTS, subscription OAuth reuse, and voice UI automation remain outside scope.
- OpenAI is the default provider: gpt-4o-mini-tts with nova. Gemini uses gemini-3.1-flash-tts-preview with Kore. Keep the official 13 OpenAI and 30 Gemini voices in documented order; defaults are independent of list order.
- Keep each provider's model/voice preferences when switching. Accept existing flat OpenAI settings without rewriting them on read; writes use provider profiles.
- Saved voices are optional defaults. Delivery instructions, prompts, numeric speed, and voice overrides belong to each notify request, never to persistent personality settings.
- OpenAI accepts --instructions and --speed (0.25-4.0); Gemini accepts --prompt with the message appended as Transcript. Both accept --voice. Instructions and prompts allow at most 2000 UTF-16 code units after trimming.
- Ignore legacy style.tone on read without rewriting the file; remove style on the next explicit settings save. Reject the removed configure --tone/--reset-tone and notify --agent-tone flags.
- The agent-facing contract lives in [docs/agent-integration.md](docs/agent-integration.md) and is printed by doorbell agent-instructions. Do not make users describe an agent's personality.
- For a required response or action, send the native Codex question first. After 3 minutes (180 seconds) unanswered, proactively call Doorbell once with one short, actionable sentence. Recheck for a reply, completed action, cancellation, or obsolete request and record the attempt before calling. Keep the text pending after audio failure. No automatic wakeups or inferred approval. Explicit audio requests remain supported. See docs/agent-integration.md.
- Agents derive delivery controls from their current personality on every call. If no directions are supplied, omit custom instructions/prompt. Do not claim the CLI discovers private agent configuration.
- Unless the user explicitly requested or configured another spoken language, agents write notifications in the user's current conversational language. English manuals/examples do not select the spoken language. The CLI does not translate text or discover private language preferences.
- Agents may override voice for a single request, but not provider, model, playback mode, playback volume, enabled state, or credential source. Reject invalid and wrong-provider options before credentials or playback; do not hide them behind sound fallback.
- doorbell agent-instructions prints current non-secret configuration and links to each provider's official TTS and prompting manuals. Those instructions are for the caller, not a user personality setup flow.
- Send only the final notification sentence and bounded delivery instructions to the selected provider. Never send full conversations, full agent instructions, source identifiers, or private token files.
- Speech requires explicit activation and a readable key for the selected provider. Never retry a paid request automatically or switch to another cloud provider on failure; use the packaged sound.

## Configuration and Credentials

- doorbell configure api-key [--provider openai|gemini] only registers, replaces, or removes that provider's key through hidden input and the OS credential adapter. Omitted provider means OpenAI for compatibility. It never reads or writes speech.json.
- After set is selected, submitting valid hidden input saves the key immediately without an extra confirmation. Keep confirmation for key removal.
- The API-key action menu uses cancel, set, and remove. Cancel is the default and returns cancellation without touching credentials or reporting successful configuration.
- doorbell configure speech only manages non-secret settings, including provider selection. It never reads or writes credentials. --enable enables speech with the default voice without an interactive customization step. --list-voices is read-only.
- Removing the API key preserves speech preferences and activation; missing credentials cause sound fallback. API-key registration does not activate speech.
- Keep API keys out of JSON, CLI arguments, hook payloads, logs, and package contents. Provider authentication is injected through CredentialReader; storage failures must not fall back to plaintext files or environment variables.
- Normal settings live at homedir()/.agent-doorbell/speech.json. scripts/dev.mjs sets DOORBELL_CONFIG_DIR to the absolute repository .doorbell-dev/ path for that process only.
- Derive the credential service from the configuration path and use separate openai-api-key and gemini-api-key accounts. Preserve the existing OpenAI account identity. Do not infer development mode from CWD or npm link. Exclude development configuration from Git and npm releases.
- Diagnostics must display only configured, missing, or unavailable credential status.

## Audio and Remaining Work

- The bundled fallback is assets/notification.mp3, supplied by the user as their original recording of the C and E piano notes. Do not replace it with the old purchased recording or change/copy assets without authorization.
- The user licensed the original audio recording under MIT on 2026-09-20. Keep assets/LICENSE.md separate from the code license and include both in packages. Public npm release still requires an explicit request.
- File playback accepts paths and supports WAV and MP3. The current player uses ffplay through ProcessRunner; it does not implement decoding or device output.
- Install the pinned Windows x64 ffplay dependency through player/install.mjs at npm installation time. Keep archive/file hashes, the original binary license and source/build notice, bounded downloads, and no automatic retries. Never download during notifications or diagnosis. Other platforms remain PATH-based and unverified.
- Resolve the package-managed ffplay first, rejecting links and non-regular files. If it is absent, resolve from absolute PATH entries, excluding the current working directory and aliases to it. Reuse that absolute path for diagnosis, buffered playback, and streaming; never spawn a bare player name.
- configure speech --volume controls local speech gain (0.25-4, default 1). Persist playbackVolume independently of provider profiles. Apply gain with peak limiting to buffered/streaming speech only; do not change the packaged sound, system volume, or provider request body.
- Pass paths, messages, and hook data through argument arrays or environment variables, never interpolated shell commands.
- Buffered speech receives a complete response, plays WAV through a temporary file, and deletes it in finally. OpenAI returns WAV; Gemini returns 24 kHz, 16-bit signed little-endian mono PCM, wrapped as WAV by wavefile. Keep stale-file cleanup separate.
- Store temporary speech under ~/.agent-doorbell/speech-tmp, independently of OS TEMP and configuration scopes. DOORBELL_SPEECH_TEMP_DIR is an absolute override subject to the same security checks. Validate private ownership/permissions and Windows ACLs before buffered synthesis; fail to sound without a paid request if validation is unavailable or unsafe.
- Cleanup only this verified private root. Never scan, migrate, or automatically delete legacy OS temporary speech directories. Claim a directory under a fresh random name, verify its identity, and remove only a regular speech.wav and the empty directory; never recursively delete speech directories or repair existing permissions.
- Gemini uses the official @google/genai Interactions API with response_format: { type: "audio" }, store: false and no retries. Buffered requests use stream: false; the experimental streaming decoder uses stream: true. Use the model's default output format without a MIME/sample-rate override, then validate the returned PCM metadata. Keep its endpoint and credential source explicit. Reject unsupported or malformed audio before playback.
- Preserve the buffered | streaming type contract and buffered default. The real agent-authored Nova buffered listening gate was confirmed on 2026-09-20. OpenAI PCM streaming is implemented and heard; Gemini streaming is disabled in production after severe gaps in local listening. Select Gemini buffered before a paid request and report why.
- Streaming consumes raw PCM chunks in order, with 24 kHz, 16-bit signed little-endian, mono metadata, backpressure, cancellation, and cleanup. Do not collect all chunks before playing.
- Detect unsupported streaming before a paid request and report any switch to buffered. After a streaming request starts, failure falls back to sound without another paid request.
- Distinguish implementation, automated fake-boundary evidence, and real OS/account/listening evidence. Validate each OS, format, and playback mode separately.

- CLI, hooks, and MCP must use runtime.ts and the same per-user delivery queue. Never start a paid request before queue admission.
- Keep the shared queue under ~/.agent-doorbell/queue, independent of speech configuration scopes. Reject linked queue directories, unsafe POSIX ownership/permissions, and non-regular state files before delivery. Never repair or import untrusted legacy temporary queue state.
- Keep MCP stdout protocol-only. MCP tools may read configuration and credential statuses, but cannot write settings or keys. The plugin runtime uses normal user settings independently of this repository.
- Host setup is CLI-only: use native host CLIs for user-level MCP writes, preserve unrelated configuration, reject conflicting entries and enabled Doorbell plugins, and verify package startup plus saved registration. Preview must not write or launch processes. Removal only touches a matching registration; never change speech settings or credentials during setup.
- Keep unsupported streaming fallback before synthesis. Do not enable Gemini streaming until continuous playback has new provider and listening evidence.

<!-- project-docs-bootstrap:start -->

# Project Documentation Maintenance

- After changing code, behavior, architecture, or workflows, update the relevant project documents before reporting completion.
- Use README.md as the project overview and documentation entrypoint.
- Use docs/README.md as the documentation map for feature and subsystem documents.
- Keep feature documents under docs/ as current-state snapshots of implemented structure, behavior, data flow, and constraints.
- Keep remaining work in docs/development-plan.md; do not mix historical intent or CHANGE LOG rows into feature documents.
- Store feature CHANGE LOG rows separately under docs/\_change_logs/, one JSON object per line.
- Append feature changes with the project-docs-bootstrap manage_feature_changelog.py script, pruning to the configured limit.
- Validate documentation UTF-8 with check_utf8_docs.py before final reporting.
<!-- project-docs-bootstrap:end -->
