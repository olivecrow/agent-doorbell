import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { resolvePathFfplayExecutable as resolveFfplayExecutable } from "../dist/audio/ffplay-executable.js";
import { FfplayAudioPlayer } from "../dist/audio/ffplay-player.js";
import { runPcmProcess } from "../dist/audio/pcm-player.js";
import { NodeProcessRunner } from "../dist/process/node-runner.js";
import { streamingAudio } from "../dist/speech/pcm-stream.js";
import { FileDeliveryQueue, getQueueDirectory, withDeliveryQueue } from "../dist/coordination/file-delivery-queue.js";
import { prepareQueueDirectory, validateQueueDirectory } from "../dist/coordination/private-queue-directory.js";

async function fixture(t) {
  const cwd = process.cwd();
  const tempRoot = await realpath(tmpdir());
  const root = await mkdtemp(join(tempRoot, "doorbell-security-"));
  t.after(async () => {
    process.chdir(cwd);
    assert.equal(dirname(root), tempRoot);
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

function useEnvironment(t, key, value) {
  const old = process.env[key];
  t.after(() => {
    if (old === undefined) delete process.env[key];
    else process.env[key] = old;
  });
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function pathKey() {
  return Object.keys(process.env).sort().find((key) =>
    process.platform === "win32" ? key.toUpperCase() === "PATH" : key === "PATH",
  ) ?? "PATH";
}

const audio = (cancel = () => {}) => streamingAudio((async function* () {
  yield new Uint8Array([0, 0]);
})(), cancel);

test("ffplay discovery rejects working-directory, relative PATH, and directory-alias candidates", async (t) => {
  const cwd = process.cwd();
  const root = await fixture(t);
  t.after(() => process.chdir(cwd));
  const untrusted = join(root, "checkout");
  const trusted = join(root, "installed tools");
  const alias = join(root, "checkout alias");
  await mkdir(untrusted);
  await mkdir(trusted);
  await symlink(untrusted, alias, process.platform === "win32" ? "junction" : "dir");
  const filename = process.platform === "win32" ? "ffplay.exe" : "ffplay";
  await writeFile(join(untrusted, filename), "not executable", { mode: 0o700 });
  await writeFile(join(trusted, filename), "test executable discovery", { mode: 0o700 });
  process.chdir(untrusted);
  useEnvironment(t, pathKey(), ["", ".", "relative-tools", untrusted, alias, trusted].join(delimiter));
  assert.equal(await resolveFfplayExecutable(), await realpath(join(trusted, filename)));
  process.env[pathKey()] = ["", ".", untrusted, alias].join(delimiter);
  await assert.rejects(resolveFfplayExecutable(), /absolute PATH directory/);
});

test("Windows working-directory executable shadow is never launched by file or PCM playback", { skip: process.platform !== "win32" }, async (t) => {
  const cwd = process.cwd();
  const root = await fixture(t);
  t.after(() => process.chdir(cwd));
  const untrusted = join(root, "checkout");
  const trusted = join(root, "trusted tools");
  await mkdir(untrusted);
  await mkdir(trusted);
  const shadow = join(untrusted, "ffplay.exe");
  // This inert copy only executes a fixed echo when deliberately used as a control.
  await copyFile(join(process.env.SystemRoot, "System32", "cmd.exe"), shadow);
  const executable = join(trusted, "ffplay.exe");
  await copyFile(process.execPath, executable);
  const runner = new NodeProcessRunner();
  assert.equal((await runner.run({ command: shadow, args: ["/d", "/c", "echo shadow-control"], timeoutMs: 3000 })).stdout.trim(), "shadow-control");
  process.chdir(untrusted);
  useEnvironment(t, pathKey(), trusted);
  const resolved = await resolveFfplayExecutable();
  assert.equal(resolved, await realpath(executable));
  const proof = await runner.run({ command: resolved, args: ["-e", "process.stdout.write('trusted-player')"], timeoutMs: 3000 });
  assert.equal(proof.ok, true);
  assert.equal(proof.stdout, "trusted-player");

  const seen = [];
  const pcmCommands = [];
  const player = new FfplayAudioPlayer(3000, {
    run: (request) => {
      seen.push(request.command);
      return runner.run(request);
    },
  }, resolveFfplayExecutable, async (request) => {
    pcmCommands.push(request.command);
    return runPcmProcess(request);
  });
  // Node rejects these ffplay flags; both checks must still launch the trusted file.
  assert.equal((await player.check()).available, false);
  assert.equal((await player.checkStreaming()).available, false);
  process.env[pathKey()] = untrusted;
  const wav = join(root, "sample.wav");
  await writeFile(wav, "inert test data");
  assert.equal((await player.play({ path: wav, format: "wav" })).ok, false);
  let cancelled = false;
  assert.equal((await player.playStream(audio(() => { cancelled = true; }))).ok, false);
  assert.equal(cancelled, true);
  assert.deepEqual(seen, [resolved, resolved, resolved]);
  assert.deepEqual(pcmCommands, [resolved]);
});

test("unavailable player discovery blocks process execution and always closes PCM input", async () => {
  let launches = 0;
  let resolutions = 0;
  let cancelled = 0;
  const unavailable = async () => { resolutions++; throw new Error("Unavailable"); };
  const player = new FfplayAudioPlayer(1000, { run: async () => { launches++; } }, unavailable);
  assert.equal((await player.check()).available, false);
  assert.equal((await player.checkStreaming()).available, false);
  assert.equal((await player.playStream(audio(() => cancelled++))).ok, false);
  assert.equal(launches, 0);
  assert.equal(resolutions, 1);
  assert.equal(cancelled, 1);
  assert.equal((await runPcmProcess({ command: "ffplay", args: [], chunks: audio().chunks, signal: new AbortController().signal, timeoutMs: 1000 })).ok, false);
});

test("all player operations reuse one resolved executable and preserve PCM cleanup", async (t) => {
  let resolutions = 0;
  const commands = [];
  const resolver = async () => { resolutions++; return process.execPath; };
  const pcmRunner = async (request) => {
    commands.push(request.command);
    for await (const _chunk of request.chunks) { /* Consume fake PCM only. */ }
    return { ok: true };
  };
  const player = new FfplayAudioPlayer(1000, {
    run: async (request) => { commands.push(request.command); return { ok: true, exitCode: 0, stdout: "s16le ch_layout", stderr: "" }; },
  }, resolver, pcmRunner);
  assert.equal((await player.check()).available, true);
  assert.equal((await player.checkStreaming()).available, true);
  const root = await fixture(t);
  const path = join(root, "test.wav");
  await writeFile(path, "fake audio");
  assert.equal((await player.play({ path, format: "wav" })).ok, true);
  let closed = 0;
  const result = await player.playStream(audio(() => closed++));
  assert.equal(result.ok, true);
  assert.equal(closed, 1);
  assert.equal(resolutions, 1);
  assert.deepEqual(commands, Array(4).fill(process.execPath));
});

test("queue defaults to the user profile and rejects directory links before delivery", async (t) => {
  useEnvironment(t, "DOORBELL_QUEUE_DIR", undefined);
  assert.equal(getQueueDirectory(), join(homedir(), ".agent-doorbell", "queue"));
  const root = await fixture(t);
  const foreign = join(root, "foreign");
  const linked = join(root, "linked queue");
  await mkdir(foreign, { mode: 0o700 });
  const marker = join(foreign, "untouched");
  await writeFile(marker, "preserve");
  await symlink(foreign, linked, process.platform === "win32" ? "junction" : "dir");
  let calls = 0;
  await assert.rejects(withDeliveryQueue(async () => { calls++; }, undefined, undefined, new FileDeliveryQueue(linked)), /not private or safe/);
  assert.equal(calls, 0);
  assert.equal(await readFile(marker, "utf8"), "preserve");
  await assert.rejects(lstat(join(foreign, "queue.json")), { code: "ENOENT" });
  await assert.rejects(prepareQueueDirectory("relative-queue"), /absolute/);
});

test("queue ownership policy rejects foreign owners and exposed permissions without changing them", async (t) => {
  const root = await fixture(t);
  const stats = await lstat(root);
  const policyStats = (uid, mode) => ({ ...stats, uid, mode, isDirectory: () => true, isSymbolicLink: () => false });
  assert.doesNotThrow(() => validateQueueDirectory(policyStats(123, 0o700), 123, true));
  for (const [uid, mode] of [[456, 0o700], [123, 0o755], [123, 0o770], [0, 0o700]]) {
    assert.throws(() => validateQueueDirectory(policyStats(uid, mode), 123, true), /not private or safe/);
  }
  assert.throws(() => validateQueueDirectory(policyStats(456, 0o755), 123, false), /not private or safe/);
  assert.throws(() => validateQueueDirectory(policyStats(123, 0o777), 123, false), /not private or safe/);
  assert.doesNotThrow(() => validateQueueDirectory(policyStats(0, 0o1777), 123, false));
  assert.equal((await lstat(root)).mode, stats.mode);
});

test("queue rejects a non-directory or redirected state and preserves the target", async (t) => {
  const root = await fixture(t);
  const file = join(root, "file");
  await writeFile(file, "preserve");
  await assert.rejects(new FileDeliveryQueue(file).acquire(), /not private or safe/);
  await assert.rejects(new FileDeliveryQueue(join(file, "child")).acquire());
  const queue = join(root, "queue");
  await mkdir(queue, { mode: 0o700 });
  const target = join(root, "target");
  await mkdir(target);
  await writeFile(join(target, "untouched"), "preserve");
  await symlink(target, join(queue, "queue.json"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(new FileDeliveryQueue(queue).acquire(), /invalid or unreadable/);
  assert.equal(await readFile(file, "utf8"), "preserve");
  assert.equal(await readFile(join(target, "untouched"), "utf8"), "preserve");
});

test("POSIX queue permissions fail closed without repair or side effects", { skip: process.platform === "win32" }, async (t) => {
  const root = await fixture(t);
  const exposed = join(root, "exposed");
  await mkdir(exposed, { mode: 0o700 });
  await chmod(exposed, 0o777);
  await assert.rejects(new FileDeliveryQueue(exposed).acquire(), /not private or safe/);
  assert.equal((await lstat(exposed)).mode & 0o777, 0o777);
  await assert.rejects(lstat(join(exposed, "queue.json")), { code: "ENOENT" });
});
