import assert from "node:assert/strict";
import "./fixtures/speech-temp.mjs";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  streamingAudio,
  validatedPcmChunks,
} from "../dist/speech/pcm-stream.js";
import { runPcmProcess, playPcm } from "../dist/audio/pcm-player.js";
import { createSpeechProvider } from "../dist/speech/create-provider.js";
import {
  parseSpeechSettings,
  selectSpeechSettings,
} from "../dist/config/parse-speech-settings.js";
import { notify } from "../dist/commands/notify.js";

const credential = {
  read: async () => ({ ok: true, value: "fake-stream-key" }),
};
const settings = (provider = "openai") =>
  parseSpeechSettings({ provider, enabled: true, playbackMode: "streaming" });
const from = async function* (parts) {
  for (const part of parts) yield Uint8Array.from(part);
};
const collect = async (stream) => {
  const result = [];
  for await (const part of stream) result.push(...part);
  return result;
};
const sse = (event) =>
  new TextEncoder().encode(
    `event: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`,
  );

test("PCM streaming preserves bytes across split samples, rejects empty, truncated, and oversized audio", async () => {
  assert.deepEqual(
    await collect(validatedPcmChunks(from([[1], [], [2, 3], [4, 5, 6]]))),
    [1, 2, 3, 4, 5, 6],
  );
  for (const chunks of [
    from([]),
    from([[1]]),
    from([[1, 2, 3]]),
    from([new Uint8Array(2_880_002)]),
  ])
    await assert.rejects(collect(validatedPcmChunks(chunks)));
});

test("OpenAI returns its first PCM chunk before the response ends and cancellation closes the source", async (t) => {
  let controller;
  let closed = false;
  let requestBody;
  let networkSignal;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    requestBody = JSON.parse(init.body);
    networkSignal = init.signal;
    return new Response(
      new ReadableStream({
        start(value) {
          controller = value;
        },
        cancel() {
          closed = true;
        },
      }),
    );
  });
  const provider = createSpeechProvider(
    selectSpeechSettings(settings().settings),
    credential,
  );
  const result = await provider.synthesize({
    message: "Please review.",
    speech: { instructions: "Calm and clear.", speed: 1.1 },
  });
  assert.equal(result.ok, true);
  assert.equal(requestBody.response_format, "pcm");
  assert.equal(requestBody.stream_format, "audio");
  const iterator = result.audio.chunks[Symbol.asyncIterator]();
  controller.enqueue(Uint8Array.from([1, 2]));
  assert.deepEqual([...(await iterator.next()).value], [1, 2]);
  assert.equal(closed, false);
  await iterator.return();
  result.audio.cancel();
  assert.equal(closed, true);
  assert.equal(networkSignal.aborted, true);
  assert.equal(globalThis.fetch.mock.callCount(), 1);
});

test("Gemini streams validated audio deltas once, preserves prompt and requires completion", async (t) => {
  let body;
  let events;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const request = new Request(url, init);
    body = await request.json();
    return new Response(
      new ReadableStream({
        start(controller) {
          events = controller;
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  });
  for (const finish of ["completed", "truncated", "wrong-format"]) {
    const provider = createSpeechProvider(
      selectSpeechSettings(settings("gemini").settings),
      credential,
    );
    const result = await provider.synthesize({
      message: "Please review.",
      speech: { voice: "Puck", prompt: "Warm and focused." },
    });
    assert.equal(result.ok, true);
    assert.equal(body.stream, true);
    assert.equal(body.store, false);
    assert.deepEqual(body.response_format, { type: "audio" });
    assert.match(body.input, /Warm and focused\./);
    assert.match(body.input, /Transcript:\nPlease review\.$/);
    const iterator = result.audio.chunks[Symbol.asyncIterator]();
    events.enqueue(
      sse({
        event_type: "step.delta",
        index: 0,
        delta: {
          type: "audio",
          mime_type: finish === "wrong-format" ? "audio/mp3" : "audio/l16",
          sample_rate: 24000,
          channels: 1,
          data: "AQI=",
        },
      }),
    );
    if (finish === "wrong-format") {
      await assert.rejects(iterator.next());
      result.audio.cancel();
      continue;
    }
    assert.deepEqual([...(await iterator.next()).value], [1, 2]);
    if (finish === "completed") {
      events.enqueue(
        sse({
          event_type: "interaction.completed",
          interaction: { id: "fake", status: "completed" },
        }),
      );
      events.close();
      assert.equal((await iterator.next()).done, true);
    } else {
      events.close();
      await assert.rejects(iterator.next(), /before completion/);
    }
    result.audio.cancel();
  }
  assert.equal(globalThis.fetch.mock.callCount(), 3);
});

test("stream preflight selects buffered before synthesis; a started stream never triggers another synthesis", async () => {
  for (const streaming of [false, true]) {
    const synthesized = [];
    let cancelled = 0;
    let sound = 0;
    const result = await notify(
      { message: "Review." },
      {
        settings: settings(),
        player: {
          id: "fake",
          supports: () => true,
          check: async () => ({ available: true }),
          checkStreaming: async () => ({
            available: streaming,
            reason: "No PCM support.",
          }),
          play: async ({ format }) => {
            if (format === "mp3") sound++;
            return { ok: true };
          },
          playStream: async (audio) => {
            await collect(audio.chunks);
            return { ok: false, reason: "Device failed." };
          },
        },
        createProvider: (selected) => ({
          id: "fake",
          capabilities: { supportsStreaming: true },
          synthesize: async () => {
            synthesized.push(selected.playbackMode);
            return {
              ok: true,
              audio:
                selected.playbackMode === "buffered"
                  ? {
                      mode: "buffered",
                      format: "wav",
                      bytes: Uint8Array.from([1, 2]),
                    }
                  : streamingAudio(from([[1, 2]]), () => cancelled++),
            };
          },
        }),
      },
    );
    assert.deepEqual(synthesized, [streaming ? "streaming" : "buffered"]);
    assert.equal(result.delivery.mode, streaming ? "sound" : "speech");
    assert.equal(sound, streaming ? 1 : 0);
    assert.equal(cancelled, streaming ? 1 : 0);
    if (!streaming) assert.match(result.warnings[0], /before requesting audio/);
  }
});

test("cancelled stream releases upstream without a sound fallback", async () => {
  const controller = new AbortController();
  let closed = 0;
  const result = await notify(
    { message: "Review." },
    {
      settings: settings(),
      player: {
        id: "fake",
        supports: () => true,
        check: async () => ({ available: true }),
        checkStreaming: async () => ({ available: true }),
        playStream: async () => {
          controller.abort();
          return { ok: false, reason: "Cancelled." };
        },
        play: async () => assert.fail("Unexpected fallback"),
      },
      createProvider: () => ({
        id: "fake",
        capabilities: { supportsStreaming: true },
        synthesize: async () => ({
          ok: true,
          audio: streamingAudio(from([[1, 2]]), () => closed++),
        }),
      }),
    },
    controller.signal,
  );
  assert.equal(result.delivery.cancelled, true);
  assert.equal(closed, 1);
});

test("PCM process receives audio before generation ends, applies backpressure and closes on error/cancel", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "doorbell-pcm-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const marker = join(directory, "first chunk.txt");
  let generated = 0;
  let completed = false;
  const chunks = async function* () {
    for (let i = 0; i < 1024; i++) {
      generated++;
      yield new Uint8Array(65536);
    }
    completed = true;
  };
  const playback = runPcmProcess({
    command: process.execPath,
    args: [
      "-e",
      "const fs=require('fs'); process.stdin.once('data',()=>{ fs.writeFileSync(process.argv[1],'ready'); process.stdin.pause(); setTimeout(()=>process.stdin.resume(),500); }); process.stdin.resume();",
      marker,
    ],
    chunks: chunks(),
    signal: new AbortController().signal,
    timeoutMs: 5000,
  });
  for (let i = 0; i < 100; i++) {
    try {
      await access(marker);
      break;
    } catch {
      await delay(10);
    }
  }
  assert.equal(await readFile(marker, "utf8"), "ready");
  assert.equal(completed, false);
  assert.ok(generated < 1024);
  assert.equal((await playback).ok, true);
  for (const action of ["error", "cancel", "timeout"]) {
    const controller = new AbortController();
    const pending = runPcmProcess({
      command: process.execPath,
      args: [
        "-e",
        action === "error" ? "process.exit(7)" : "setInterval(()=>{},1000)",
      ],
      chunks: from([[1, 2]]),
      signal: controller.signal,
      timeoutMs: action === "timeout" ? 50 : 2000,
    });
    if (action === "cancel") setTimeout(() => controller.abort(), 60);
    assert.equal((await pending).ok, false);
  }
});

test("PCM player always closes the upstream stream, including unsupported metadata", async () => {
  let closed = 0;
  let started = 0;
  const audio = streamingAudio(from([[1, 2]]), () => closed++);
  const runner = async () => {
    started++;
    return { ok: false, reason: "Failure." };
  };
  const resolveExecutable = async () => process.execPath;
  assert.equal((await playPcm(audio, undefined, runner, undefined, resolveExecutable)).ok, false);
  assert.equal(
    (await playPcm({ ...audio, channels: 2 }, undefined, runner, undefined, resolveExecutable)).ok,
    false,
  );
  assert.equal(closed, 2);
  assert.equal(started, 1);
});

test("production Gemini streaming selection switches to buffered before exactly one request", async (t) => {
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    bodies.push(await new Request(url, init).json());
    return new Response(
      JSON.stringify({
        id: "fake",
        status: "completed",
        steps: [
          {
            type: "model_output",
            content: [
              { type: "audio", mime_type: "audio/l16", data: "AAAAAA==" },
            ],
          },
        ],
      }),
      { headers: { "content-type": "application/json" } },
    );
  });
  let streamingChecks = 0;
  const result = await notify(
    { message: "Review." },
    {
      settings: settings("gemini"),
      player: {
        id: "fake",
        supports: () => true,
        check: async () => ({ available: true }),
        checkStreaming: async () => {
          streamingChecks++;
          return { available: true };
        },
        play: async () => ({ ok: true }),
        playStream: async () =>
          assert.fail("Unvalidated streaming must not play"),
      },
      createProvider: (selected) => createSpeechProvider(selected, credential),
    },
  );
  assert.equal(result.delivery.mode, "speech");
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].stream, false);
  assert.match(result.warnings[0], /Gemini streaming.*before requesting audio/);
  assert.equal(streamingChecks, 0);
});
