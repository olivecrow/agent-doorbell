export const OPENAI_TTS_MODELS = ["gpt-4o-mini-tts"] as const;

export const OPENAI_TTS_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
] as const;

export type OpenAiTtsModel = (typeof OPENAI_TTS_MODELS)[number];
export type OpenAiTtsVoice = (typeof OPENAI_TTS_VOICES)[number];
export const DEFAULT_OPENAI_TTS_MODEL = OPENAI_TTS_MODELS[0];
export const DEFAULT_OPENAI_TTS_VOICE = "nova" satisfies OpenAiTtsVoice;

export function isOpenAiTtsModel(value: string): value is OpenAiTtsModel {
  return OPENAI_TTS_MODELS.some((model) => model === value);
}

export function isOpenAiTtsVoice(value: string): value is OpenAiTtsVoice {
  return OPENAI_TTS_VOICES.some((model) => model === value);
}
