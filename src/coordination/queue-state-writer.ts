import { setTimeout as delay } from "node:timers/promises";
import writeFileAtomic from "write-file-atomic";

type StateWriter = (path: string, contents: string) => Promise<void>;

const atomicWrite: StateWriter = (path, contents) =>
  writeFileAtomic(path, contents, { mode: 0o600, encoding: "utf8" });

/** Retry only transient Windows replacement failures, within the same queue lock. */
export async function writeQueueState(
  path: string,
  contents: string,
  assertLock: () => void,
  signal?: AbortSignal,
  writer: StateWriter = atomicWrite,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    assertLock();
    try {
      await writer(path, contents);
      assertLock();
      return;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException;
      if (
        platform !== "win32" ||
        attempt >= 4 ||
        failure.syscall !== "rename" ||
        !["EPERM", "EACCES", "EBUSY"].includes(failure.code ?? "")
      )
        throw error;
      // Reuse the exact state; never repeat admission or the delivery callback.
      assertLock();
      await delay(25 * (attempt + 1), undefined, { signal });
    }
  }
}
