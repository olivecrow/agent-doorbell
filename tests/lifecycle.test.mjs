import assert from "node:assert/strict";
import "./fixtures/speech-temp.mjs";
import { test } from "node:test";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  utimes,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { NodeProcessRunner } from "../dist/process/node-runner.js";
import { cleanupStaleSpeechFiles } from "../dist/speech/temp-speech-files.js";
import { playBufferedSpeech } from "../dist/speech/play-buffered-speech.js";

test("real processes preserve literal Unicode arguments, bounded output, timeout, cancellation, and failure", async () => {
  const runner = new NodeProcessRunner();
  const literal = '한글 " $() & ; ` literal';
  const success = await runner.run({
    command: process.execPath,
    args: [
      "-e",
      "process.stdout.write(process.argv[1]); process.stderr.write('x'.repeat(10000));",
      literal,
    ],
    timeoutMs: 2000,
  });
  assert.equal(success.ok, true);
  assert.equal(success.stdout, literal);
  assert.equal(success.stderr.length, 1000);
  assert.equal(
    (
      await runner.run({
        command: "doorbell-nonexistent-player",
        args: [],
        timeoutMs: 1000,
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await runner.run({
        command: process.execPath,
        args: ["-e", "process.exit(7)"],
        timeoutMs: 2000,
      })
    ).exitCode,
    7,
  );
  for (const timeout of [0, -1, 1.5, Infinity])
    assert.match(
      (
        await runner.run({
          command: process.execPath,
          args: [],
          timeoutMs: timeout,
        })
      ).reason,
      /Invalid timeout/,
    );
  for (const action of ["timeout", "cancel"]) {
    const controller = new AbortController();
    const pending = runner.run({
      command: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"],
      timeoutMs: action === "timeout" ? 60 : 2000,
      signal: controller.signal,
    });
    if (action === "cancel") setTimeout(() => controller.abort(), 60);
    const result = await pending;
    assert.equal(result.ok, false);
    assert.match(
      result.reason,
      action === "timeout" ? /timed out/ : /cancelled/,
    );
  }
});

test("temporary WAV is removed after player failure or cancellation", async () => {
  for (const mode of ["failure", "throw", "cancel"]) {
    let path;
    const controller = new AbortController();
    const result = await playBufferedSpeech(
      { mode: "buffered", format: "wav", bytes: Uint8Array.from([1, 2]) },
      {
        supports: () => true,
        play: async (request) => {
          path = request.path;
          await access(path);
          if (mode === "throw") throw new Error("Device failed");
          if (mode === "cancel") controller.abort();
          return { ok: false, reason: "Stopped." };
        },
      },
      controller.signal,
    );
    assert.equal(result.ok, false);
    await assert.rejects(access(path));
  }
});

test("stale cleanup removes only old, dead-owner known files and preserves live, recent, and unexpected entries", async (t) => {
  const parent = dirname(process.env.DOORBELL_SPEECH_TEMP_DIR);
  const root = await mkdtemp(join(parent, "doorbell-cleanup-test-"));
  t.after(() => {
    assert.equal(dirname(root), parent);
    return rm(root, { recursive: true, force: true });
  });
  let deadPid = 2147483000;
  while (true) {
    try {
      process.kill(deadPid, 0);
      deadPid--;
    } catch (error) {
      if (error.code === "ESRCH") break;
      deadPid--;
    }
  }
  const previous = {
    DOORBELL_SPEECH_TEMP_DIR: process.env.DOORBELL_SPEECH_TEMP_DIR,
  };
  for (const key of Object.keys(previous)) process.env[key] = root;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const old = new Date(Date.now() - 25 * 3600000);
  for (const [suffix, pid, age, extra] of [
    ["old", deadPid, true, false],
    ["live", process.pid, true, false],
    ["recent", deadPid, false, false],
    ["extra", deadPid, true, true],
  ]) {
    const directory = join(root, `agent-doorbell-speech-${pid}-${suffix}`);
    await mkdir(directory, { mode: 0o700 });
    const file = join(directory, "speech.wav");
    await writeFile(file, "test", { mode: 0o600 });
    if (extra) await writeFile(join(directory, "preserve.txt"), "keep");
    if (age) {
      await utimes(file, old, old);
      await utimes(directory, old, old);
    }
  }
  const result = await cleanupStaleSpeechFiles();
  assert.deepEqual(result, { removed: 1, failed: 0 });
  await assert.rejects(
    access(join(root, `agent-doorbell-speech-${deadPid}-old`)),
  );
  for (const [pid, suffix] of [
    [process.pid, "live"],
    [deadPid, "recent"],
    [deadPid, "extra"],
  ])
    await access(
      join(root, `agent-doorbell-speech-${pid}-${suffix}`, "speech.wav"),
    );
});
