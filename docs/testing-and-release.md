# Testing and Release

## Automated Regression

`npm test` clean-builds TypeScript and runs Node's test runner. The temporary-audio security batch on Windows / Node 24.15.0 completed 86 tests: 84 passed, with two native POSIX permission tests skipped on Windows. API calls and audio in the ordinary suite are fake boundaries; CLI, queue, MCP, and process tests launch real isolated subprocesses. Production dependency audit reported zero known vulnerabilities.

Coverage includes settings defaults and migration, independent provider profiles and credentials, hidden-input prompt logic, no persistent personality, per-call controls and wrong-provider rejection before side effects, safe errors, no paid retry, buffered cleanup, cancellation, exact Gemini PCM/WAV bytes, English CLI guidance, both native hook routes, FIFO contention and recovery, stale-file ownership, process failure/timeout, PCM order/backpressure/early consumption, SDK streaming frames, and MCP discovery/cancellation/shutdown.

`tests/security.test.mjs` covers executable shadowing, absolute PATH discovery, pinned file/PCM executable reuse, cancellation on discovery failure, private queue location, rejection of directory/state links, and POSIX ownership/permission policy. Windows runs the inert executable-shadow and junction cases; actual POSIX permission enforcement has a platform-specific test and must also be run on a POSIX host. No security regression test uses real keys, provider requests, or audio devices.

Queue persistence tests cover bounded Windows replacement retries, identical saved state, immediate failure for other storage errors, cancellation, and lock loss. After executable hardening, silent version and PCM capability probes also passed with the installed ffplay resolved by the new discovery code. This did not repeat provider calls or human listening checks.

`tests/speech-temp-security.test.mjs` verifies that OS TEMP and settings scopes cannot select speech storage, legacy temporary entries remain untouched, unsafe roots stop before synthesis, concurrent calls have separate files, and source-directory replacement cannot delete a junction target. Native Windows tests grant inherited Everyone read access only to a disposable fixture and verify rejection without permission repair. The ACL helper also rejects unavailable verification without leaking diagnostics. The shared filesystem validator retains the queue's existing contract.

Speech tests use an isolated root and `DOORBELL_SPEECH_TEMP_DIR`; Windows fixtures live under the user profile because OS TEMP can contain unrelated inherited grants. Fixtures are removed after testing. Normal settings, credentials, user audio, and existing directory permissions remain untouched. Tests require subprocess permission to run the fixed Windows PowerShell ACL check. Native macOS/Linux permission checks still require those operating systems.

The ordinary suite never reads a user's keys, changes their settings, calls a provider, or plays audio. `scripts/verify-native-credentials.mjs --run` is a separate opt-in native check using unique fake credential accounts with verified cleanup. It passed on Windows for independent provider identity, replacement, and removal.

Volume coverage verifies compatible reads, provider-switch persistence, invalid input, interactive/CLI editing, identical file/PCM filters, and unchanged sound fallback. `node scripts/verify-playback-volume.mjs` is a separate offline native FFmpeg check: gain 1.5 produced a 4,500 peak from 3,000, limited the 28,000-peak input to 31,130, and retained all 24,000 samples in both cases. It does not call a provider or play audio.

## Native and Listening Evidence

| Environment and mode                                            | Evidence                                                                                                                                                        | Result                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Windows x64 / Node 24.15.0 / ffplay 8.1.1, MP3 and buffered WAV | Prior device playback and user listening; temporary cleanup                                                                                                     | Verified locally                                          |
| OpenAI buffered coral                                           | Prior account-backed HTTP 200 and listening                                                                                                                     | Verified locally                                          |
| OpenAI buffered Nova, per-call instructions                     | Real agent-authored request during development, clean exit with no fallback, explicit user confirmation on 2026-09-20                                           | Verified locally                                          |
| OpenAI streaming Nova, omitted custom directions                | 78 chunks, 228,000 PCM bytes; first chunk about 1.85 s, source ended 2.57 s, playback completed 6.75 s; user heard clear speech                                 | Verified locally                                          |
| Gemini buffered Kore                                            | Prior account-backed HTTP 200, validated 24 kHz mono PCM, WAV cleanup, user listening                                                                           | Verified locally                                          |
| Gemini experimental Puck stream, prompt and audio tag           | User heard severe gaps. After separating the timeout, 117 chunks / 224,640 bytes arrived over about 21 s, with approximately 190 ms gaps for 40 ms audio chunks | Disabled in production; selects buffered before synthesis |
| Local PCM control with Gemini-sized silent chunks               | Source consumed in 153 ms; 4.68 s of PCM completed in 4.86 s                                                                                                    | Player throughput verified independently                  |
| macOS/Linux                                                     | No native account/device/listening checks in this task                                                                                                          | Unverified                                                |

The original 15-second Gemini stream attempt ended in sound fallback, without a second paid request. A deliberate developer verification after extending the streaming deadline completed but remained discontinuous. It is not treated as successful listening. Production preflight now chooses buffered for Gemini; automated tests prove one request with stream:false and an explicit warning.

Provider rate and acoustic quality can vary. Process success, fake chunks, and SDK shape checks do not prove hearing. The streaming limit is 60 seconds of PCM and a 60-second operation deadline; buffered synthesis keeps its 15-second deadline.

Existing terminal checks cover hidden key input, immediate save after submission, cancel as the default menu action, removal confirmation, and separate speech settings. These used temporary configuration scopes and fake keys. The newly added playback-mode choice has prompt-adapter and CLI regression coverage.

## Package and Local Plugin Checks

Use `npm pack` to exercise the clean prepack build. The files allowlist includes compiled runtime/declarations, documentation, plugin files, the MP3, and both license notices. It excludes source tests, development settings, temporary recordings, caches, and source maps. Inspect contents, then install the tarball in an unrelated directory with spaces and Unicode.

Validate the installed CLI and MCP server without developer imports. Node and ffplay are external prerequisites. The plugin must use normal user settings and an installed runtime rather than a path into the source checkout. Preserve existing normal preferences and credentials; use the installed CLI's separate configuration commands for new settings or keys.

Run `node scripts/verify-package.mjs /absolute/path/agent-doorbell-1.0.0.tgz` to check a tarball in an isolated installation. It verifies an unrelated working directory containing spaces and Korean characters, CLI instructions and all 30 Gemini voices, discovery of all four MCP tools, conversational-language guidance, CLI-to-MCP volume persistence, and exclusion of development files and credential-like content.

On 2026-09-20, the 115-file volume/language tarball passed these installation checks. The local runtime under `~/.agent-doorbell/runtime` and the enabled `doorbell@personal` plugin were verified independently of the source checkout. The installed doctor reported sound and speech ready with both provider keys configured.

A separate Codex session outside the repository read the installed skill, called `get_instructions`, and made exactly one `notify` request. OpenAI/coral/buffered speech completed through ffplay without fallback or warnings, and the user confirmed hearing the Korean notification. A later installed-plugin MCP check used the same provider/voice/mode with playbackVolume 1.5; it also completed without fallback or warnings, and the user confirmed the volume was appropriate. Process success and human listening are separate evidence.

Acceptance transcripts, temporary tarballs, and one-off verification scripts are disposable after their results are summarized here. Keep development settings in `.doorbell-dev/speech.json` separate from these artifacts. Reusable verification scripts remain under `scripts/`; `verify-live-audio.mjs` is an explicit opt-in account-backed check and makes one paid request.

## Scope and Release

Windows-only completion does not imply macOS/Linux support. The actual Claude host remains untested; both hook adapters are covered through their native input contracts and real CLI subprocesses. Gemini continuous streaming requires new provider-throughput and human listening evidence before it can be enabled.

The code is MIT. The original C/E piano recording is separately MIT with the owner's explicit authorization; see [recording license](../assets/LICENSE.md). No purchased recording is included. Public npm publication and Git release operations require a separate user request.

Security changes in this checkout do not update an already installed plugin runtime. Install a newly verified package and restart its clients together to apply player resolution, the shared queue location, and private temporary speech storage; preserve normal settings and OS credentials.

Before final reporting, validate documentation UTF-8 and internal links, maintain current feature snapshots, and append/prune feature history under \_change_logs with the project-docs-bootstrap script.
