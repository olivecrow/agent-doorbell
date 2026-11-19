// Real host CLIs with isolated settings. No model requests, keys, or physical audio.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { execa } from "execa";
import { parse, stringify } from "smol-toml";
import { resolveHostCli } from "../dist/commands/setup-host.js";

async function codexTools(cli, env, cwd) {
  const child = spawn(cli.command, [...cli.args, "app-server", "--stdio"], { env, cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 0;
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (pending.has(message.id)) {
        const { resolve, reject, timer } = pending.get(message.id);
        pending.delete(message.id); clearTimeout(timer);
        message.error ? reject(new Error("Codex app-server rejected verification request.")) : resolve(message.result);
      }
    } catch { /* Ignore non-protocol diagnostic lines. */ }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Codex ${method} timed out.`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
  const closed = new Promise((resolve) => child.once("close", resolve));
  try {
    await request("initialize", { clientInfo: { name: "doorbell-release-check", version: "1.1.0" }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    const response = await request("mcpServerStatus/list", { limit: 100 });
    const server = response.data.find((entry) => entry.name === "doorbell");
    assert.ok(server, "Codex must discover the configured server");
    assert.deepEqual(Object.values(server.tools).map((tool) => tool.name).sort(), ["doctor", "get_instructions", "notify", "ring"]);
    return { tools: 4, serverVersion: server.serverInfo?.version };
  } finally {
    for (const { timer } of pending.values()) clearTimeout(timer);
    child.stdin.end();
    const kill = setTimeout(() => child.kill(), 3000);
    await closed; clearTimeout(kill); lines.close();
  }
}

export async function verifyHosts(installed) {
  const root = await mkdtemp(join(tmpdir(), "doorbell host 한글 "));
  const env = { ...process.env, CODEX_HOME: join(root, "codex"), CLAUDE_CONFIG_DIR: join(root, "claude"), DOORBELL_CONFIG_DIR: join(root, "speech"), DOORBELL_QUEUE_DIR: join(root, "queue"), SDL_AUDIODRIVER: "dummy" };
  const run = (args) => execa(process.execPath, [join(installed, "dist/cli.js"), ...args], { env, cwd: root, timeout: 45000, windowsHide: true });
  try {
    await mkdir(env.CODEX_HOME); await mkdir(env.CLAUDE_CONFIG_DIR);
    const other = { command: process.execPath, args: ["-e", "process.exit(0)"] };
    const codexConfig = join(env.CODEX_HOME, "config.toml");
    const claudeConfig = join(env.CLAUDE_CONFIG_DIR, ".claude.json");
    await writeFile(codexConfig, stringify({ model: "fixture-preserve", mcp_servers: { unrelated: { ...other, enabled: false } } }));
    await writeFile(claudeConfig, JSON.stringify({ fixturePreserve: true, mcpServers: { unrelated: other } }));
    const receipts = [];
    for (const host of ["codex", "claude"]) {
      const hostCli = await resolveHostCli(host);
      const preview = JSON.parse((await run(["setup", host, "--preview"])).stdout);
      assert.equal(preview.action, "install");
      assert.equal(preview.applied, false);
      assert.equal(JSON.parse((await run(["setup", host])).stdout).verified, true);
      assert.equal(JSON.parse((await run(["setup", host])).stdout).action, "unchanged");
      const result = await execa(hostCli.command, [...hostCli.args, "mcp", "get", "doorbell", ...(host === "codex" ? ["--json"] : [])], { env, cwd: root, timeout: 30000, windowsHide: true });
      let hostEvidence;
      if (host === "codex") {
        assert.equal(JSON.parse(result.stdout).transport.args[0], join(installed, "dist/mcp.js"));
        hostEvidence = await codexTools(hostCli, env, root);
        const config = parse(await readFile(codexConfig, "utf8"));
        assert.equal(config.model, "fixture-preserve");
        // TOML tables can have a null prototype. Compare all registration fields.
        assert.deepEqual({ ...config.mcp_servers.unrelated }, { ...other, enabled: false });
      } else {
        assert.match(result.stdout, /Connected/);
        const config = JSON.parse(await readFile(claudeConfig, "utf8"));
        assert.equal(config.fixturePreserve, true);
        assert.deepEqual(config.mcpServers.unrelated, other);
        hostEvidence = { connected: true };
      }
      assert.equal(JSON.parse((await run(["setup", host, "--remove"])).stdout).action, "remove");
      assert.equal(JSON.parse((await run(["setup", host, "--remove"])).stdout).action, "absent");
      const version = (await execa(hostCli.command, [...hostCli.args, "--version"], { env, cwd: root })).stdout;
      receipts.push({ host, version, ...hostEvidence, lifecycle: "preview, install, idempotent setup, native connection, remove, repeated remove" });
    }
    console.log(JSON.stringify({ hostVerification: receipts }));
    return receipts;
  } finally {
    assert.equal(resolve(root).startsWith(resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/")), true);
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await verifyHosts(resolve(process.argv[2] ?? "."));
