export type SpeechAudio =
  | {
      readonly mode: "buffered";
      readonly format: "wav";
      readonly bytes: Uint8Array;
    }
  | {
      readonly mode: "streaming";
      readonly format: "pcm";
      readonly chunks: AsyncIterable<Uint8Array>;
      /** Stop upstream generation even if playback never starts consuming. */
      readonly cancel: () => void;
      readonly sampleRateHz: 24_000;
      readonly channels: 1;
      readonly bitsPerSample: 16;
      readonly signed: true;
      readonly endianness: "little";
    };

export function decodeBoundedBase64(data: unknown, maxBytes: number): Buffer | undefined {
  if (
    typeof data !== "string" ||
    data.length === 0 ||
    data.length > Math.ceil(maxBytes / 3) * 4 ||
    data.length % 4 !== 0
  )
    return undefined;
  const bytes = Buffer.from(data, "base64");
  return bytes.length > 0 && bytes.length <= maxBytes && bytes.toString("base64") === data
    ? bytes
    : undefined;
}

export function decodeBoundedWav(data: unknown, maxBytes: number): Buffer | undefined {
  const bytes = decodeBoundedBase64(data, maxBytes);
  return bytes && bytes.length >= 44 && bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WAVE" && bytes.readUInt32LE(4) === bytes.length - 8
    ? bytes
    : undefined;
}
