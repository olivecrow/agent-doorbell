# Testing and Release

## Automated Regression

The production dependency audit on 2026-11-19 reported zero known vulnerabilities after updating the MCP client and server to 2.4.0, smol-toml to 1.9.1, and Zod to 4.6.7.

`npm test` clean-builds TypeScript and runs Node's test runner. The 1.1.1 Windows / Node 24.15.0 batch passed 94 of 96 tests. The remaining two exercise native POSIX permissions and were skipped on Windows. API calls and audio in the ordinary suite are fake boundaries; CLI, queue, MCP, and process tests launch real isolated subprocesses. Production dependency audit reported zero known vulnerabilities.

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

`node scripts/verify-host-setup.mjs <installed-package-root>` exercises the real Codex and Claude CLIs with isolated host settings. It verifies preview, initial registration, unchanged repeated setup, native host discovery/connection, preserved unrelated settings, matching-entry removal, and repeated removal. Windows verification used Codex CLI 0.150.1 (app-server discovered all four tools) and Claude Code 2.1.81 (connected). It makes no model request and does not alter the normal user host setup. Ordinary tests separately cover plugin/registration conflicts and cancellation.

Use `node scripts/verify-package.mjs <tarball> --hosts --upgrade` for release acceptance: upgrade the public v1.0.0 package to the candidate while preserving saved speech preferences, validate the installed runtime and real host setup, then uninstall and verify settings remain. Omit --upgrade for fresh installation. Host setup's startup check and readback are distinct from a human listening result.

The 1.1.0 133-file package passed the v1.0.0 upgrade path on 2026-09-21: saved volume 1.25 survived installation, both real host adapters passed, the managed player handled MP3/WAV/PCM without PATH, and uninstall preserved the updated user settings. Codex reported MCP server version 1.1.0 and all four tools. This is isolated installation/process evidence, not a new provider or listening trial.

Use `npm pack` to exercise the clean prepack build. The files allowlist includes compiled runtime/declarations, documentation, plugin files, the MP3, and both license notices. It excludes source tests, development settings, temporary recordings, caches, and source maps. Inspect contents, then install the tarball in an unrelated directory with spaces and Unicode.

Validate the installed CLI and MCP server without developer imports. Node is an external prerequisite; new Windows x64 packages prepare a pinned ffplay through postinstall. Other platforms still require an external player. The package includes player/install.mjs, player/manifest.json and the third-party notice, but excludes downloaded player/bin files. Installation checks must allow lifecycle scripts so they exercise the automatic player setup. The plugin must use normal user settings and an installed runtime rather than a path into the source checkout. Preserve existing normal preferences and credentials; use the installed CLI's separate configuration commands for new settings or keys.

Run `node scripts/verify-package.mjs /absolute/path/agent-doorbell-1.1.3.tgz` to check a tarball in an isolated installation. It verifies an unrelated working directory containing spaces and Korean characters, CLI instructions and all 30 Gemini presets, discovery of all four MCP tools, conversational-language guidance, CLI-to-MCP volume persistence, and exclusion of development files and credential-like content.

On Windows x64, package verification also clears PATH, resolves the package-managed ffplay, checks version and PCM capability, and exercises MP3, buffered WAV, and PCM playback with local gain through SDL's dummy audio driver. This is real binary/process evidence without physical sound output or paid synthesis; it does not establish a new listening result. Installer regression tests cover checksum/size failures, allowlisted extraction, license retention, idempotence, modified files, links, cancellation, HTTP failure without retry, unsupported targets, and managed resolution without PATH.

The 2026-09-21 Windows run passed the full 90-test regression batch (88 passed, two POSIX-only skips), then all five installer/resolver tests including the additional package-owned-path case. The 129-file tarball passed clean installation with automatic ffplay download, no-PATH dummy-driver MP3/WAV/PCM playback, and all four MCP tools outside the source checkout. npm dependency audit reported zero known vulnerabilities. These checks did not publish a release or update the normal user runtime.

On 2026-09-20, the 115-file volume/language tarball passed these installation checks. The local runtime under `~/.agent-doorbell/runtime` and the enabled `doorbell@personal` plugin were verified independently of the source checkout. The installed doctor reported sound and speech ready with both provider keys configured.

A separate Codex session outside the repository read the installed skill, called `get_instructions`, and made exactly one `notify` request. OpenAI/coral/buffered speech completed through ffplay without fallback or warnings, and the user confirmed hearing the Korean notification. A later installed-plugin MCP check used the same provider/voice/mode with playbackVolume 1.5; it also completed without fallback or warnings, and the user confirmed the volume was appropriate. Process success and human listening are separate evidence.

Acceptance transcripts, temporary tarballs, and one-off verification scripts are disposable after their results are summarized here. Keep development settings in `.doorbell-dev/speech.json` separate from these artifacts. Reusable verification scripts remain under `scripts/`; `verify-live-audio.mjs` is an explicit opt-in account-backed check and makes one paid request.

## Scope and Release

Windows-only completion does not imply macOS/Linux support. The actual Claude Code MCP connection is verified separately from hooks; lifecycle hook invocation remains untested in the actual Claude host. Both hook adapters have automated input-contract and CLI coverage. Gemini continuous streaming requires new provider-throughput and human listening evidence before it can be enabled.

The code is MIT. The original C/E piano recording is separately MIT with the owner's explicit authorization; see [recording license](../assets/LICENSE.md). No purchased recording is included. Public npm publication and Git release operations require a separate user request.

Security changes in this checkout do not update an already installed plugin runtime. Install a newly verified package and restart its clients together to apply player resolution, the shared queue location, and private temporary speech storage; preserve normal settings and OS credentials.

Before final reporting, validate documentation UTF-8 and internal links, maintain current feature snapshots, and append/prune feature history under \_change_logs with the project-docs-bootstrap script.
