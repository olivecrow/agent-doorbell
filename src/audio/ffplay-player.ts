import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { NodeProcessRunner } from "../process/node-runner.js";
import { ProcessRunner } from "../process/runner.js";
import { CapabilityAvailability } from "../domain/results.js";
import { playPcm, runPcmProcess, type PcmProcessRunner } from "./pcm-player.js";
import { playbackVolumeArgs } from "./playback-volume.js";
import {
  FFPLAY_UNAVAILABLE,
  resolveFfplayExecutable,
  type FfplayExecutableResolver,
} from "./ffplay-executable.js";
import type { StreamingSpeechAudio } from "../speech/pcm-stream.js";
import {
  AudioFormat,
  AudioPlayer,
  FilePlaybackRequest,
  PlaybackResult,
} from "./player.js";

export class FfplayAudioPlayer implements AudioPlayer {
  readonly id = "ffplay";
  private executable: Promise<string> | undefined;

  constructor(
    private readonly timeoutMs = 15_000,
    private readonly runner: ProcessRunner = new NodeProcessRunner(),
    private readonly resolveExecutable: FfplayExecutableResolver = resolveFfplayExecutable,
    private readonly pcmRunner: PcmProcessRunner = runPcmProcess,
  ) {}

  private getExecutable(): Promise<string> {
    return (this.executable ??= this.resolveExecutable());
  }

  supports(format: AudioFormat): boolean {
    return format === "wav" || format === "mp3";
  }

  async checkStreaming(signal?: AbortSignal): Promise<CapabilityAvailability> {
    let command: string;
    try {
      signal?.throwIfAborted();
      command = await this.getExecutable();
    } catch {
      return { available: false, reason: FFPLAY_UNAVAILABLE };
    }
    const result = await this.runner.run({
      command,
      args: ["-hide_banner", "-h", "demuxer=s16le"],
      timeoutMs: 5000,
      ...(signal === undefined ? {} : { signal }),
    });
    return result.ok &&
      /s16le/.test(result.stdout + result.stderr) &&
      /ch_layout/.test(result.stdout + result.stderr)
      ? { available: true }
      : {
          available: false,
          reason:
            "ffplay with s16le and ch_layout support is required for PCM streaming.",
        };
  }

  playStream(
    audio: StreamingSpeechAudio,
    signal?: AbortSignal,
    volume?: number,
  ): Promise<PlaybackResult> {
    return playPcm(audio, signal, this.pcmRunner, volume, () => this.getExecutable());
  }

  async check(signal?: AbortSignal): Promise<CapabilityAvailability> {
    let command: string;
    try {
      signal?.throwIfAborted();
      command = await this.getExecutable();
    } catch {
      return { available: false, reason: FFPLAY_UNAVAILABLE };
    }
    const result = await this.runner.run({
      command,
      args: ["-version"],
      timeoutMs: 5_000,
      ...(signal === undefined ? {} : { signal }),
    });

    return result.ok
      ? { available: true }
      : {
          available: false,
          reason: result.reason,
        };
  }

  async play(
    request: FilePlaybackRequest,
    signal?: AbortSignal,
  ): Promise<PlaybackResult> {
    if (!this.supports(request.format)) {
      return { ok: false, reason: "Unsupported audio format" };
    }

    if (request.path.trim() === "") {
      return { ok: false, reason: "Audio file path is empty" };
    }

    try {
      const volumeArgs = playbackVolumeArgs(request.volume);
      const filePath = resolve(request.path);
      await access(filePath);

      const result = await this.runner.run({
        command: await this.getExecutable(),
        args: [
          "-nodisp",
          "-autoexit",
          "-hide_banner",
          "-nostats",
          "-loglevel",
          "error",
          ...volumeArgs,
          filePath,
        ],
        timeoutMs: this.timeoutMs,
        ...(signal === undefined ? {} : { signal }),
      });

      if (!result.ok) {
        return { ok: false, reason: result.reason };
      }

      const errorOutput = result.stderr.trim();

      if (errorOutput !== "") {
        return { ok: false, reason: errorOutput };
      }

      return { ok: true };
    } catch (error: unknown) {
      return {
        ok: false,
        reason:
          error instanceof Error ? error.message : "Audio playback failed",
      };
    }
  }
}
