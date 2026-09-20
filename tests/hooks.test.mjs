import assert from "node:assert/strict";
import "./fixtures/speech-temp.mjs";
import { test } from "node:test";
import { Readable } from "node:stream";
import { parseHook, readHookInput } from "../dist/commands/hook.js";

test("native Codex input becomes a short request without forwarding its conversation", () => {
  const request = parseHook(
    "codex",
    JSON.stringify({
      type: "agent-turn-complete",
      "thread-id": "task-1",
      "input-messages": ["private-user-message"],
      "last-assistant-message": "private-long-answer".repeat(100),
      cwd: "private-directory",
    }),
  );
  assert.match(request.message, /Codex has finished/);
  assert.equal(request.source, "codex:task-1");
  assert.doesNotMatch(JSON.stringify(request), /private-/);
  assert.equal(parseHook("codex", '{"type":"unrelated"}'), undefined);
});

test("Claude Notification accepts a short message and ignores transcript paths", () => {
  const request = parseHook(
    "claude",
    JSON.stringify({
      hook_event_name: "Notification",
      notification_type: "permission_prompt",
      session_id: "task-2",
      message: "Please approve the preview.",
      transcript_path: "private-transcript",
    }),
  );
  assert.equal(request.message, "Please approve the preview.");
  assert.equal(request.source, "claude:task-2");
  assert.doesNotMatch(JSON.stringify(request), /private-transcript/);
  assert.equal(parseHook("claude", '{"hook_event_name":"Stop"}'), undefined);
  const long = parseHook(
    "claude",
    JSON.stringify({
      hook_event_name: "Notification",
      notification_type: "idle_prompt",
      message: "private-long-message".repeat(100),
    }),
  );
  assert.match(long.message, /Claude needs your attention/);
});

test("bounded custom hook requests accept per-call speech but reject settings and credentials", () => {
  const base = { type: "agent-turn-complete" };
  const speech = { prompt: "Gentle and clear.", voice: "Kore" };
  assert.deepEqual(
    parseHook(
      "codex",
      JSON.stringify({ ...base, doorbell: { message: "Review.", speech } }),
    ).speech,
    speech,
  );
  for (const patch of [
    { provider: "gemini" },
    { apiKey: "private-key" },
    { voice: "nova" },
    { doorbell: { provider: "openai" } },
    { doorbell: { message: "x".repeat(121) } },
    { doorbell: { speech: { speed: 5 } } },
  ])
    assert.throws(
      () => parseHook("codex", JSON.stringify({ ...base, ...patch })),
      (error) => !error.message.includes("private-key"),
    );
  for (const input of ["{", "null", "[]", "{}", " ".repeat(65537)])
    assert.throws(() => parseHook("codex", input));
});

test("stdin handles chunked Unicode JSON, rejects oversized input and supports cancellation", async () => {
  const text = '{"message":"안녕하세요"}';
  const bytes = Buffer.from(text);
  assert.equal(
    await readHookInput(
      Readable.from([bytes.subarray(0, 16), bytes.subarray(16)]),
    ),
    text,
  );
  await assert.rejects(
    readHookInput(Readable.from([Buffer.alloc(65537)])),
    /exceeds/,
  );
  const controller = new AbortController();
  const input = new Readable({ read() {} });
  const result = readHookInput(input, controller.signal);
  const rejection = assert.rejects(result, /cancelled/);
  controller.abort();
  await rejection;
});
