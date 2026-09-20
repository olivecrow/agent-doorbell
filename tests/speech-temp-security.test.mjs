import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import "./fixtures/speech-temp.mjs";
import {
  cleanupStaleSpeechFiles,
  getSpeechTempDirectory,
  prepareSpeechTempDirectory,
} from "../dist/speech/temp-speech-files.js";
import { playBufferedSpeech } from "../dist/speech/play-buffered-speech.js";
import { assertWindowsPrivateDirectory } from "../dist/filesystem/windows-directory-acl.js";
import { notify } from "../dist/commands/notify.js";
import { parseSpeechSettings } from "../dist/config/parse-speech-settings.js";

const audio = { mode: "buffered", format: "wav", bytes: Buffer.from("inert speech fixture") };
const linkType = process.platform === "win32" ? "junction" : "dir";
const old = new Date(Date.now() - 25 * 3600000);

function environment(t, key, value) {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
}

async function fixture(t) {
  const parent = dirname(process.env.DOORBELL_SPEECH_TEMP_DIR);
  const root = await fs.mkdtemp(join(parent, "security-"));
  environment(t, "DOORBELL_SPEECH_TEMP_DIR", join(root, "speech"));
  return root; // The suite's isolated parent owns final cleanup.
}

function deadPid() {
  for (let pid = 2147483000; pid > 1; pid--) {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === "ESRCH") return pid; }
  }
  throw new Error("No unused PID for fixture");
}

async function staleDirectory(root, suffix) {
  const directory = join(root, `agent-doorbell-speech-${deadPid()}-${suffix}`);
  await fs.mkdir(directory, { mode: 0o700 });
  await fs.writeFile(join(directory, "speech.wav"), "preserve or remove only this fixture", { mode: 0o600 });
  await fs.utimes(join(directory, "speech.wav"), old, old);
  await fs.utimes(directory, old, old);
  return directory;
}

async function assertNoPaidDelivery() {
  let synthesis = 0;
  const played = [];
  const result = await notify({ message: "Review." }, {
    settings: parseSpeechSettings({ enabled: true }),
    player: {
      id: "fixture", supports: () => true,
      check: async () => ({ available: true }),
      play: async ({ format }) => { played.push(format); return { ok: true }; },
    },
    createProvider: () => ({
      id: "fixture", capabilities: { supportsStreaming: false },
      synthesize: async () => { synthesis++; return { ok: true, audio }; },
    }),
  });
  assert.equal(synthesis, 0);
  assert.deepEqual(played, ["mp3"]);
  assert.equal(result.delivery.mode, "sound");
}

test("speech defaults ignore OS temporary and configuration directories", (t) => {
  environment(t, "DOORBELL_SPEECH_TEMP_DIR", undefined);
  for (const key of ["TMP", "TEMP", "TMPDIR", "DOORBELL_CONFIG_DIR"])
    environment(t, key, "untrusted-directory");
  assert.equal(getSpeechTempDirectory(), join(homedir(), ".agent-doorbell", "speech-tmp"));
});

test("legacy OS temporary entries are never scanned or migrated", async (t) => {
  const root = await fixture(t);
  const legacy = join(root, "legacy");
  await fs.mkdir(legacy, { mode: 0o700 });
  const candidate = await staleDirectory(legacy, "legacy");
  for (const key of ["TMP", "TEMP", "TMPDIR"]) environment(t, key, legacy);
  const result = await cleanupStaleSpeechFiles();
  assert.deepEqual(result, { removed: 0, failed: 0 });
  assert.ok((await fs.readFile(join(candidate, "speech.wav"))).length > 0);
  await assert.rejects(fs.access(getSpeechTempDirectory()), { code: "ENOENT" });
});

test("linked or relative roots stop before synthesis, file writes, and cleanup", async (t) => {
  const root = await fixture(t);
  const foreign = join(root, "foreign");
  await fs.mkdir(foreign, { mode: 0o700 });
  const candidate = await staleDirectory(foreign, "foreign");
  await fs.symlink(foreign, getSpeechTempDirectory(), linkType);
  await assertNoPaidDelivery();
  assert.deepEqual(await cleanupStaleSpeechFiles(), { removed: 0, failed: 1 });
  assert.ok((await fs.readFile(join(candidate, "speech.wav"))).length > 0);
  environment(t, "DOORBELL_SPEECH_TEMP_DIR", "relative");
  await assertNoPaidDelivery();
});

test("concurrent buffered calls use separate private directories and leave no WAVs", async (t) => {
  await fixture(t);
  const paths = [];
  const player = {
    supports: () => true,
    play: async ({ path }) => {
      paths.push(path);
      assert.deepEqual(await fs.readFile(path), audio.bytes);
      if (process.platform !== "win32") {
        assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
        assert.equal((await fs.stat(dirname(path))).mode & 0o777, 0o700);
      }
      return { ok: true };
    },
  };
  const results = await Promise.all([playBufferedSpeech(audio, player), playBufferedSpeech(audio, player)]);
  assert.ok(results.every((result) => result.ok && !result.cleanupWarning));
  assert.equal(new Set(paths).size, 2);
  assert.deepEqual(await fs.readdir(getSpeechTempDirectory()), []);
});

test("a directory swapped for a junction during cleanup cannot delete its target", async (t) => {
  const root = await fixture(t);
  const storage = await prepareSpeechTempDirectory();
  const candidate = await staleDirectory(storage, "swap");
  const victim = join(root, "unrelated");
  await fs.mkdir(victim, { mode: 0o700 });
  await fs.writeFile(join(victim, "speech.wav"), "unrelated fixture", { mode: 0o600 });
  const rename = fs.rename.bind(fs);
  let swapped = false;
  t.mock.method(fs, "rename", async (from, to) => {
    if (from === candidate && !swapped) {
      swapped = true;
      await rename(candidate, join(root, "parked"));
      await fs.symlink(victim, candidate, linkType);
    }
    return rename(from, to);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.deepEqual(await cleanupStaleSpeechFiles(), { removed: 0, failed: 1 });
  assert.equal(swapped, true);
  assert.equal(await fs.readFile(join(victim, "speech.wav"), "utf8"), "unrelated fixture");
});

test("normal cleanup rejects a replaced playback directory without following its link", async (t) => {
  const root = await fixture(t);
  const victim = join(root, "unrelated");
  await fs.mkdir(victim, { mode: 0o700 });
  await fs.writeFile(join(victim, "speech.wav"), "unrelated fixture", { mode: 0o600 });
  const result = await playBufferedSpeech(audio, {
    supports: () => true,
    play: async ({ path }) => {
      await fs.rename(dirname(path), join(root, "parked"));
      await fs.symlink(victim, dirname(path), linkType);
      return { ok: true };
    },
  });
  assert.equal(result.ok, true);
  assert.match(result.cleanupWarning, /Could not remove/);
  assert.equal(await fs.readFile(join(victim, "speech.wav"), "utf8"), "unrelated fixture");
});

test("Windows inherited public read is rejected without rewriting permissions", { skip: process.platform !== "win32" }, async (t) => {
  const root = await fixture(t);
  const exposed = join(root, "public ' ; $ directory");
  await fs.mkdir(exposed);
  const command = join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  await promisify(execFile)(command, ["-NoProfile", "-NonInteractive", "-Command", `
    $ErrorActionPreference = 'Stop'
    $path = $env:DOORBELL_TEST_ACL_PATH
    $acl = [IO.Directory]::GetAccessControl($path)
    $sid = [Security.Principal.SecurityIdentifier]::new('S-1-1-0')
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::ReadAndExecute, [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit', [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($rule)
    [IO.Directory]::SetAccessControl($path, $acl)
  `], { windowsHide: true, env: { ...process.env, DOORBELL_TEST_ACL_PATH: exposed } });
  environment(t, "DOORBELL_SPEECH_TEMP_DIR", exposed);
  await assertNoPaidDelivery();
  assert.deepEqual(await cleanupStaleSpeechFiles(), { removed: 0, failed: 1 });
  assert.deepEqual(await fs.readdir(exposed), []);
  await assert.rejects(assertWindowsPrivateDirectory(exposed), /permissions/);
});

test("unavailable Windows ACL verification fails with a bounded non-secret error", { skip: process.platform !== "win32" }, async () => {
  await assert.rejects(assertWindowsPrivateDirectory("unused", undefined, {
    run: async () => ({ ok: false, exitCode: null, stdout: "", stderr: "private diagnostic", reason: "private diagnostic" }),
  }), (error) => /could not be verified/.test(error.message) && !error.message.includes("private diagnostic"));
});

test("POSIX exposed speech storage is rejected before delivery and is not repaired", { skip: process.platform === "win32" }, async (t) => {
  await fixture(t);
  const storage = await prepareSpeechTempDirectory();
  await fs.chmod(storage, 0o777);
  t.after(() => fs.chmod(storage, 0o700));
  await assertNoPaidDelivery();
  assert.deepEqual(await cleanupStaleSpeechFiles(), { removed: 0, failed: 1 });
  assert.equal((await fs.stat(storage)).mode & 0o777, 0o777);
  assert.deepEqual(await fs.readdir(storage), []);
});
