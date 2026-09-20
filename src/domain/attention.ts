import type { SpeechOptions } from "../speech/options.js";

export const MAX_ATTENTION_MESSAGE_LENGTH = 120;

export interface AttentionRequest {
  message: string;
  source?: string;
  /** Agent-authored performance controls for this request only. */
  speech?: SpeechOptions;
}

export function normalizeAttentionMessage(message: string): string {
  const normalizedMessage = message.trim();

  if (normalizedMessage.length === 0) {
    throw new Error("message must not be empty");
  }

  if (normalizedMessage.length > MAX_ATTENTION_MESSAGE_LENGTH) {
    throw new Error("message is too long");
  }

  return normalizedMessage;
}
