// wavefile 11's bundled declaration uses an internal `module` declaration
// rejected by TypeScript 7 (TS1540). Describe only the API this adapter uses.
declare class WaveFile {
  fromScratch(
    channels: number,
    sampleRate: number,
    bitDepth: "16",
    samples: Int16Array,
  ): void;
  toBuffer(): Uint8Array;
}
declare const wavefile: { WaveFile: typeof WaveFile };
export default wavefile;
