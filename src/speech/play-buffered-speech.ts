import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSpeechTempDirectory } from "./temp-speech-files.js";

import type { AudioPlayer, PlaybackResult } from "../audio/player.js";
import type { SpeechAudio } from "./audio.js";

export type BufferedSpeechAudio = Extract<
  SpeechAudio,
  { readonly mode: "buffered" }
>;

export type BufferedPlaybackResult = PlaybackResult & {
  readonly cleanupWarning?: string;
};

export async function playBufferedSpeech(
  audio: BufferedSpeechAudio,
  player: AudioPlayer,
  signal?: AbortSignal,
  volume?: number,
): Promise<BufferedPlaybackResult> {
  if (!player.supports(audio.format)) {
    return {
      ok: false,
      reason: "The audio player does not support this speech format.",
    };
  }

  if (audio.bytes.byteLength === 0) {
    return {
      ok: false,
      reason: "Speech audio is empty.",
    };
  }

  let temporary: Awaited<ReturnType<typeof createSpeechTempDirectory>> | undefined;
  let cleanupWarning: string | undefined;

  let result: PlaybackResult = {
    ok: false,
    reason: "Speech playback did not complete.",
  };

  try {
    signal?.throwIfAborted();
    temporary = await createSpeechTempDirectory(signal);
    signal?.throwIfAborted();
    const path = join(temporary.directory, "speech.wav");

    await writeFile(path, audio.bytes, {
      flag: "wx",
      mode: 0o600,
      ...(signal === undefined ? {} : { signal }),
    });
    signal?.throwIfAborted();

    result = await player.play(
      {
        path,
        format: audio.format,
        ...(volume === undefined || volume === 1 ? {} : { volume }),
      },
      signal,
    );
  } catch {
    result = {
      ok: false,
      reason: "Could not prepare or play speech audio.",
    };
  } finally {
    if (temporary !== undefined) {
      try {
        await temporary.remove();
      } catch {
        cleanupWarning = "Could not remove temporary speech files.";
      }
    }
  }
  return cleanupWarning === undefined ? result : { ...result, cleanupWarning };
}
