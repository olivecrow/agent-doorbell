# Audio Player

For a confirmed missing provider key, `notify` plays `assets/notification-no-key.mp3` as one queued file. The second piano chime starts 0.80 seconds after the first, over its fading notes. The supplied Google AI Studio clip begins at 4.32 seconds, after the second chime finishes. The complete sequence lasts 9.96 seconds. It uses normal sound playback gain and cancellation. Direct `ring` and other fallback conditions play `assets/notification.mp3`.

Spoken notifications and Gemini voice previews begin with the single C and E piano recording in `assets/notification.mp3`. Its duration is about 3.5 seconds. Buffered audio is written to its private WAV file before the cue starts. Streaming waits for the first validated PCM chunk, holds it during the cue, and continues pulling PCM after the cue finishes. One queue lease covers the cue and the voice, and only the voice receives the configured speech gain. If the cue completed and subsequent notification speech playback fails, the cue counts as sound delivery and plays once. Cancelling the sequence cancels playback and closes any open stream.

createAudioPlayer returns FfplayAudioPlayer on Windows, macOS, and Linux. Unsupported platform names throw. Both ring and notify use this factory.

On Windows x64, npm postinstall prepares ffplay 8.1.1 under the installed package's player/bin directory. The pinned download manifest, installer, and license boundaries are documented in [managed ffplay](../player/README.md). The runtime never downloads software. Other platforms, or installations without managed files, use an existing ffplay on PATH.

`ffplay-executable.ts` prefers the package-owned binary and rejects linked managed directories, linked files, and non-regular files. If managed files are absent, it checks explicit absolute PATH entries, skips empty/relative entries and the current working directory, resolves directory/file aliases, and verifies a regular executable file. It does not delegate executable discovery to Windows or a shell. Working-directory files and aliases are never PATH candidates. Unsafe managed files fail closed instead of silently selecting another player.

FfplayAudioPlayer resolves the executable once per instance and reuses its absolute path for both probes, file playback, and PCM playback. Discovery failure starts no player. NodeProcessRunner invokes the resolved path with an argument array, shell disabled, and the options -nodisp -autoexit -hide_banner -nostats -loglevel error. The external player owns WAV/MP3 decoding and device output. Explicit PATH installations remain trusted: this does not defend against a compromised installation directory or another process with the same user privileges.

play() validates the format and nonempty path, resolves and checks the file, then awaits the process. Process failure, timeout, and even exit 0 with nonempty error-level stderr count as failure. The default timeout is 15 seconds. check() runs ffplay -version and preserves its failure reason; this is executable discovery, not proof of an output device.

PCM streaming is a separate capability. `checkStreaming()` probes ffplay's s16le demuxer and ch_layout support. `playStream()` passes 24 kHz signed 16-bit little-endian mono PCM through stdin using execa 10.0.1. Its iterable pipe applies backpressure; stdout is ignored and bounded error-level stderr is checked. The player waits for process completion, propagates cancellation, and closes upstream synthesis on process failure, timeout, or completion. PCM playback has a 60-second deadline and never creates a temporary WAV.

The unused play-sound dependency and declaration have been removed. Decoding and device output remain external; the project does not implement an audio device driver.

Security regression checks cover a working-directory executable shadow, relative and aliased PATH entries, pinned discovery across PATH changes, shared file/PCM selection, and upstream cancellation after discovery failure. The Windows shadow check uses inert system/runtime executables without API calls or device playback.

## Local Speech Volume

Saved playbackVolume is a finite gain from 0.25 to 4 (default 1). notify passes it to buffered file playback or streaming PCM playback, never to sound fallback or provider synthesis. At 1, the player adds no filter. Other values use the same ffplay `-af` argument in both paths: `alimiter=level_in=GAIN:limit=0.95:level=0:latency=1`. Only a validated number can enter this argument.

The [FFmpeg limiter](https://ffmpeg.org/ffmpeg-filters.html#alimiter) applies input gain, caps sample peaks at 0.95 full scale, disables automatic output normalization, and compensates its lookahead delay while flushing the end of the audio. This prevents gain-induced sample clipping; it cannot repair distortion already in the source or guarantee perceived loudness. System volume and the bundled MP3 are unchanged. ffplay must include this filter to use adjusted volume.

`scripts/verify-playback-volume.mjs` checks the installed FFmpeg filter offline without device output or API calls. Windows FFmpeg 8.1.1 retained all 24,000 samples: a 3,000-peak test signal reached 4,500 at gain 1.5, while a 28,000-peak signal was limited to 31,130. Regression tests separately verify file/stream argument parity, invalid-gain rejection, persistence, and unchanged sound fallback.

## Platform Evidence

| Target                                    | Format/mode          | Evidence                                                                 | Status                                           |
| ----------------------------------------- | -------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| Windows x64 / Node 24.15.0 / ffplay 8.1.1 | Buffered WAV and MP3 | Prior real playback, CLI checks, and user listening confirmation         | supported in the verified local environment      |
| macOS                                     | Buffered WAV and MP3 | Factory selection only                                                   | unverified                                       |
| Linux                                     | Buffered WAV and MP3 | Factory selection only                                                   | unverified                                       |
| Windows x64 / Node 24.15.0 / ffplay 8.1.1 | OpenAI streaming PCM | Account-backed Nova speech and user listening confirmation               | supported locally                                |
| Windows                                   | Gemini streaming PCM | Severe audible gaps; 4.68 seconds of audio arrived over about 21 seconds | disabled before synthesis; buffered used instead |
| macOS / Linux                             | Streaming PCM        | Not exercised                                                            | unverified                                       |

Prior Windows checks covered spaces, non-ASCII text and shell metacharacters in paths, missing/corrupt files, timeout, unsupported formats, and fake process failures. The process-based test result is distinct from the user's listening confirmation. Re-run relevant checks when playback code changes.

Follow the [ffplay command contract](https://ffmpeg.org/ffplay.html), while validating installation and actual device output on each claimed target. Package installation evidence is recorded in [testing and release](testing-and-release.md).
