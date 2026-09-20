export interface SpeechSelection {
  provider: string;
  model: string;
  voice?: string;
  playbackMode?: SpeechPlaybackMode;
}

export const SPEECH_PLAYBACK_MODES = ["buffered", "streaming"] as const;

export type SpeechPlaybackMode = (typeof SPEECH_PLAYBACK_MODES)[number];
export const DEFAULT_SPEECH_PLAYBACK_MODE = SPEECH_PLAYBACK_MODES[0];

export function isSpeechPlaybackMode(
  value: string,
): value is SpeechPlaybackMode {
  return SPEECH_PLAYBACK_MODES.some((mode) => mode === value);
}
