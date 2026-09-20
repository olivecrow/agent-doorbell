import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getAppPaths } from "../config/app-path.js";
import { loadSpeechSettings } from "../config/load-speech-settings.js";
import { selectSpeechSettings } from "../config/parse-speech-settings.js";
import { SPEECH_PROVIDER_CATALOG } from "../speech/providers/catalog.js";

export async function getAgentInstructions() {
  const loaded = await loadSpeechSettings(getAppPaths().speechSettingsPath);
  const selected = loaded.ok
    ? selectSpeechSettings(loaded.settings)
    : undefined;
  return {
    ok: loaded.ok,
    configuration: selected
      ? {
          enabled: selected.enabled,
          provider: selected.provider,
          model: selected.model,
          defaultVoice: selected.voice,
          playbackMode: selected.playbackMode,
          playbackVolume: selected.playbackVolume,
        }
      : undefined,
    ...(loaded.ok ? {} : { error: loaded.reason }),
    providers: SPEECH_PROVIDER_CATALOG,
    cli: {
      command: process.execPath,
      args: [fileURLToPath(new URL("../cli.js", import.meta.url))],
    },
    playbackNotes:
      "OpenAI supports buffered and PCM streaming. Gemini uses buffered playback before any paid request because uninterrupted streaming failed local validation.",
    instructions: await readFile(
      new URL("../../docs/agent-integration.md", import.meta.url),
      "utf8",
    ),
  };
}
