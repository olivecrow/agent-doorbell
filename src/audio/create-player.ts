import { FfplayAudioPlayer } from "./ffplay-player.js";
import type { AudioPlayer } from "./player.js";

export function createAudioPlayer(
  platform: NodeJS.Platform = process.platform,
): AudioPlayer {
  switch (platform) {
    case "win32":
    case "darwin":
    case "linux":
      return new FfplayAudioPlayer();

    default:
      throw new Error(`Unsupported operating system: ${platform}`);
  }
}
