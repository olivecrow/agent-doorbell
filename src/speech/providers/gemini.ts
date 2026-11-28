export const LEGACY_GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview";
export const GEMINI_TTS_MODELS = [
  LEGACY_GEMINI_TTS_MODEL,
  "gemini-3.8-flash-tts",
  "gemini-3.8-flash-lite-tts",
] as const;

// Official Gemini TTS voice order; names are case-sensitive.
export const GEMINI_TTS_VOICES = [
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Leda",
  "Orus",
  "Aoede",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat",
] as const;

export type GeminiTtsModel = (typeof GEMINI_TTS_MODELS)[number];
export const DEFAULT_GEMINI_TTS_MODEL = LEGACY_GEMINI_TTS_MODEL;
export const DEFAULT_GEMINI_TTS_VOICE = "Kore" satisfies (typeof GEMINI_TTS_VOICES)[number];

export function isGeminiTtsModel(value: unknown): value is GeminiTtsModel {
  return GEMINI_TTS_MODELS.some((model) => model === value);
}

export function isGeminiTtsVoice(value: string): boolean {
  return GEMINI_TTS_VOICES.some((voice) => voice === value);
}

/** The online library may lowercase the documented synthesis presets. */
export function canonicalGeminiPreset(value: string): string | undefined {
  const lower = value.toLowerCase();
  return GEMINI_TTS_VOICES.find((voice) => voice.toLowerCase() === lower);
}

export function isGeminiStoredVoiceId(value: string): boolean {
  return /^voice_[a-zA-Z0-9_-]{1,122}$/.test(value);
}

export function isGeminiCatalogVoiceId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value) &&
    !value.startsWith("voicekey_");
}

export function isGeminiVoiceForModel(model: GeminiTtsModel, voice: string): boolean {
  return model === LEGACY_GEMINI_TTS_MODEL
    ? isGeminiTtsVoice(voice)
    : isGeminiCatalogVoiceId(voice);
}
