import {
  DEFAULT_OPENAI_TTS_MODEL,
  DEFAULT_OPENAI_TTS_VOICE,
  isOpenAiTtsVoice,
  type OpenAiTtsModel,
  type OpenAiTtsVoice,
} from "../speech/providers/openai.js";
import {
  DEFAULT_GEMINI_TTS_MODEL,
  DEFAULT_GEMINI_TTS_VOICE,
  isGeminiTtsVoice,
  type GeminiTtsModel,
  type GeminiTtsVoice,
} from "../speech/providers/gemini.js";
import {
  DEFAULT_SPEECH_PROVIDER,
  isSpeechProviderId,
  type SpeechProviderId,
} from "../speech/providers/catalog.js";
import {
  DEFAULT_SPEECH_PLAYBACK_MODE,
  isSpeechPlaybackMode,
  type SpeechPlaybackMode,
} from "./speech.js";
import {
  DEFAULT_PLAYBACK_VOLUME,
  isPlaybackVolume,
} from "../audio/playback-volume.js";

interface CommonSpeechSettings {
  readonly enabled: boolean;
  readonly playbackMode: SpeechPlaybackMode;
  readonly playbackVolume: number;
}

export interface SpeechSettings extends CommonSpeechSettings {
  readonly provider: SpeechProviderId;
  readonly providers: {
    readonly openai: {
      readonly model: OpenAiTtsModel;
      readonly voice: OpenAiTtsVoice;
    };
    readonly gemini: {
      readonly model: GeminiTtsModel;
      readonly voice: GeminiTtsVoice;
    };
  };
}

export type OpenAiSpeechSettings = CommonSpeechSettings &
  SpeechSettings["providers"]["openai"] & { readonly provider: "openai" };
export type GeminiSpeechSettings = CommonSpeechSettings &
  SpeechSettings["providers"]["gemini"] & { readonly provider: "gemini" };
export type SelectedSpeechSettings =
  | OpenAiSpeechSettings
  | GeminiSpeechSettings;

export type SpeechSettingsResult =
  | { readonly ok: true; readonly settings: SpeechSettings }
  | { readonly ok: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseProfile<Model extends string, Voice extends string>(
  input: unknown,
  model: Model,
  defaultVoice: Voice,
  isVoice: (value: string) => value is Voice,
): { readonly model: Model; readonly voice: Voice } | undefined {
  const value = input === undefined ? {} : input;
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => key !== "model" && key !== "voice")
  )
    return undefined;
  const voice = value.voice === undefined ? defaultVoice : value.voice;
  if (
    (value.model !== undefined && value.model !== model) ||
    typeof voice !== "string" ||
    !isVoice(voice)
  )
    return undefined;
  return { model, voice };
}

export function selectSpeechSettings(
  settings: SpeechSettings,
): SelectedSpeechSettings {
  const common = {
    enabled: settings.enabled,
    playbackMode: settings.playbackMode,
    playbackVolume: settings.playbackVolume,
  };
  return settings.provider === "openai"
    ? { ...common, provider: "openai", ...settings.providers.openai }
    : { ...common, provider: "gemini", ...settings.providers.gemini };
}

export function parseSpeechSettings(input: unknown): SpeechSettingsResult {
  const value = input === undefined ? {} : input;
  if (!isRecord(value))
    return { ok: false, reason: "Speech settings must be an object." };
  const allowed = new Set([
    "enabled",
    "provider",
    "providers",
    "model",
    "voice",
    "playbackMode",
    "playbackVolume",
    "style",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    return {
      ok: false,
      reason: "Speech settings contain an unsupported field.",
    };

  const enabled = value.enabled === undefined ? false : value.enabled;
  const provider =
    value.provider === undefined ? DEFAULT_SPEECH_PROVIDER : value.provider;
  const playbackMode =
    value.playbackMode === undefined
      ? DEFAULT_SPEECH_PLAYBACK_MODE
      : value.playbackMode;
  const playbackVolume =
    value.playbackVolume === undefined
      ? DEFAULT_PLAYBACK_VOLUME
      : value.playbackVolume;
  if (typeof enabled !== "boolean")
    return { ok: false, reason: "Speech enabled must be a boolean." };
  if (!isSpeechProviderId(provider))
    return { ok: false, reason: "Unsupported speech provider." };
  if (typeof playbackMode !== "string" || !isSpeechPlaybackMode(playbackMode))
    return { ok: false, reason: "Unsupported speech playback mode." };
  if (!isPlaybackVolume(playbackVolume))
    return {
      ok: false,
      reason: "Speech playback volume must be a number from 0.25 to 4.",
    };

  // Read existing flat OpenAI settings without rewriting the file or losing choices.
  // Flat model/voice are also accepted as shorthand for the selected provider.
  if (
    value.providers !== undefined &&
    (value.model !== undefined || value.voice !== undefined)
  ) {
    return {
      ok: false,
      reason: "Do not mix provider profiles with flat model or voice settings.",
    };
  }
  const profiles =
    value.providers === undefined
      ? { [provider]: { model: value.model, voice: value.voice } }
      : value.providers;
  if (
    !isRecord(profiles) ||
    Object.keys(profiles).some((key) => !isSpeechProviderId(key))
  ) {
    return { ok: false, reason: "Unsupported speech provider settings." };
  }
  const openai = parseProfile(
    profiles.openai,
    DEFAULT_OPENAI_TTS_MODEL,
    DEFAULT_OPENAI_TTS_VOICE,
    isOpenAiTtsVoice,
  );
  const gemini = parseProfile(
    profiles.gemini,
    DEFAULT_GEMINI_TTS_MODEL,
    DEFAULT_GEMINI_TTS_VOICE,
    isGeminiTtsVoice,
  );
  if (!openai || !gemini)
    return {
      ok: false,
      reason: "Unsupported provider model, voice, or setting.",
    };

  // Accept the old shape on read, but never apply or persist its tone.
  const style = value.style === undefined ? {} : value.style;
  if (
    !isRecord(style) ||
    Object.keys(style).some((key) => key !== "tone") ||
    (style.tone !== undefined && typeof style.tone !== "string")
  )
    return { ok: false, reason: "Unsupported speech style settings." };

  return {
    ok: true,
    settings: {
      enabled,
      provider,
      providers: { openai, gemini },
      playbackMode,
      playbackVolume,
    },
  };
}
