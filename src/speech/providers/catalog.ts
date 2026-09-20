import {
  DEFAULT_OPENAI_TTS_MODEL,
  DEFAULT_OPENAI_TTS_VOICE,
  OPENAI_TTS_VOICES,
} from "./openai.js";
import {
  DEFAULT_GEMINI_TTS_MODEL,
  DEFAULT_GEMINI_TTS_VOICE,
  GEMINI_TTS_VOICES,
} from "./gemini.js";

export const SPEECH_PROVIDERS = ["openai", "gemini"] as const;
export type SpeechProviderId = (typeof SPEECH_PROVIDERS)[number];
export const DEFAULT_SPEECH_PROVIDER = "openai" satisfies SpeechProviderId;

export const SPEECH_PROVIDER_CATALOG = {
  openai: {
    label: "OpenAI",
    model: DEFAULT_OPENAI_TTS_MODEL,
    defaultVoice: DEFAULT_OPENAI_TTS_VOICE,
    voices: OPENAI_TTS_VOICES,
  },
  gemini: {
    label: "Gemini",
    model: DEFAULT_GEMINI_TTS_MODEL,
    defaultVoice: DEFAULT_GEMINI_TTS_VOICE,
    voices: GEMINI_TTS_VOICES,
  },
} as const;

export function isSpeechProviderId(value: unknown): value is SpeechProviderId {
  return SPEECH_PROVIDERS.some((provider) => provider === value);
}

export function isSpeechVoice(
  provider: SpeechProviderId,
  value: string,
): boolean {
  return SPEECH_PROVIDER_CATALOG[provider].voices.some(
    (voice) => voice === value,
  );
}
