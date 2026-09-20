export const GEMINI_TTS_MODELS = ["gemini-3.1-flash-tts-preview"] as const;

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
export type GeminiTtsVoice = (typeof GEMINI_TTS_VOICES)[number];
export const DEFAULT_GEMINI_TTS_MODEL = GEMINI_TTS_MODELS[0];
export const DEFAULT_GEMINI_TTS_VOICE = "Kore" satisfies GeminiTtsVoice;

export function isGeminiTtsVoice(value: string): value is GeminiTtsVoice {
  return GEMINI_TTS_VOICES.some((voice) => voice === value);
}
