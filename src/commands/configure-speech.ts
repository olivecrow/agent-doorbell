import {
  SPEECH_PLAYBACK_MODES,
  type SpeechPlaybackMode,
} from "../config/speech.js";
import { loadSpeechSettings } from "../config/load-speech-settings.js";
import { isPlaybackVolume } from "../audio/playback-volume.js";
import { parseSpeechSettings } from "../config/parse-speech-settings.js";
import { saveSpeechSettings } from "../config/save-speech-settings.js";
import {
  SPEECH_PROVIDERS,
  SPEECH_PROVIDER_CATALOG,
  isSpeechProviderId,
  type SpeechProviderId,
} from "../speech/providers/catalog.js";
import type { GeminiTtsModel } from "../speech/providers/gemini.js";
import {
  configurationFailure,
  createConfigurePrompts,
  type ConfigurePrompts,
  type ConfigureResult,
} from "./configure.js";

export interface SpeechSettingsPatch {
  readonly provider?: SpeechProviderId;
  readonly enabled?: boolean;
  readonly voice?: string;
  readonly model?: GeminiTtsModel;
  readonly playbackMode?: SpeechPlaybackMode;
  readonly playbackVolume?: number;
}

export interface ConfigureSpeechDependencies {
  readonly settingsPath: string;
  readonly prompts?: ConfigurePrompts;
}

/** Voice preferences and activation never read or write credentials. */
export async function configureSpeech(
  dependencies: ConfigureSpeechDependencies,
  signal: AbortSignal,
  patch?: SpeechSettingsPatch,
): Promise<ConfigureResult> {
  try {
    signal.throwIfAborted();
    if (
      patch !== undefined &&
      Object.keys(patch).some(
        (key) =>
          ![
            "provider",
            "enabled",
            "voice",
            "model",
            "playbackMode",
            "playbackVolume",
          ].includes(key),
      )
    )
      return {
        ok: false,
        cancelled: false,
        reason:
          "Unsupported speech setting. Pass delivery instructions to notify instead.",
      };
    const loaded = await loadSpeechSettings(dependencies.settingsPath);
    if (!loaded.ok) return { ...loaded, cancelled: false };
    const current = loaded.settings;
    let changes = patch;
    let prompts: ConfigurePrompts | undefined;

    if (changes === undefined) {
      prompts = dependencies.prompts ?? (await createConfigurePrompts(signal));
      const provider = await prompts.choose(
        "Speech provider:",
        SPEECH_PROVIDERS,
        current.provider,
      );
      const catalog = SPEECH_PROVIDER_CATALOG[provider];
      const savedVoice = current.providers[provider].voice;
      const voices = catalog.voices as readonly string[];
      changes = {
        provider,
        enabled: await prompts.confirm(
          `Enable AI-generated ${catalog.label} speech? Notification text and delivery instructions are sent to ${catalog.label} and API charges may apply.`,
          current.enabled,
        ),
        playbackMode: await prompts.choose(
          "Playback mode:",
          SPEECH_PLAYBACK_MODES,
          current.playbackMode,
        ),
        voice: await prompts.choose<string>(
          `${catalog.label} voice:`,
          voices.includes(savedVoice) ? voices : [savedVoice, ...voices],
          savedVoice,
        ),
        playbackVolume: Number(
          await prompts.text(
            "Speech playback volume (0.25-4; 1 keeps the original level):",
            String(current.playbackVolume),
            (value) =>
              isPlaybackVolume(Number(value)) ||
              "Enter a number from 0.25 to 4.",
          ),
        ),
      };
    }

    const provider = changes.provider ?? current.provider;
    if (!isSpeechProviderId(provider))
      return {
        ok: false,
        cancelled: false,
        reason: "Unsupported speech provider.",
      };
    const parsed = parseSpeechSettings({
      ...current,
      provider,
      enabled: changes.enabled ?? current.enabled,
      playbackMode: changes.playbackMode ?? current.playbackMode,
      playbackVolume:
        changes.playbackVolume === undefined
          ? current.playbackVolume
          : changes.playbackVolume,
      providers: {
        ...current.providers,
        [provider]: {
          ...current.providers[provider],
          ...(changes.model === undefined ? {} : { model: changes.model }),
          voice: changes.voice ?? current.providers[provider].voice,
        },
      },
    });
    if (!parsed.ok) return { ...parsed, cancelled: false };

    if (
      prompts !== undefined &&
      !(await prompts.confirm("Save speech settings?", true))
    ) {
      return {
        ok: false,
        cancelled: true,
        reason: "Configuration cancelled. Nothing was saved.",
      };
    }
    signal.throwIfAborted();
    const result = await saveSpeechSettings(
      parsed.settings,
      dependencies.settingsPath,
      signal,
    );
    return result.ok ? result : { ...result, cancelled: signal.aborted };
  } catch (error: unknown) {
    return configurationFailure(error, signal);
  }
}
