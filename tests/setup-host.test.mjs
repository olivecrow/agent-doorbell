import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { planSetup, readHostState, setupHost, verifyMcp } from "../dist/commands/setup-host.js";

const command = process.execPath;
const server = resolve("dist/mcp.js");
const entry = { command, args: [server], env: {} };
const state = (servers = {}, plugin = false) => ({ servers, plugin, path: "fixture", fingerprint: "" });

test("setup is idempotent and refuses different or duplicate registrations and enabled plugins", () => {
  assert.equal(planSetup(state(), command, server), "install");
  assert.equal(planSetup(state({ doorbell: entry }), command, server), "unchanged");
  assert.equal(planSetup(state({ doorbell: entry }), command, server, true), "remove");
  assert.equal(planSetup(state(), command, server, true), "absent");
  for (const value of [
    { ...entry, args: [resolve("other/mcp.js")] },
    { ...entry, env: { DOORBELL_CONFIG_DIR: "elsewhere" } },
    { ...entry, enabled: false },
    { type: "http", url: "https://example.invalid" },
  ]) {
    assert.throws(() => planSetup(state({ doorbell: value }), command, server), /differs/);
    assert.throws(() => planSetup(state({ doorbell: value }), command, server, true), /another configuration/);
  }
  assert.throws(() => planSetup(state({ alternative: { command: "doorbell-mcp" } }), command, server), /duplicate/);
  assert.throws(() => planSetup(state({}, true), command, server), /plugin is enabled/);
});

test("preview preserves host bytes and rejects malformed settings without revealing contents", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "doorbell-host-"));
  const previousCodex = process.env.CODEX_HOME;
  const previousClaude = process.env.CLAUDE_CONFIG_DIR;
  t.after(async () => {
    if (previousCodex === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousCodex;
    if (previousClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previousClaude;
    await rm(root, { recursive: true, force: true });
  });
  process.env.CODEX_HOME = join(root, "codex");
  process.env.CLAUDE_CONFIG_DIR = join(root, "claude");
  await mkdir(process.env.CODEX_HOME);
  await mkdir(process.env.CLAUDE_CONFIG_DIR);
  const codexFile = join(process.env.CODEX_HOME, "config.toml");
  const claudeFile = join(process.env.CLAUDE_CONFIG_DIR, ".claude.json");
  const toml = '# preserve formatting\nmodel = "fixture"\n[mcp_servers.other]\ncommand = "other"\n';
  const json = '{ "unrelated": true, "mcpServers": {"other":{"command":"other"}} }';
  await writeFile(codexFile, toml);
  await writeFile(claudeFile, json);
  for (const host of ["codex", "claude"]) {
    const result = await setupHost(host, { preview: true, remove: false });
    assert.equal(result.action, "install");
    assert.equal(result.applied, false);
    assert.equal(result.verified, false);
  }
  assert.equal(await readFile(codexFile, "utf8"), toml);
  assert.equal(await readFile(claudeFile, "utf8"), json);
  await writeFile(codexFile, '[plugins."doorbell@personal"]\nenabled = true\n');
  await assert.rejects(setupHost("codex", { preview: true, remove: false }), /plugin is enabled/);
  await writeFile(join(process.env.CLAUDE_CONFIG_DIR, "settings.json"), '{"enabledPlugins":{"doorbell@example":true}}');
  await assert.rejects(setupHost("claude", { preview: true, remove: false }), /plugin is enabled/);
  await writeFile(codexFile, 'secret = [INVALID-SECRET');
  await assert.rejects(readHostState("codex"), (error) => /Invalid host configuration/.test(error.message) && !error.message.includes("SECRET"));
});

test("setup verifies actual MCP tool discovery without credentials or playback and honors cancellation", async () => {
  await verifyMcp(command, server);
  await assert.rejects(verifyMcp(command, server, AbortSignal.abort()), /failed/);
});
