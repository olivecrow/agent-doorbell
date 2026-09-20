import type { SpeechAudio } from "./audio.js";

export type StreamingSpeechAudio = Extract<SpeechAudio, { mode: "streaming" }>;
export const MAX_PCM_BYTES = 24_000 * 2 * 60;

/** Keep at most one partial sample; never collect the whole response. */
export async function* validatedPcmChunks(chunks: AsyncIterable<Uint8Array>) {
  let pending: number | undefined;
  let total = 0;
  for await (const chunk of chunks) {
    if (!(chunk instanceof Uint8Array)) throw new Error("Invalid PCM chunk.");
    total += chunk.length;
    if (total > MAX_PCM_BYTES)
      throw new Error("Speech audio exceeds the duration limit.");
    if (chunk.length === 0) continue;
    let bytes = chunk;
    if (pending !== undefined) {
      bytes = new Uint8Array(chunk.length + 1);
      bytes[0] = pending;
      bytes.set(chunk, 1);
      pending = undefined;
    }
    if (bytes.length % 2 !== 0) {
      pending = bytes[bytes.length - 1];
      bytes = bytes.subarray(0, -1);
    }
    if (bytes.length > 0) yield bytes;
  }
  if (total === 0 || pending !== undefined)
    throw new Error("Empty or incomplete PCM audio.");
}

export function streamingAudio(
  chunks: AsyncIterable<Uint8Array>,
  cancel: () => void,
): StreamingSpeechAudio {
  return {
    mode: "streaming",
    format: "pcm",
    sampleRateHz: 24_000,
    channels: 1,
    bitsPerSample: 16,
    signed: true,
    endianness: "little",
    chunks: validatedPcmChunks(chunks),
    cancel,
  };
}
