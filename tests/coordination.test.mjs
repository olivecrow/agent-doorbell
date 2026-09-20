import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  FileDeliveryQueue,
  withDeliveryQueue,
} from "../dist/coordination/file-delivery-queue.js";
import { writeQueueState } from "../dist/coordination/queue-state-writer.js";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "doorbell-queue-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function until(predicate, pendingWorker) {
  const end = Date.now() + 8000;
  let exited;
  pendingWorker?.done.then(
    (result) => { exited = result; },
    (error) => { exited = { error: error.message }; },
  );
  while (!(await predicate())) {
    if (exited)
      assert.fail(`Queue worker exited before admission: ${JSON.stringify(exited)}`);
    if (Date.now() > end) assert.fail("Timed out waiting for queue state");
    await delay(20);
  }
}
async function state(dir) {
  return JSON.parse(await readFile(join(dir, "queue.json"), "utf8"));
}
function worker(t, dir, name, hold = 50) {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("./fixtures/queue-worker.mjs", import.meta.url)),
      dir,
      String(hold),
      name,
    ],
    { windowsHide: true },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
  return { child, done };
}

test("independent processes are admitted FIFO and duplicate sources are not dropped", async (t) => {
  const dir = await fixture(t);
  const first = await new FileDeliveryQueue(dir).acquire("private-source");
  const second = worker(t, dir, "same", 120);
  await until(async () => (await state(dir)).tickets.length === 2, second);
  const third = worker(t, dir, "same");
  await until(async () => (await state(dir)).tickets.length === 3, third);
  const bytes = await readFile(join(dir, "queue.json"), "utf8");
  assert.doesNotMatch(bytes, /private-source|same/);
  await first.release();
  const [b, c] = await Promise.all([second.done, third.done]);
  assert.equal(b.code, 0, b.stderr);
  assert.equal(c.code, 0, c.stderr);
  const eventsB = b.stdout.trim().split(/\r?\n/).map(JSON.parse);
  const eventsC = c.stdout.trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(eventsC[0].time >= eventsB[1].time);
  assert.deepEqual((await state(dir)).tickets, []);
});

test("waiting cancellation and timeout remove their tickets before work starts", async (t) => {
  const dir = await fixture(t);
  const first = await new FileDeliveryQueue(dir).acquire();
  const controller = new AbortController();
  let calls = 0;
  const cancelled = withDeliveryQueue(
    async () => {
      calls++;
    },
    undefined,
    controller.signal,
    new FileDeliveryQueue(dir),
  );
  const rejected = assert.rejects(cancelled, /cancelled/);
  await until(async () => (await state(dir)).tickets.length === 2);
  controller.abort();
  await rejected;
  await assert.rejects(new FileDeliveryQueue(dir, 50).acquire(), /Timed out/);
  assert.equal(calls, 0);
  assert.equal((await state(dir)).tickets.length, 1);
  await first.release();
  await first.release();
  assert.deepEqual((await state(dir)).tickets, []);
});

test("a crashed owner is removed, while an active live owner is never stolen", async (t) => {
  const dir = await fixture(t);
  const owner = worker(t, dir, "owner", 30000);
  await until(async () => {
    try {
      return (await state(dir)).tickets[0]?.active;
    } catch {
      return false;
    }
  });
  await assert.rejects(new FileDeliveryQueue(dir, 80).acquire(), /Timed out/);
  owner.child.kill("SIGKILL");
  await owner.done;
  const lease = await new FileDeliveryQueue(dir, 2000).acquire();
  assert.equal((await state(dir)).tickets.length, 1);
  await lease.release();
});

test("failure releases a lease and corrupt state fails closed", async (t) => {
  const dir = await fixture(t);
  const queue = new FileDeliveryQueue(dir);
  await assert.rejects(
    withDeliveryQueue(
      async () => {
        throw new Error("Operation failed");
      },
      undefined,
      undefined,
      queue,
    ),
    /Operation failed/,
  );
  assert.deepEqual((await state(dir)).tickets, []);
  await writeFile(join(dir, "queue.json"), "{broken");
  await assert.rejects(queue.acquire(), /invalid or unreadable/);
  assert.equal(await readFile(join(dir, "queue.json"), "utf8"), "{broken");
});

test("transient Windows queue replacements retry identical state and stay bounded", async () => {
  const busy = Object.assign(new Error("Transient replacement failure"), {
    code: "EPERM",
    syscall: "rename",
  });
  const writes = [];
  await writeQueueState("unused", "same ticket", () => {}, undefined, async (path, contents) => {
    writes.push([path, contents]);
    if (writes.length < 3) throw busy;
  }, "win32");
  assert.deepEqual(writes, Array(3).fill(["unused", "same ticket"]));
  let attempts = 0;
  await assert.rejects(writeQueueState("unused", "state", () => {}, undefined, async () => {
    attempts++;
    throw busy;
  }, "win32"), busy);
  assert.equal(attempts, 5);
});

test("queue persistence stops on cancellation, lost locks, and non-transient failures", async () => {
  const busy = Object.assign(new Error("Transient replacement failure"), {
    code: "EPERM",
    syscall: "rename",
  });
  const controller = new AbortController();
  let attempts = 0;
  await assert.rejects(writeQueueState("unused", "state", () => {}, controller.signal, async () => {
    attempts++;
    controller.abort();
    throw busy;
  }, "win32"), { name: "AbortError" });
  assert.equal(attempts, 1);

  attempts = 0;
  let compromised = false;
  await assert.rejects(writeQueueState("unused", "state", () => {
    if (compromised) throw new Error("Lock lost");
  }, undefined, async () => {
    attempts++;
    compromised = true;
    throw busy;
  }, "win32"), /Lock lost/);
  assert.equal(attempts, 1);

  for (const [platform, error] of [
    ["linux", busy],
    ["win32", Object.assign(new Error("Storage full"), { code: "ENOSPC", syscall: "rename" })],
    ["win32", Object.assign(new Error("Access denied"), { code: "EPERM", syscall: "open" })],
  ]) {
    attempts = 0;
    await assert.rejects(writeQueueState("unused", "state", () => {}, undefined, async () => {
      attempts++;
      throw error;
    }, platform), error);
    assert.equal(attempts, 1);
  }
});
