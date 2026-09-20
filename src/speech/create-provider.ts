import type { SelectedSpeechSettings } from "../config/parse-speech-settings.js";
import type { CredentialReader } from "../config/credentials.js";
import type { SpeechProvider } from "./provider.js";
import { OpenAiSpeechProvider } from "./providers/openai-provider.js";
import { GeminiSpeechProvider } from "./providers/gemini-provider.js";

/** Select exactly one provider; there is no cross-provider retry or fallback. */
export function createSpeechProvider(
  settings: SelectedSpeechSettings,
  credentials: CredentialReader,
): SpeechProvider {
  switch (settings.provider) {
    case "openai":
      return new OpenAiSpeechProvider(settings, credentials);
    case "gemini":
      return new GeminiSpeechProvider(settings, credentials);
  }
}
