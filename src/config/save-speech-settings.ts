import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { getSpeechSettingsPath } from "./load-speech-settings.js";
import { parseSpeechSettings } from "./parse-speech-settings.js";

export type SaveSpeechSettingsResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export async function saveSpeechSettings(
  input: unknown,
  path: string = getSpeechSettingsPath(),
  signal?: AbortSignal,
): Promise<SaveSpeechSettingsResult> {
  const parsed = parseSpeechSettings(input);

  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason };
  }

  try {
    signal?.throwIfAborted();

    await mkdir(dirname(path), {
      recursive: true,
      mode: 0o700,
    });

    signal?.throwIfAborted();

    await writeFileAtomic(
      path,
      JSON.stringify(parsed.settings, null, 2) + "\n",
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );

    return { ok: true };
  } catch {
    return {
      ok: false,
      reason: signal?.aborted
        ? "Saving speech settings was cancelled."
        : "Could not save speech settings.",
    };
  }
}
