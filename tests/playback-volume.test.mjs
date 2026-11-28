import assert from "node:assert/strict";
import "./fixtures/speech-temp.mjs";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureSpeech } from "../dist/commands/configure-speech.js";
import { parseSpeechSettings } from "../dist/config/parse-speech-settings.js";
import { loadSpeechSettings } from "../dist/config/load-speech-settings.js";
import { notify } from "../dist/commands/notify.js";
import { FfplayAudioPlayer } from "../dist/audio/ffplay-player.js";
import { playPcm } from "../dist/audio/pcm-player.js";
import { streamingAudio } from "../dist/speech/pcm-stream.js";
import { playbackVolumeArgs } from "../dist/audio/playback-volume.js";

const stream = () =>
  streamingAudio(
    (async function* () {
      yield new Uint8Array([0, 0]);
    })(),
    () => {},
  );

test("volume defaults without rewriting legacy settings; explicit gain survives provider switches and invalid edits", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "doorbell-volume-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "speech.json");
  const legacy = '{"enabled":true,"voice":"coral"}';
  await writeFile(path, legacy);
  assert.equal((await loadSpeechSettings(path)).settings.playbackVolume, 1);
  assert.equal(await readFile(path, "utf8"), legacy);
  const save = (patch) =>
    configureSpeech(
      { settingsPath: path },
      new AbortController().signal,
      patch,
    );
  assert.equal((await save({ playbackVolume: 1.5 })).ok, true);
  assert.equal((await save({ provider: "gemini" })).ok, true);
  const saved = (await loadSpeechSettings(path)).settings;
  assert.equal(saved.playbackVolume, 1.5);
  assert.equal(saved.providers.openai.voice, "coral");
  assert.equal(saved.enabled, true);
  const before = await readFile(path, "utf8");
  for (const value of [0, 0.24, 4.01, NaN, Infinity, "1.5", null]) {
    assert.equal(parseSpeechSettings({ playbackVolume: value }).ok, false);
    assert.equal((await save({ playbackVolume: value })).ok, false);
    assert.equal(await readFile(path, "utf8"), before);
  }
  for (const playbackVolume of [0.25, 1, 4])
    assert.equal(parseSpeechSettings({ playbackVolume }).ok, true);
});

test("buffered and streaming notifications pass local gain only to speech playback, including sound fallback", async () => {
  for (const playbackMode of ["buffered", "streaming"]) {
    for (const provider of ["openai", "gemini"]) {
      const played = [];
      let requests = 0;
      const result = await notify(
        { message: "Please review." },
        {
          settings: parseSpeechSettings({
            enabled: true,
            provider,
            playbackMode,
            playbackVolume: 1.5,
          }),
          player: {
            id: "fake",
            supports: () => true,
            check: async () => ({ available: true }),
            checkStreaming: async () => ({ available: true }),
            play: async (request) => {
              played.push({ format: request.format, volume: request.volume });
              return request.format === "mp3"
                ? { ok: true }
                : { ok: false, reason: "Test playback failure." };
            },
            playStream: async (_audio, _signal, volume) => {
              played.push({ format: "pcm", volume });
              return { ok: false, reason: "Test playback failure." };
            },
          },
          createProvider: () => ({
            id: "fake",
            capabilities: { supportsStreaming: true },
            synthesize: async (request) => {
              requests++;
              assert.equal(Object.hasOwn(request, "playbackVolume"), false);
              assert.equal(Object.hasOwn(request.speech, "volume"), false);
              return {
                ok: true,
                audio:
                  playbackMode === "streaming"
                    ? stream()
                    : {
                        mode: "buffered",
                        format: "wav",
                        bytes: new Uint8Array([1, 2]),
                      },
              };
            },
          }),
        },
      );
      assert.equal(result.delivery.mode, "sound");
      assert.equal(requests, 1);
      assert.deepEqual(played, [
        { format: "mp3", volume: undefined },
        { format: playbackMode === "streaming" ? "pcm" : "wav", volume: 1.5 },
      ]);
    }
  }
});

test("file and PCM players use the same bounded limiter, preserve the default, and reject invalid gain before launching", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "doorbell-volume-player-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "test.wav");
  await writeFile(path, "fake");
  const calls = [];
  const resolveExecutable = async () => process.execPath;
  const player = new FfplayAudioPlayer(1000, {
    run: async (request) => {
      calls.push(request.args);
      return { ok: true, stdout: "", stderr: "", exitCode: 0 };
    },
  }, resolveExecutable);
  const pcmRunner = async (request) => {
    calls.push(request.args);
    for await (const _chunk of request.chunks) {
    }
    return { ok: true };
  };
  for (const volume of [1, 0.5, 1.5, 4]) {
    assert.equal((await player.play({ path, format: "wav", volume })).ok, true);
    assert.equal(
      (await playPcm(stream(), undefined, pcmRunner, volume, resolveExecutable)).ok,
      true,
    );
    for (const args of calls.slice(-2)) {
      if (volume === 1) assert.equal(args.includes("-af"), false);
      else
        assert.deepEqual(
          args.slice(args.indexOf("-af"), args.indexOf("-af") + 2),
          playbackVolumeArgs(volume),
        );
    }
  }
  const count = calls.length;
  for (const volume of [0, 10, NaN, "1.5:evil"]) {
    assert.equal(
      (await player.play({ path, format: "wav", volume })).ok,
      false,
    );
    assert.equal(
      (await playPcm(stream(), undefined, pcmRunner, volume, resolveExecutable)).ok,
      false,
    );
  }
  assert.equal(calls.length, count);
});
