import { readFile } from "node:fs/promises";
import { getAppPaths } from "./app-path.js";
import {
  parseSpeechSettings,
  type SpeechSettingsResult,
} from "./parse-speech-settings.js";

export function getSpeechSettingsPath(): string {
  return getAppPaths().speechSettingsPath;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
export async function loadSpeechSettings(
  path: string = getSpeechSettingsPath(),
): Promise<SpeechSettingsResult> {
  let text: string;

  try {
    text = await readFile(path, "utf-8");
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT")) {
      return parseSpeechSettings(undefined);
    }

    return {
      ok: false,
      reason: "Could not read speech settings.",
    };
  }

  let input: unknown;

  try {
    const withoutBom = text.replace(/^\uFEFF/, "");
    input = JSON.parse(withoutBom);
  } catch {
    return {
      ok: false,
      reason: "Speech settings contain invalid JSON",
    };
  }

  return parseSpeechSettings(input);
}
