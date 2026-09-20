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
try {
  await mkdir(cwd);
  const listing = (await execa("tar", ["-tzf", archive])).stdout
    .split(/\r?\n/)
    .map((path) => path.replace(/^package\//, ""));
  assert.ok(listing.includes("dist/mcp.js"));
  assert.ok(listing.includes("docs/agent-integration.md"));
  assert.ok(listing.includes("assets/notification.mp3"));
  assert.ok(listing.includes("assets/LICENSE.md"));
  assert.ok(listing.includes("plugins/doorbell/.mcp.json"));
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
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      archive,
    ],
    { timeout: 120_000, windowsHide: true },
  );
  const installed = join(root, "node_modules", "agent-doorbell");
  const manifest = JSON.parse(
    await readFile(join(installed, "package.json"), "utf8"),
  );
  assert.equal(manifest.engines.node, ">=24");
  assert.equal(manifest.dependencies["play-sound"], undefined);
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
  assert.equal(instructions.configuration.enabled, false);
  assert.equal(instructions.configuration.playbackVolume, 1);
  assert.equal(instructions.cli.args[0], cli);
  await assert.rejects(access(join(root, "config", "speech.json")));
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
  console.log(
    JSON.stringify({
      ok: true,
      files: listing.length,
      sha256: createHash("sha256")
        .update(await readFile(archive))
        .digest("hex"),
      checks: [
        "clean production install",
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
  await rm(root, { recursive: true, force: true, maxRetries: 2 });
}
