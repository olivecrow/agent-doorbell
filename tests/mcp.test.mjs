import assert from "node:assert/strict";
import "./fixtures/speech-temp.mjs";
import { test } from "node:test";
import { mkdtemp, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createDoorbellServer } from "../dist/mcp-server.js";

test("installed-style MCP stdio starts outside the repository, advertises tools and reads instructions without credentials or playback", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "doorbell MCP 한글 "));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/mcp.js", import.meta.url))],
    cwd: directory,
    env: {
      ...process.env,
      DOORBELL_CONFIG_DIR: directory,
      DOORBELL_QUEUE_DIR: join(directory, "queue"),
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "doorbell-test", version: "1" });
  t.after(async () => {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  });
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    "doctor",
    "get_instructions",
    "notify",
    "ring",
  ]);
  const instructions = await client.callTool({
    name: "get_instructions",
    arguments: {},
  });
  const value = JSON.parse(instructions.content[0].text);
  assert.equal(value.configuration.provider, "openai");
  assert.equal(value.configuration.defaultVoice, "nova");
  assert.match(value.instructions, /https:\/\/ai.google.dev/);
  assert.equal(value.configuration.enabled, false);
  const invalid = await client.callTool({
    name: "notify",
    arguments: { message: "Review.", apiKey: "private-value" },
  });
  assert.equal(invalid.isError, true);
  assert.doesNotMatch(JSON.stringify(invalid), /private-value/);
  await assert.rejects(access(join(directory, "speech.json")));
  await assert.rejects(access(join(directory, "queue")));
});

test("MCP retains delivery status and forwards per-request cancellation with no configuration authority", async (t) => {
  let calls = 0;
  let seen;
  const server = createDoorbellServer({
    instructions: async () => ({ ok: true }),
    doctor: async () => ({ ok: true }),
    ring: async () => ({ ok: true }),
    notify: async (request, signal) => {
      calls++;
      seen = request;
      if (request.message === "Wait.")
        await new Promise((resolve) =>
          signal.addEventListener("abort", resolve, { once: true }),
        );
      return {
        delivery: signal.aborted
          ? { ok: false, cancelled: true, attempts: [] }
          : {
              ok: true,
              mode: "sound",
              attempts: [
                {
                  mode: "speech",
                  ok: false,
                  handler: "fake",
                  reason: "Quota unavailable.",
                },
                { mode: "sound", ok: true, handler: "fake" },
              ],
            },
        warnings: [],
      };
    },
  });
  const client = new Client({ name: "doorbell-boundary-test", version: "1" });
  const [serverTransport, clientTransport] =
    InMemoryTransport.createLinkedPair();
  t.after(() => Promise.all([client.close(), server.close()]));
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const success = await client.callTool({
    name: "notify",
    arguments: {
      message: "Review.",
      speech: { instructions: "Calm.", voice: "nova" },
    },
  });
  const value = JSON.parse(success.content[0].text);
  assert.equal(value.delivery.mode, "sound");
  assert.equal(value.textRequestRequired, true);
  assert.equal(success.isError, false);
  assert.deepEqual(seen.speech, { instructions: "Calm.", voice: "nova" });
  for (const args of [
    { message: "x".repeat(121) },
    { message: "Review.", speech: { provider: "gemini" } },
  ]) {
    assert.equal(
      (await client.callTool({ name: "notify", arguments: args })).isError,
      true,
    );
  }
  assert.equal(calls, 1);
  const controller = new AbortController();
  const pending = client.callTool(
    { name: "notify", arguments: { message: "Wait." } },
    { signal: controller.signal },
  );
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(pending);
  assert.equal(calls, 2);
});
