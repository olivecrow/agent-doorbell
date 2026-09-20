// Offline native filter check. Generates PCM in memory; no device output or API calls.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { playbackVolumeArgs } from "../dist/audio/playback-volume.js";

const exec = promisify(execFile);
const receipts = [];
for (const amplitude of [3000, 28000]) {
  const input = Buffer.alloc(24_000 * 2);
  for (let sample = 0; sample < 24_000; sample++) {
    input.writeInt16LE(
      Math.round(amplitude * Math.sin((2 * Math.PI * 1000 * sample) / 24_000)),
      sample * 2,
    );
  }
  const pending = exec(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "s16le",
      "-ar",
      "24000",
      "-ch_layout",
      "mono",
      "-i",
      "pipe:0",
      ...playbackVolumeArgs(1.5),
      "-f",
      "s16le",
      "pipe:1",
    ],
    {
      windowsHide: true,
      encoding: "buffer",
      timeout: 10_000,
      maxBuffer: 1_000_000,
    },
  );
  pending.child.stdin.end(input);
  const { stdout, stderr } = await pending;
  assert.equal(stderr.length, 0);
  assert.equal(
    stdout.length,
    input.length,
    "Limiter must retain the complete tail",
  );
  let peak = 0;
  let squares = 0;
  for (let offset = 0; offset < stdout.length; offset += 2) {
    const sample = stdout.readInt16LE(offset);
    peak = Math.max(peak, Math.abs(sample));
    squares += sample ** 2;
  }
  const rms = Math.sqrt(squares / (stdout.length / 2));
  assert.ok(peak <= Math.ceil(0.95 * 32768), `Peak exceeded limiter: ${peak}`);
  if (amplitude === 3000)
    assert.ok(Math.abs(rms / (amplitude / Math.SQRT2) - 1.5) < 0.002);
  receipts.push({
    inputAmplitude: amplitude,
    outputPeak: peak,
    outputRms: Math.round(rms),
    samples: stdout.length / 2,
  });
}
console.log(JSON.stringify({ ok: true, gain: 1.5, receipts }, null, 2));
