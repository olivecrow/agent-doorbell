# Process Runner

NodeProcessRunner implements the ProcessRunner boundary in src/process/runner.ts. FfplayAudioPlayer uses it for ring and notify, including external cancellation.

## Inputs and Results

- Pass command and args separately to spawn with shell: false and windowsHide: true.
- Merge request environment values over process.env without modifying the parent. Windows environment-key casing is not normalized.
- Reject invalid timeoutMs before spawning. The accepted range is integer 1–2,147,483,647.
- Pre-cancelled requests do not spawn. Abort is checked again after listener registration.
- Consume stdout/stderr as UTF-8 but retain only the first 1,000 UTF-16 code units of each. There is no truncation marker or surrogate-boundary repair.
- Successful exit returns ok: true and exitCode: 0. Failures retain output, nullable exitCode, and reason. Stderr alone does not fail the runner; the audio adapter applies its own policy.
- Synchronous spawn exceptions receive a static reason; asynchronous process errors may include the OS error message. This generic boundary does not redact arbitrary process output.

## Stopping and Cleanup

Timeout or abort starts one stop sequence, preserving the first reason. Request SIGTERM, then wait up to 1,000 ms for close. If the grace period expires while the process is still active, request SIGKILL, destroy pipe streams, unref the child, and return a failure stating that cleanup was not confirmed.

finish() prevents duplicate completion, clears timers, and removes the abort listener. kill false/throw and cleanup-time errors are preserved. Late error/close events cannot overwrite a settled result. Normal completion does not forcibly close streams.

Timeout is not an exact return-time guarantee. The grace-expiry path cannot prove child termination; whole process-tree termination is not implemented. This boundary has no stdin/PCM API. PCM playback uses a separate execa adapter with iterable backpressure, upstream cancellation, and bounded subprocess cleanup; see [audio player](audio-player.md).

## Evidence Boundary

Prior Windows Node 24.15.0 session harnesses covered normal/nonzero exit, Unicode output, argument preservation, environment behavior, output limits, missing commands, timeout, real cancellation with absent PID after completion, and fake cleanup failures/late events.

Saved regression coverage in `tests/lifecycle.test.mjs` now verifies real subprocess argument preservation, bounded output, invalid timeouts, process failure, timeout, and cancellation. These checks do not establish macOS/Linux behavior, physical audio, or keyboard cancellation through the entire stack. See [testing and release](testing-and-release.md) for the broader suite and separate package/listening evidence.
