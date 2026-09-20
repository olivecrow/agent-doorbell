import { execa } from "execa";
import { isAbsolute, parse } from "node:path";
import type { PlaybackResult } from "./player.js";
import type { StreamingSpeechAudio } from "../speech/pcm-stream.js";
import { playbackVolumeArgs } from "./playback-volume.js";
import {
  resolveFfplayExecutable,
  type FfplayExecutableResolver,
} from "./ffplay-executable.js";

export interface PcmProcessRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly chunks: AsyncIterable<Uint8Array>;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly onStop?: () => void;
}
export type PcmProcessRunner = (
  request: PcmProcessRequest,
) => Promise<PlaybackResult>;

/** Execa pipes the iterable with backpressure and waits for process completion. */
export const runPcmProcess: PcmProcessRunner = async (request) => {
  try {
    if (
      !isAbsolute(request.command) ||
      (process.platform === "win32" && parse(request.command).root.length <= 1)
    )
      throw new Error("The PCM player executable must be an absolute path.");
    const child = execa(request.command, request.args, {
      stdin: request.chunks,
      stdout: "ignore",
      stderr: "pipe",
      maxBuffer: 4096,
      cancelSignal: request.signal,
      timeout: request.timeoutMs,
      forceKillAfterDelay: 1000,
      windowsHide: true,
      shell: false,
      cleanup: true,
    });
    if (request.onStop) {
      child.nodeChildProcess.once("exit", request.onStop);
      child.nodeChildProcess.once("error", request.onStop);
    }
    const result = await child;
    return result.stderr.trim() === ""
      ? { ok: true }
      : { ok: false, reason: "The PCM player reported an audio error." };
  } catch {
    return {
      ok: false,
      reason: request.signal.aborted
        ? "Streaming playback was cancelled."
        : "Streaming playback failed or timed out.",
    };
  }
};

export async function playPcm(
  audio: StreamingSpeechAudio,
  signal?: AbortSignal,
  runner: PcmProcessRunner = runPcmProcess,
  volume?: number,
  resolveExecutable: FfplayExecutableResolver = resolveFfplayExecutable,
): Promise<PlaybackResult> {
  const timeout = AbortSignal.timeout(60_000);
  const operation = signal ? AbortSignal.any([signal, timeout]) : timeout;
  operation.addEventListener("abort", audio.cancel, { once: true });
  try {
    operation.throwIfAborted();
    if (
      audio.format !== "pcm" ||
      audio.sampleRateHz !== 24_000 ||
      audio.channels !== 1 ||
      audio.bitsPerSample !== 16 ||
      audio.signed !== true ||
      audio.endianness !== "little"
    )
      return { ok: false, reason: "Unsupported PCM stream format." };
    const volumeArgs = playbackVolumeArgs(volume);
    const command = await resolveExecutable();
    operation.throwIfAborted();
    return await runner({
      command,
      args: [
        "-nodisp",
        "-autoexit",
        "-hide_banner",
        "-nostats",
        "-loglevel",
        "error",
        ...volumeArgs,
        "-f",
        "s16le",
        "-ar",
        "24000",
        "-ch_layout",
        "mono",
        "-i",
        "pipe:0",
      ],
      chunks: audio.chunks,
      signal: operation,
      timeoutMs: 60_000,
      onStop: audio.cancel,
    });
  } catch {
    return { ok: false, reason: "Streaming playback failed or was cancelled." };
  } finally {
    operation.removeEventListener("abort", audio.cancel);
    audio.cancel();
  }
}
