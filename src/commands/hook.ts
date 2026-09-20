import { Readable } from "node:stream";
import {
  normalizeAttentionMessage,
  type AttentionRequest,
} from "../domain/attention.js";
import { normalizeSpeechOptions } from "../speech/options.js";

export const MAX_HOOK_BYTES = 65_536;
export type HookAgent = "codex" | "claude";
export class InvalidHookError extends Error {}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Metadata is ignored, never read from transcript paths or forwarded to synthesis. */
export function parseHook(
  agent: HookAgent,
  input: string,
): AttentionRequest | undefined {
  if (Buffer.byteLength(input, "utf8") > MAX_HOOK_BYTES)
    throw new InvalidHookError("Hook input exceeds 65536 bytes.");
  let payload: unknown;
  try {
    payload = JSON.parse(input);
  } catch {
    throw new InvalidHookError("Hook input must be valid JSON.");
  }
  if (!record(payload))
    throw new InvalidHookError("Hook input must be an object.");
  const event = agent === "codex" ? payload.type : payload.hook_event_name;
  if (typeof event !== "string")
    throw new InvalidHookError("Hook event name is required.");
  if (event !== (agent === "codex" ? "agent-turn-complete" : "Notification"))
    return undefined;
  for (const key of [
    "provider",
    "model",
    "voice",
    "playbackMode",
    "enabled",
    "apiKey",
    "api_key",
    "credentials",
    "speech",
    "instructions",
    "speed",
    "prompt",
  ])
    if (Object.hasOwn(payload, key))
      throw new InvalidHookError(
        "Hook payload cannot override Doorbell settings. Use doorbell.speech for per-call controls.",
      );
  let message =
    agent === "codex"
      ? "Codex has finished this turn. Please review the result."
      : "Claude needs your attention. Please check the conversation.";
  if (agent === "claude") {
    if (typeof payload.message !== "string")
      throw new InvalidHookError("Claude Notification requires a message.");
    if (typeof payload.notification_type !== "string")
      throw new InvalidHookError(
        "Claude Notification requires notification_type.",
      );
    try {
      message = normalizeAttentionMessage(payload.message);
    } catch {
      /* Use a short generic notification, never truncate conversation content. */
    }
  }
  const custom = payload.doorbell;
  if (
    custom !== undefined &&
    (!record(custom) ||
      Object.keys(custom).some((key) => key !== "message" && key !== "speech"))
  )
    throw new InvalidHookError("Unsupported Doorbell hook options.");
  try {
    const options = record(custom) ? custom : {};
    if (options.message !== undefined) {
      if (typeof options.message !== "string") throw new Error();
      message = normalizeAttentionMessage(options.message);
    }
    const speech = normalizeSpeechOptions(options.speech);
    const id = agent === "codex" ? payload["thread-id"] : payload.session_id;
    return {
      message,
      source: typeof id === "string" ? `${agent}:${id.slice(0, 200)}` : agent,
      speech,
    };
  } catch {
    throw new InvalidHookError("Invalid hook message or speech options.");
  }
}

/** Bound untrusted stdin in bytes and time; never wait forever for a missing payload. */
export async function readHookInput(
  stream: Readable,
  signal?: AbortSignal,
): Promise<string> {
  const timeout = AbortSignal.timeout(5000);
  const operation = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const abort = () =>
    stream.destroy(
      new InvalidHookError("Hook input was cancelled or timed out."),
    );
  operation.addEventListener("abort", abort, { once: true });
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    operation.throwIfAborted();
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_HOOK_BYTES)
        throw new InvalidHookError("Hook input exceeds 65536 bytes.");
      chunks.push(bytes);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    operation.removeEventListener("abort", abort);
  }
}
