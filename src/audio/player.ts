import type { CapabilityAvailability } from "../domain/results.js";
import type { StreamingSpeechAudio } from "../speech/pcm-stream.js";

export type AudioFormat = "wav" | "mp3";

export interface AudioPlayer {
  readonly id: string;
  supports(format: AudioFormat): boolean;
  check(signal?: AbortSignal): Promise<CapabilityAvailability>;
  checkStreaming?(signal?: AbortSignal): Promise<CapabilityAvailability>;
  playStream?(
    audio: StreamingSpeechAudio,
    signal?: AbortSignal,
    volume?: number,
  ): Promise<PlaybackResult>;
  play(
    request: FilePlaybackRequest,
    signal?: AbortSignal,
  ): Promise<PlaybackResult>;
}

export type FilePlaybackRequest = {
  path: string;
  format: AudioFormat;
  volume?: number;
};
export type PlaybackResult = { ok: true } | { ok: false; reason: string };
