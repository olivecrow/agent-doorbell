# Delivery Coordination and Diagnosis

`runtime.ts` composes production notifications for the CLI, native hook adapters, and MCP. It validates input against the selected provider before any credential access, then holds a delivery lease across synthesis, playback, and sound fallback. `ring` and explicit doctor sound tests use the same queue.

## Queue

`FileDeliveryQueue` stores a FIFO ticket list under `~/.agent-doorbell/queue`. Development and normal settings share it independently of `DOORBELL_CONFIG_DIR`, so separate repositories and Codex sessions do not intentionally play over one another. `DOORBELL_QUEUE_DIR` may select an absolute directory for isolated tests, subject to the same directory validation.

`private-queue-directory.ts` delegates directory creation and POSIX validation to `filesystem/private-directory.ts` and uses the canonical directory for queue I/O. The queue directory and creation anchor must be real directories, not symbolic links or junctions. On POSIX, the queue must belong to the current user with no group/other access; canonical ancestors must belong to that user or root and prohibit group/other writes, except root-owned sticky temporary ancestors. Newly created directories use mode 0700. Unsafe existing permissions are rejected without chmod, deletion, or state repair. The queue retains its Windows user-profile ACL boundary; the explicit Windows ACL verification option is enabled for private speech storage.

Legacy queues in the shared OS temporary directory are not read or migrated. Restart and update cooperating Doorbell runtimes together when adopting the new location; an older installed runtime still uses its previous queue. Non-regular or linked state files are rejected before reading them, and the bounded JSON is committed with mode 0600.

The maintained [proper-lockfile](https://github.com/moxystudio/node-proper-lockfile) package owns the short state transaction lock through atomic directory creation and heartbeat timestamps. `write-file-atomic` commits the state. On Windows, rename failures with EPERM, EACCES, or EBUSY may retry the identical state at most four times, with 250 ms of total backoff, while retaining and checking the same lock. Cancellation and lost locks stop these retries; other failures propagate immediately. This repeats only atomic persistence, never ticket registration or a paid delivery. Lock settings are consistent across clients: 10-second stale threshold, 2-second update interval, bounded acquisition retry. The package is not used as a long-lived audio lock.

Tickets record an opaque UUID, owner PID, deadline, and active state. Optional source values are hashed; neither message text nor credentials are stored. FIFO means transaction registration order, which can differ from process launch time. Every call gets a ticket: there is no automatic duplicate suppression or cooldown, because a repeated request may be intentional.

Waiting defaults to 120 seconds, is cancellable, and starts no paid request until admission. Cancellation and timeouts remove the waiting ticket. The active lease is removed in `finally`; repeated release is harmless. A dead owner is pruned, while a live active owner is never stolen just because its original waiting deadline passed. Invalid or unreadable queue state fails rather than resetting another caller's work.

The 256-ticket limit and 128 KiB state limit bound local storage. This coordinates cooperating Doorbell processes, not arbitrary audio software. A forcibly killed process can leave an operating-system child player briefly alive; crash ticket recovery alone does not prove that an orphaned device stream has stopped.

## Doctor

`doorbell doctor` is silent diagnosis; `--json` supplies machine-readable output. It reports Node/platform/architecture, WSL/SSH/CI/TTY context, the active settings path and selected profile, ffplay availability, independent WAV/MP3/PCM stream capabilities, the packaged asset, and readiness. Each provider's credential status is only `configured`, `missing`, or `unavailable`.

Diagnosis does not synthesize speech, validate a key against a provider, play audio, or write settings. `--play-sound` explicitly adds one queued offline playback test. Exit 1 means a required capability, active speech prerequisite, configuration, or requested sound test failed. Readiness is not proof of physical hearing.

Independent-process tests cover FIFO/no overlap, repeated source identities, cancellation, timeouts, dead owners, preservation of live owners, failure release, and corrupt state. Security tests additionally reject linked directories/state and unsafe ownership/permission policies before the delivery callback starts. Native Windows checks are recorded in [testing and release](testing-and-release.md).
