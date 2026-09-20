export const DEFAULT_PLAYBACK_VOLUME = 1;

export function isPlaybackVolume(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0.25 &&
    value <= 4
  );
}

/** Apply local gain with peak limiting; keep the original signal at the default. */
export function playbackVolumeArgs(volume = DEFAULT_PLAYBACK_VOLUME): string[] {
  if (!isPlaybackVolume(volume)) {
    throw new Error("Speech playback volume must be a number from 0.25 to 4.");
  }
  return volume === 1
    ? []
    : ["-af", `alimiter=level_in=${volume}:limit=0.95:level=0:latency=1`];
}
