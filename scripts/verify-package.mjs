import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execa } from "execa";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const archive = resolve(process.argv[2] ?? "");
if (!archive.endsWith(".tgz"))
  throw new Error("Pass the generated npm tarball.");
const root = await mkdtemp(join(tmpdir(), "doorbell package 한글 "));
const cwd = join(root, "unrelated working directory");
let client;
let previousSettings;
try {
  await mkdir(cwd);
  if (process.argv.includes("--upgrade")) {
    await execa("npm", ["install", "--prefix", root, "--ignore-scripts", "--no-audit", "--no-fund", "https://github.com/olivecrow/agent-doorbell/releases/download/v1.0.0/agent-doorbell-1.0.0.tgz"], { timeout: 120000, windowsHide: true });
    await execa(process.execPath, [join(root, "node_modules/agent-doorbell/dist/cli.js"), "configure", "speech", "--volume", "1.25"], { env: { ...process.env, DOORBELL_CONFIG_DIR: join(root, "config") }, cwd, timeout: 10000 });
    previousSettings = await readFile(join(root, "config/speech.json"), "utf8");
  }
  const listing = (await execa("tar", ["-tzf", archive])).stdout
    .split(/\r?\n/)
    .map((path) => path.replace(/^package\//, ""));
  assert.ok(listing.includes("dist/mcp.js"));
  assert.ok(listing.includes("docs/agent-integration.md"));
  assert.ok(listing.includes("assets/notification.mp3"));
  assert.ok(listing.includes("assets/LICENSE.md"));
  assert.ok(listing.includes("plugins/doorbell/.mcp.json"));
  assert.ok(listing.includes("player/install.mjs"));
  assert.ok(listing.includes("player/manifest.json"));
  assert.equal(listing.some((path) => path.startsWith("player/bin/")), false);
  assert.equal(
    listing.some(
      (path) =>
        /^(src|tests|scripts|\.doorbell-dev|node_modules|\.vscode)\//.test(
          path,
        ) || path.endsWith(".map"),
    ),
    false,
  );
  await execa(
    "npm",
    [
      "install",
      "--prefix",
      root,
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      archive,
    ],
    { timeout: 240_000, windowsHide: true },
  );
  const installed = join(root, "node_modules", "agent-doorbell");
  const manifest = JSON.parse(
    await readFile(join(installed, "package.json"), "utf8"),
  );
  assert.equal(manifest.engines.node, ">=24");
  assert.equal(manifest.dependencies["play-sound"], undefined);
  assert.equal((await execa(process.execPath, [join(installed, "dist/cli.js"), "--version"])).stdout, manifest.version);
  if (previousSettings !== undefined) assert.equal(await readFile(join(root, "config/speech.json"), "utf8"), previousSettings);
  for (const path of listing) {
    if (!/\.(js|json|md|yaml|ts)$/.test(path)) continue;
    const content = await readFile(join(installed, path), "utf8");
    assert.doesNotMatch(
      content,
      /sk-(?:proj-)?[A-Za-z0-9_-]{32,}|AIza[\w-]{30,}/,
      `Credential-like content in ${path}`,
    );
  }
  const env = {
    ...process.env,
    DOORBELL_CONFIG_DIR: join(root, "config"),
    DOORBELL_QUEUE_DIR: join(root, "queue"),
    DOORBELL_SPEECH_TEMP_DIR: join(root, "speech"),
  };
  const cli = join(installed, "dist", "cli.js");
  if (process.platform === "win32" && process.arch === "x64") {
    const probe = await execa(process.execPath, ["--input-type=module", "-e", `
      import { pathToFileURL } from 'node:url';
      import { join } from 'node:path';
      import { writeFile, unlink } from 'node:fs/promises';
      const root = process.env.DOORBELL_TEST_PACKAGE;
      const { resolveFfplayExecutable } = await import(pathToFileURL(join(root, 'dist/audio/ffplay-executable.js')));
      const { FfplayAudioPlayer } = await import(pathToFileURL(join(root, 'dist/audio/ffplay-player.js')));
      const { streamingAudio } = await import(pathToFileURL(join(root, 'dist/speech/pcm-stream.js')));
      const player = new FfplayAudioPlayer();
      const wav = Buffer.alloc(44 + 4800);
      wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
      wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32);
      wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(4800, 40);
      const file = join(process.cwd(), 'fixture.wav');
      await writeFile(file, wav, { flag: 'wx' });
      try {
        const mp3 = await player.play({ path: join(root, 'assets/notification.mp3'), format: 'mp3' });
        const buffered = await player.play({ path: file, format: 'wav', volume: 1.5 });
        let cancelled = false;
        const pcm = await player.playStream(streamingAudio((async function* () { yield wav.subarray(44); })(), () => { cancelled = true; }), undefined, 1.5);
        console.log(JSON.stringify({ path: await resolveFfplayExecutable(), file: await player.check(), streaming: await player.checkStreaming(), mp3, buffered, pcm, cancelled }));
      } finally { await unlink(file); }
    `], { cwd, env: { ...env, PATH: "", SDL_AUDIODRIVER: "dummy", DOORBELL_TEST_PACKAGE: installed }, timeout: 45000 });
    const player = JSON.parse(probe.stdout);
    assert.ok(player.path.startsWith(join(installed, "player", "bin")));
    assert.equal(player.file.available, true);
    assert.equal(player.streaming.available, true);
    assert.equal(player.mp3.ok, true, JSON.stringify(player.mp3));
    assert.equal(player.buffered.ok, true, JSON.stringify(player.buffered));
    assert.equal(player.pcm.ok, true, JSON.stringify(player.pcm));
    assert.equal(player.cancelled, true);
  }
  const guide = await execa(process.execPath, [cli, "agent-instructions"], {
    cwd,
    env,
    timeout: 10000,
  });
  assert.match(guide.stdout, /defaultVoice.*nova/s);
  assert.match(guide.stdout, /https:\/\/ai.google.dev/);
  assert.match(
    guide.stdout,
    /language they are using in the current conversation/,
  );
  const voices = await execa(
    process.execPath,
    [cli, "configure", "speech", "--list-voices", "--provider", "gemini"],
    { cwd, env, timeout: 10000 },
  );
  assert.equal(JSON.parse(voices.stdout).voices.length, 30);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(installed, "dist", "mcp.js")],
    cwd,
    env,
    stderr: "pipe",
  });
  client = new Client({ name: "clean-package-check", version: "1" });
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 4);
  const result = await client.callTool({
    name: "get_instructions",
    arguments: {},
  });
  const instructions = JSON.parse(result.content[0].text);
  const skill = await readFile(join(installed, "plugins/doorbell/skills/doorbell/SKILL.md"), "utf8");
  for (const guidance of [guide.stdout, instructions.instructions, skill]) {
    assert.match(guidance, /3 minutes \(180 seconds\)/);
    assert.match(guidance, /at most one Doorbell call for the same request/i);
    assert.match(guidance, /one short, actionable sentence/i);
  }
  assert.equal(instructions.configuration.enabled, false);
  assert.equal(instructions.configuration.playbackVolume, previousSettings === undefined ? 1 : 1.25);
  assert.equal(instructions.cli.args[0], cli);
  if (previousSettings === undefined) await assert.rejects(access(join(root, "config", "speech.json")));
  await execa(
    process.execPath,
    [cli, "configure", "speech", "--volume", "1.5"],
    { cwd, env, timeout: 10000 },
  );
  const updated = JSON.parse(
    (await client.callTool({ name: "get_instructions", arguments: {} }))
      .content[0].text,
  );
  assert.equal(updated.configuration.playbackVolume, 1.5);
  assert.equal(updated.configuration.enabled, false);
  if (process.argv.includes("--hosts")) {
    const { verifyHosts } = await import("./verify-host-setup.mjs");
    await verifyHosts(installed);
  }
  await client.close();
  client = undefined;
  const preservedSettings = await readFile(join(root, "config/speech.json"), "utf8");
  await execa("npm", ["uninstall", "--prefix", root, "--no-audit", "--no-fund", "agent-doorbell"], { timeout: 60000, windowsHide: true });
  await assert.rejects(access(join(installed, "package.json")));
  assert.equal(await readFile(join(root, "config/speech.json"), "utf8"), preservedSettings);
  console.log(
    JSON.stringify({
      ok: true,
      files: listing.length,
      sha256: createHash("sha256")
        .update(await readFile(archive))
        .digest("hex"),
      checks: [
        "clean production install",
        ...(previousSettings === undefined ? [] : ["v1.0.0 upgrade preserves saved speech settings"]),
        "uninstall preserves user settings",
        "managed Windows x64 player and PCM capability without PATH (when applicable)",
        "Unicode and spaced external CWD",
        "CLI instructions and Gemini voices",
        "MCP discovery",
        "conversational language guidance and local volume configuration",
        "no development files or credential-like values",
      ],
    }),
  );
} finally {
  await client?.close();
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/")));
  await rm(root, { recursive: true, force: true, maxRetries: 2 });
}
