import { loadSpeechSettings } from "../config/load-speech-settings.js";
import {
  canonicalGeminiPreset,
  isGeminiVoiceForModel,
  LEGACY_GEMINI_TTS_MODEL,
  type GeminiTtsModel,
} from "../speech/providers/gemini.js";
import { GeminiCatalogError, type GeminiCatalog } from "../speech/providers/gemini-catalog.js";
import { configureSpeech } from "./configure-speech.js";
import { configurationFailure, createConfigurePrompts, type ConfigurePrompts } from "./configure.js";

export type GeminiProfileSelection = { model: GeminiTtsModel; voice: string };

export async function configureGemini(
  dependencies: {
    settingsPath: string;
    catalog: Pick<GeminiCatalog, "listModels" | "listVoices">;
    preview: (id: string, signal: AbortSignal) => Promise<void>;
    warning: (message: string) => void;
    prompts?: ConfigurePrompts;
  },
  signal: AbortSignal,
  selection?: GeminiProfileSelection,
) {
  try {
    const loaded = await loadSpeechSettings(dependencies.settingsPath);
    if (!loaded.ok) return { ...loaded, cancelled: false };
    const current = loaded.settings.providers.gemini;
    const prompts = selection === undefined
      ? dependencies.prompts ?? await createConfigurePrompts(signal)
      : undefined;
    const [models, voices] = await Promise.all([
      dependencies.catalog.listModels(signal),
      dependencies.catalog.listVoices(signal),
    ]);
    const firstModel = models[0];
    if (!firstModel) throw new GeminiCatalogError("Gemini returned no TTS models supported by Doorbell.");
    const model = selection?.model ?? await prompts!.choose(
      "Gemini TTS model:",
      models.map(({ id }) => id),
      models.some(({ id }) => id === current.model) ? current.model : firstModel.id,
    );
    if (!models.some(({ id }) => id === model))
      throw new GeminiCatalogError("This TTS model is unavailable in the Gemini API catalog.");
    const compatible = voices.filter(({ id, type }) =>
      isGeminiVoiceForModel(model, id) && (type === "prebuilt" || model !== LEGACY_GEMINI_TTS_MODEL),
    );
    if (compatible.length === 0)
      throw new GeminiCatalogError("Gemini returned no voices supported by this TTS model.");

    let voice = selection && (canonicalGeminiPreset(selection.voice) ?? selection.voice);
    if (prompts) {
      const choices = compatible.map(({ id, name, language, canPreview }) => ({
        value: id,
        name: [name === id ? name : `${name} (${id})`, language, canPreview ? "Preview available" : undefined]
          .filter(Boolean).join(" · "),
      }));
      let highlighted = compatible.some(({ id }) => id === current.voice) ? current.voice : undefined;
      for (;;) {
        const id = await prompts.search("Gemini voice (type to search):", choices, highlighted);
        if (!compatible.some((entry) => entry.id === id && entry.canPreview)) {
          voice = id;
          break;
        }
        highlighted = id;
        for (;;) {
          const action = await prompts.choose(
            "Voice action:", ["Use this voice", "Play preview", "Choose another voice"] as const, "Use this voice",
          );
          if (action === "Use this voice") voice = id;
          if (action !== "Play preview") break;
          try {
            await dependencies.preview(id, signal);
          } catch (error) {
            signal.throwIfAborted();
            dependencies.warning(error instanceof GeminiCatalogError ? error.message : "Could not play the Gemini voice preview.");
          }
        }
        if (voice !== undefined) break;
      }
    }
    if (voice === undefined || !compatible.some(({ id }) => id === voice))
      throw new GeminiCatalogError("This voice is unavailable in the Gemini catalog for the selected model.");
    if (prompts && !(await prompts.confirm("Save this model and voice and select Gemini for speech?", true)))
      return { ok: false, cancelled: true, reason: "Configuration cancelled. Nothing was saved." } as const;
    return await configureSpeech(dependencies, signal, { provider: "gemini", model, voice });
  } catch (error) {
    if (!signal.aborted && error instanceof GeminiCatalogError)
      return { ok: false, cancelled: false, reason: error.message } as const;
    return configurationFailure(error, signal);
  }
}
