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
