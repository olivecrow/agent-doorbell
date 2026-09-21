import { access, readFile, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, dirname, isAbsolute, join, normalize } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { execa } from "execa";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { VERSION } from "../version.js";

export type SetupHost = "codex" | "claude";
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const pathIdentity = (value: string) => process.platform === "win32" ? normalize(value).toLowerCase() : normalize(value);
const samePath = (a: unknown, b: string) => typeof a === "string" && isAbsolute(a) && pathIdentity(a) === pathIdentity(b);
const isDoorbell = (name: string, value: unknown) => /doorbell/i.test(name) ||
  /(?:agent-doorbell|doorbell-mcp|\.agent-doorbell)/i.test(JSON.stringify(value));

async function readOptional(path: string): Promise<string> {
  try { return await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw new Error("Could not read host configuration; nothing was changed."); }
}

export async function readHostState(host: SetupHost) {
  const hostRoot = host === "codex"
    ? process.env.CODEX_HOME ?? join(homedir(), ".codex")
    : process.env.CLAUDE_CONFIG_DIR ?? homedir();
  if (!isAbsolute(hostRoot)) throw new Error("Host configuration directory must be absolute.");
  const path = join(hostRoot, host === "codex" ? "config.toml" : ".claude.json");
  const raw = await readOptional(path);
  try {
    const config = object(raw ? host === "codex" ? parse(raw) : JSON.parse(raw) : {});
    const settingsPath = host === "claude" ? join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "settings.json") : undefined;
    const settingsRaw = settingsPath ? await readOptional(settingsPath) : "";
    const settings = object(settingsRaw ? JSON.parse(settingsRaw) : {});
    const plugins = host === "codex" ? object(config.plugins) : object(settings.enabledPlugins);
    const plugin = Object.entries(plugins).some(([name, value]) => isDoorbell(name, {}) &&
      (host === "codex" ? object(value).enabled !== false : value === true));
    return { path, fingerprint: raw + "\0" + settingsRaw, servers: object(config[host === "codex" ? "mcp_servers" : "mcpServers"]), plugin };
  } catch { throw new Error("Invalid host configuration; nothing was changed."); }
}

export function planSetup(state: Awaited<ReturnType<typeof readHostState>>, command: string, server: string, remove = false) {
  const existing = object(state.servers.doorbell);
  const matches = samePath(existing.command, command) && Array.isArray(existing.args) && existing.args.length === 1 && samePath(existing.args[0], server)
    && Object.keys(object(existing.env)).length === 0 && (!Array.isArray(existing.env_vars) || existing.env_vars.length === 0)
    && existing.enabled !== false && (existing.type === undefined || existing.type === "stdio") && existing.url === undefined;
  if (remove) {
    if (!Object.hasOwn(state.servers, "doorbell")) return "absent";
    if (!matches) throw new Error("Existing doorbell registration belongs to another configuration. Remove it with the host CLI after reviewing it.");
    return "remove";
  }
  if (state.plugin) throw new Error("A Doorbell plugin is enabled. Use that connection or disable it before direct MCP setup.");
  if (Object.entries(state.servers).some(([name, value]) => name !== "doorbell" && isDoorbell(name, value)))
    throw new Error("Another Doorbell MCP registration exists. Review it before adding a duplicate.");
  if (Object.hasOwn(state.servers, "doorbell")) {
    if (!matches) throw new Error("Existing doorbell registration differs. Nothing was overwritten; review or remove it with the host CLI first.");
    return "unchanged";
  }
  return "install";
}

/** Find native executables or known npm entrypoints, never execute a Windows shell shim. */
export async function resolveHostCli(host: SetupHost): Promise<{ command: string; args: string[] }> {
  const cwd = pathIdentity(await realpath(process.cwd()));
  const key = Object.keys(process.env).find((key) => process.platform === "win32" ? key.toUpperCase() === "PATH" : key === "PATH");
  for (const entry of (key ? process.env[key] ?? "" : "").split(delimiter)) {
    const directory = entry.trim().replace(/^"(.*)"$/, "$1");
    if (!isAbsolute(directory)) continue;
    try {
      const canonical = await realpath(directory);
      if (pathIdentity(canonical) === cwd) continue;
      const candidates = process.platform === "win32"
        ? [join(canonical, `${host}.exe`), join(canonical, "node_modules", host === "codex" ? "@openai/codex/bin/codex.js" : "@anthropic-ai/claude-code/cli.js")]
        : [join(canonical, host)];
      for (const candidate of candidates) {
        try {
          const path = await realpath(candidate);
          if (pathIdentity(dirname(path)) === cwd || !(await stat(path)).isFile()) continue;
          await access(path, path.endsWith(".js") ? constants.R_OK : constants.X_OK);
          return path.endsWith(".js") ? { command: process.execPath, args: [path] } : { command: path, args: [] };
        } catch { /* Try the next explicit installation. */ }
      }
    } catch { /* Ignore invalid PATH directories. */ }
  }
  throw new Error(`${host} CLI was not found in an absolute PATH directory. Install the host CLI before setup.`);
}

export async function verifyMcp(command: string, server: string, signal?: AbortSignal) {
  const client = new Client({ name: "doorbell-setup", version: VERSION });
  const transport = new StdioClientTransport({ command, args: [server], stderr: "pipe" });
  const operation = AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]);
  let stop: (() => void) | undefined;
  try {
    operation.throwIfAborted();
    await Promise.race([
      (async () => {
        await client.connect(transport);
        const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
        if (JSON.stringify(names) !== JSON.stringify(["doctor", "get_instructions", "notify", "ring"])) throw new Error();
      })(),
      new Promise<never>((_, reject) => {
        stop = () => { void transport.close(); reject(new Error("MCP verification cancelled or timed out.")); };
        operation.addEventListener("abort", stop, { once: true });
        if (operation.aborted) stop();
      }),
    ]);
  } catch { throw new Error("Doorbell MCP startup/tool discovery failed. Host configuration was not changed by verification."); }
  finally {
    if (stop) operation.removeEventListener("abort", stop);
    await client.close();
    await transport.close();
  }
}

export async function setupHost(host: SetupHost, options: { preview: boolean; remove: boolean }, signal?: AbortSignal) {
  const command = process.execPath;
  const server = fileURLToPath(new URL("../mcp.js", import.meta.url));
  const state = await readHostState(host);
  const action = planSetup(state, command, server, options.remove);
  const report = { host, scope: "user", action, command, args: [server], configuration: state.path };
  if (options.preview || action === "absent") return { ...report, applied: false, verified: false };
  const cli = await resolveHostCli(host);
  if (action !== "remove") await verifyMcp(command, server, signal);
  signal?.throwIfAborted();
  if ((await readHostState(host)).fingerprint !== state.fingerprint)
    throw new Error("Host configuration changed during setup; retry after reviewing it.");
  if (action === "install" || action === "remove") {
    const args = action === "remove"
      ? ["mcp", "remove", ...(host === "claude" ? ["--scope", "user"] : []), "doorbell"]
      : ["mcp", "add", ...(host === "claude" ? ["--transport", "stdio", "--scope", "user"] : []), "doorbell", "--", command, server];
    try {
      await execa(cli.command, [...cli.args, ...args], { cwd: homedir(), shell: false, windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024, ...(signal ? { cancelSignal: signal } : {}) });
    } catch { throw new Error("Host CLI setup failed or was cancelled. Inspect the host registration before retrying; no automatic retry was made."); }
  }
  const after = await readHostState(host);
  if (planSetup(after, command, server, options.remove) !== (options.remove ? "absent" : "unchanged"))
    throw new Error("Host registration could not be verified. Inspect the host configuration.");
  for (const [name, value] of Object.entries(state.servers)) {
    if (name !== "doorbell" && JSON.stringify(after.servers[name]) !== JSON.stringify(value))
      throw new Error("An unrelated MCP registration changed during setup; inspect the host configuration.");
  }
  return { ...report, applied: action !== "unchanged", verified: true, next: options.remove ? "Host registration removed; speech settings and credentials are preserved." : "Restart or reconnect the host and call get_instructions. MCP startup and tools were verified; no sound was played and speech was not enabled." };
}
