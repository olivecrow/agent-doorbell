import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { getAgentInstructions } from "./commands/agent-instructions.js";
import {
  InvalidSpeechOptionsError,
  normalizeSpeechOptions,
} from "./speech/options.js";
import {
  deliverNotification,
  inspectEnvironment,
  playNotificationSound,
} from "./runtime.js";

const speechSchema = z.strictObject({
  voice: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .optional()
    .describe(
      "Optional voice for this call only; use the selected provider's catalog.",
    ),
  instructions: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .optional()
    .describe(
      "OpenAI only. Brief delivery directions derived from your current personality.",
    ),
  speed: z
    .number()
    .min(0.25)
    .max(4)
    .optional()
    .describe("OpenAI only. Optional speech speed."),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .optional()
    .describe(
      "Gemini only. Brief delivery prompt; the message is appended as Transcript.",
    ),
});
const emptySchema = z.strictObject({});
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

function result(value: object, failed = false): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    isError: failed,
  };
}

export interface DoorbellTools {
  instructions: typeof getAgentInstructions;
  notify: typeof deliverNotification;
  ring: typeof playNotificationSound;
  doctor: typeof inspectEnvironment;
}

export function createDoorbellServer(
  tools: DoorbellTools = {
    instructions: getAgentInstructions,
    notify: deliverNotification,
    ring: playNotificationSound,
    doctor: inspectEnvironment,
  },
) {
  const server = new McpServer(
    { name: "doorbell", version: "1.0.0" },
    {
      instructions:
        "Doorbell requests human attention with local audio. Read get_instructions before notify. Use the user's current conversational language unless they explicitly requested or configured another spoken language. Derive per-call delivery directions from your current personality. Always deliver the same request in conversation, even if audio fails. Never include full conversations or private instructions.",
    },
  );
  server.registerTool(
    "get_instructions",
    {
      description:
        "Read current non-secret speech settings, voice catalogs, and official TTS/prompting manuals. Does not read keys or play audio.",
      inputSchema: emptySchema,
      annotations: readOnly,
    },
    async () => {
      const value = await tools.instructions();
      return result(value, !value.ok);
    },
  );
  server.registerTool(
    "notify",
    {
      description:
        "Speak a short final notification sentence in the user's conversational language unless they explicitly requested or configured another spoken language, falling back to the bundled sound if speech fails. Read get_instructions first. Send current personality as brief speech.instructions (OpenAI) or speech.prompt (Gemini), never a full system prompt. One paid request at most. Always keep your text request visible in the conversation.",
      inputSchema: z.strictObject({
        message: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .describe("Only the final sentence the user should hear."),
        source: z
          .string()
          .max(200)
          .optional()
          .describe(
            "Optional local caller/session identifier; never sent to the speech provider.",
          ),
        speech: speechSchema.optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input, context) => {
      try {
        const value = await tools.notify(
          {
            message: input.message,
            ...(input.source === undefined ? {} : { source: input.source }),
            speech: normalizeSpeechOptions(input.speech),
          },
          context.mcpReq.signal,
        );
        return result(
          { ...value, textRequestRequired: true },
          !value.delivery.ok,
        );
      } catch (error) {
        return result(
          {
            error: context.mcpReq.signal.aborted
              ? "Notification cancelled."
              : error instanceof InvalidSpeechOptionsError
                ? error.message
                : "Notification failed. Check doorbell doctor.",
            textRequestRequired: true,
          },
          true,
        );
      }
    },
  );
  server.registerTool(
    "ring",
    {
      description:
        "Play the bundled offline notification sound without speech or any cloud API call. Keep your text request visible in conversation.",
      inputSchema: emptySchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (_input, context) => {
      try {
        const value = await tools.ring(context.mcpReq.signal);
        return result(value, !value.ok);
      } catch {
        return result(
          {
            error: "Sound notification failed. Keep your text request visible.",
          },
          true,
        );
      }
    },
  );
  server.registerTool(
    "doctor",
    {
      description:
        "Silently inspect local runtime, settings, player, and credential availability. Returns statuses only, with no API call, key value, playback, or settings write.",
      inputSchema: emptySchema,
      annotations: readOnly,
    },
    async (_input, context) => {
      try {
        const value = await tools.doctor(context.mcpReq.signal);
        return result(value, !value.ok);
      } catch {
        return result({ error: "Diagnosis failed or was cancelled." }, true);
      }
    },
  );
  return server;
}
