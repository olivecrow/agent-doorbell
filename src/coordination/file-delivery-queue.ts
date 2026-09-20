import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, parse, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import lockfile from "proper-lockfile";
import type { DeliveryLease, DeliveryQueue } from "./delivery-queue.js";
import { prepareQueueDirectory } from "./private-queue-directory.js";
import { writeQueueState } from "./queue-state-writer.js";

interface Ticket {
  id: string;
  pid: number;
  expiresAt: number;
  active: boolean;
  source?: string;
}
interface State {
  version: 1;
  tickets: Ticket[];
}

export function getQueueDirectory(): string {
  const directory =
    process.env.DOORBELL_QUEUE_DIR ??
    join(homedir(), ".agent-doorbell", "queue");
  if (
    !isAbsolute(directory) ||
    (process.platform === "win32" && parse(directory).root.length <= 1)
  )
    throw new Error("Doorbell queue directory must be absolute.");
  return resolve(directory);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** A short-lived package lock protects FIFO admission; no messages or keys are stored. */
export class FileDeliveryQueue implements DeliveryQueue {
  constructor(
    readonly directory = getQueueDirectory(),
    private readonly waitMs = 120_000,
  ) {
    if (!Number.isInteger(waitMs) || waitMs < 1 || waitMs > 600_000)
      throw new Error("Queue wait must be from 1 to 600000 milliseconds.");
  }

  private async transaction<T>(
    update: (state: State) => T,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    const directory = await prepareQueueDirectory(this.directory);
    const path = join(directory, "queue.json");
    const deadline = Date.now() + 12_000;
    let release: (() => Promise<void>) | undefined;
    let compromised = false;
    while (!release) {
      signal?.throwIfAborted();
      try {
        release = await lockfile.lock(path, {
          realpath: false,
          stale: 10_000,
          update: 2000,
          retries: 0,
          onCompromised: () => {
            compromised = true;
          },
        });
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "ELOCKED" ||
          Date.now() >= deadline
        )
          throw new Error("Could not access the delivery queue.");
        await delay(40, undefined, { signal });
      }
    }
    try {
      signal?.throwIfAborted();
      let state: State = { version: 1, tickets: [] };
      try {
        const stats = await lstat(path);
        if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 131_072)
          throw new Error("Queue state is not a bounded regular file.");
        const bytes = await readFile(path);
        if (bytes.length > 131_072)
          throw new Error("Queue state is too large.");
        const parsed = JSON.parse(bytes.toString("utf8")) as State;
        if (
          parsed.version !== 1 ||
          !Array.isArray(parsed.tickets) ||
          parsed.tickets.length > 256 ||
          parsed.tickets.some(
            (ticket) =>
              !ticket ||
              typeof ticket.id !== "string" ||
              !/^[0-9a-f-]{36}$/.test(ticket.id) ||
              !Number.isInteger(ticket.pid) ||
              ticket.pid < 1 ||
              !Number.isFinite(ticket.expiresAt) ||
              typeof ticket.active !== "boolean",
          )
        )
          throw new Error("Invalid queue state.");
        state = parsed;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          throw new Error("Delivery queue state is invalid or unreadable.");
      }
      state.tickets = state.tickets.filter(
        (ticket) =>
          alive(ticket.pid) && (ticket.active || ticket.expiresAt > Date.now()),
      );
      const result = update(state);
      await writeQueueState(
        path,
        JSON.stringify(state) + "\n",
        () => {
          if (compromised) throw new Error("Delivery queue lock was lost.");
        },
        signal,
      );
      return result;
    } finally {
      await release();
    }
  }

  async acquire(source?: string, signal?: AbortSignal): Promise<DeliveryLease> {
    signal?.throwIfAborted();
    const id = randomUUID();
    const deadline = Date.now() + this.waitMs;
    const waiting = AbortSignal.timeout(this.waitMs);
    const operation = signal ? AbortSignal.any([signal, waiting]) : waiting;
    let admitted = false;
    try {
      await this.transaction((state) => {
        if (state.tickets.length >= 256)
          throw new Error("Delivery queue is full.");
        state.tickets.push({
          id,
          pid: process.pid,
          expiresAt: deadline,
          active: false,
          ...(source
            ? { source: createHash("sha256").update(source).digest("hex") }
            : {}),
        });
        admitted = true;
      }, operation);
      while (true) {
        operation.throwIfAborted();
        const acquired = await this.transaction((state) => {
          const first = state.tickets[0];
          if (first?.id !== id) return false;
          first.active = true;
          return true;
        }, operation);
        if (acquired) {
          operation.throwIfAborted();
          let released = false;
          return {
            release: async () => {
              if (released) return;
              await this.transaction((state) => {
                state.tickets = state.tickets.filter(
                  (ticket) => ticket.id !== id,
                );
              });
              released = true;
            },
          };
        }
        await delay(50, undefined, { signal: operation });
      }
    } catch (error) {
      if (admitted)
        await this.transaction((state) => {
          state.tickets = state.tickets.filter((ticket) => ticket.id !== id);
        }).catch(() => {});
      if (signal?.aborted)
        throw new Error("Waiting for audio delivery was cancelled.");
      if (waiting.aborted)
        throw new Error("Timed out waiting for audio delivery.");
      throw error;
    }
  }
}

export async function withDeliveryQueue<T>(
  operation: () => Promise<T>,
  source?: string,
  signal?: AbortSignal,
  queue: DeliveryQueue = new FileDeliveryQueue(),
): Promise<T> {
  const lease = await queue.acquire(source, signal);
  try {
    signal?.throwIfAborted();
    return await operation();
  } finally {
    await lease.release();
  }
}
