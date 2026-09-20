import {
  SPEECH_PROVIDERS,
  isSpeechVoice,
  type SpeechProviderId,
} from "./providers/catalog.js";

export const MAX_SPEECH_DIRECTION_LENGTH = 2000;

/** Ephemeral performance controls. These are never written to speech.json. */
export interface SpeechOptions {
  readonly voice?: string;
  readonly instructions?: string;
  readonly speed?: number;
  readonly prompt?: string;
}

export class InvalidSpeechOptionsError extends Error {}

function direction(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.trim().length > MAX_SPEECH_DIRECTION_LENGTH
  )
    throw new InvalidSpeechOptionsError(
      "Speech instructions and prompt must be text of at most 2000 characters.",
    );
  return value.trim() || undefined;
}

/** Validate before any credentials, synthesis, or playback; never echo input. */
export function normalizeSpeechOptions(
  input: unknown,
  provider?: SpeechProviderId,
): SpeechOptions {
  if (input === undefined) return {};
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new InvalidSpeechOptionsError("Speech options must be an object.");
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) => !["voice", "instructions", "speed", "prompt"].includes(key),
    )
  )
    throw new InvalidSpeechOptionsError("Unsupported speech option.");
  const instructions = direction(value.instructions);
  const prompt = direction(value.prompt);
  const { voice, speed } = value;
  if (
    voice !== undefined &&
    (typeof voice !== "string" ||
      !(provider
        ? isSpeechVoice(provider, voice)
        : SPEECH_PROVIDERS.some((candidate) =>
            isSpeechVoice(candidate, voice),
          )))
  )
    throw new InvalidSpeechOptionsError(
      "Unsupported voice for the selected speech provider.",
    );
  if (
    speed !== undefined &&
    (typeof speed !== "number" ||
      !Number.isFinite(speed) ||
      speed < 0.25 ||
      speed > 4)
  )
    throw new InvalidSpeechOptionsError(
      "OpenAI speed must be a number from 0.25 to 4.0.",
    );
  if (
    (instructions !== undefined || speed !== undefined) &&
    prompt !== undefined
  )
    throw new InvalidSpeechOptionsError(
      "Do not combine OpenAI instructions/speed with a Gemini prompt.",
    );
  if (provider === "openai" && prompt !== undefined)
    throw new InvalidSpeechOptionsError(
      "OpenAI uses --instructions and --speed; --prompt is for Gemini.",
    );
  if (
    provider === "gemini" &&
    (instructions !== undefined || speed !== undefined)
  )
    throw new InvalidSpeechOptionsError(
      "Gemini uses --prompt for delivery and pace; --instructions and --speed are for OpenAI.",
    );
  return {
    ...(voice === undefined ? {} : { voice: voice as string }),
    ...(instructions === undefined ? {} : { instructions }),
    ...(speed === undefined ? {} : { speed: speed as number }),
    ...(prompt === undefined ? {} : { prompt }),
  };
}
