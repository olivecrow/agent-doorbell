import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { zipSync } from "fflate";
import { extractPlayer, installPlayer } from "../player/install.mjs";

const hash = (data) => createHash("sha256").update(data).digest("hex");
const content = Buffer.from("inert executable fixture");
const license = Buffer.from("fixture license");
const archive = zipSync({ "build/bin/ffplay.exe": content, "build/LICENSE": license, "../escape": content });
const build = {
  url: "https://example.invalid/player.zip", directory: "test-build", executable: "ffplay.exe",
  archiveBytes: archive.length, sha256: hash(archive),
  files: {
    "ffplay.exe": { entry: "build/bin/ffplay.exe", sha256: hash(content) },
    LICENSE: { entry: "build/LICENSE", sha256: hash(license) },
  },
};

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "doorbell-player-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, options: { destinationRoot: join(root, "bin"), platform: "win32", arch: "x64", builds: { "win32-x64": build }, fetchArchive: async () => new Response(archive) } };
}

test("installer verifies hashes, retains license, excludes other ZIP paths and reuses installation offline", async (t) => {
  const { options } = await fixture(t);
  assert.deepEqual(await installPlayer(options), { installed: true, reused: false });
  const destination = join(options.destinationRoot, build.directory);
  assert.deepEqual((await readdir(destination)).sort(), ["LICENSE", "ffplay.exe"]);
  assert.deepEqual(await readFile(join(destination, "ffplay.exe")), content);
  assert.deepEqual(await installPlayer({ ...options, fetchArchive: () => { throw new Error("Network must not run"); } }), { installed: true, reused: true });
  await writeFile(join(destination, "ffplay.exe"), "changed");
  await assert.rejects(installPlayer(options), /changed/);
});

test("installer rejects corrupt archives and files before writing an executable", async (t) => {
  const { options } = await fixture(t);
  assert.throws(() => extractPlayer(archive, { ...build, sha256: "0".repeat(64) }), /checksum/);
  assert.throws(() => extractPlayer(archive, { ...build, files: { "ffplay.exe": { entry: "missing", sha256: hash(content) } } }), /missing/);
  await assert.rejects(installPlayer({ ...options, fetchArchive: async () => new Response(new Uint8Array(archive.length + 1)) }), /expected size/);
  assert.deepEqual(await readdir(options.destinationRoot), []);
});

test("installer handles unsupported platforms, HTTP failure, and cancellation without retry", async (t) => {
  const { options } = await fixture(t);
  let calls = 0;
  const fetchArchive = async () => { calls++; return new Response(null, { status: 503 }); };
  assert.equal((await installPlayer({ ...options, platform: "unsupported", fetchArchive })).installed, false);
  assert.equal(calls, 0);
  await assert.rejects(installPlayer({ ...options, fetchArchive }), /download/);
  assert.equal(calls, 1);
  await assert.rejects(installPlayer({ ...options, fetchArchive, signal: AbortSignal.abort() }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("installer rejects linked destination roots without writing through them", async (t) => {
  const { root, options } = await fixture(t);
  const alias = join(root, "alias");
  await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(installPlayer({ ...options, destinationRoot: alias }), /must not be a link/);
  assert.deepEqual(await readdir(root), ["alias"]);
});

test("runtime selects package-owned player without PATH and rejects redirected managed files", async (t) => {
  const { root } = await fixture(t);
  const moduleDir = join(root, "dist", "audio");
  const playerDir = join(root, "player");
  const binaryDir = join(playerDir, "bin", "fixture");
  await mkdir(moduleDir, { recursive: true });
  await mkdir(binaryDir, { recursive: true });
  await writeFile(join(root, "package.json"), '{"type":"module"}');
  await copyFile(new URL("../dist/audio/ffplay-executable.js", import.meta.url), join(moduleDir, "ffplay-executable.js"));
  await writeFile(join(playerDir, "manifest.json"), JSON.stringify({ [`${process.platform}-${process.arch}`]: { directory: "fixture", executable: "ffplay" } }));
  const executable = join(binaryDir, "ffplay");
  await writeFile(executable, content, { mode: 0o755 });
  const key = Object.keys(process.env).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
  const previous = process.env[key];
  t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  process.env[key] = "";
  const { resolveFfplayExecutable } = await import(pathToFileURL(join(moduleDir, "ffplay-executable.js")).href);
  assert.equal(await resolveFfplayExecutable(), await realpath(executable));
  await rm(executable);
  await assert.rejects(resolveFfplayExecutable(), /absolute PATH directory/);
  // Directory junctions work without Windows developer-mode symlink privileges.
  await symlink(root, executable, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(resolveFfplayExecutable(), /Managed ffplay is unavailable/);
});
