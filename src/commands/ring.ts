import { getNotificationAssetPath } from "../audio/assets.js";
import type { AudioPlayer, PlaybackResult } from "../audio/player.js";

export async function ring(
  player: AudioPlayer,
  signal?: AbortSignal,
): Promise<PlaybackResult> {
  return player.play(
    {
      path: getNotificationAssetPath(),
      format: "mp3",
    },
    signal,
  );
}
