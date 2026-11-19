import assert from "node:assert/strict";
import "./fixtures/speech-temp.mjs";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseSpeechSettings,
  selectSpeechSettings,
} from "../dist/config/parse-speech-settings.js";
import { loadSpeechSettings } from "../dist/config/load-speech-settings.js";
import { configureSpeech } from "../dist/commands/configure-speech.js";
import { configureApiKey } from "../dist/commands/configure-api-key.js";
import { notify } from "../dist/commands/notify.js";
import { createSpeechProvider } from "../dist/speech/create-provider.js";
import { GeminiSpeechProvider } from "../dist/speech/providers/gemini-provider.js";

const freshSignal = () => new AbortController().signal;
const credentials = {
  read: async () => ({ ok: true, value: "fake-gemini-key" }),
};
function settings(value = {}) {
  const parsed = parseSpeechSettings({
    enabled: true,
    provider: "gemini",
    ...value,
  });
  assert.equal(parsed.ok, true);
  return parsed.settings;
}
function provider(value = {}, reader = credentials, timeout = 15_000) {
  return new GeminiSpeechProvider(
    selectSpeechSettings(settings(value)),
    reader,
    timeout,
  );
}
function audioResponse(audio = {}) {
  return new Response(
    JSON.stringify({
      id: "test-interaction",
      status: "completed",
      steps: [
        {
          type: "model_output",
          content: [
            {
              type: "audio",
              mime_type: "audio/l16; rate=24000; channels=1",
              sample_rate: 24000,
              channels: 1,
              data: Buffer.from([0, 0, 255, 127, 0, 128, 255, 255]).toString(
                "base64",
              ),
              ...audio,
            },
          ],
        },
      ],
    }),
    { headers: { "content-type": "application/json" } },
  );
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "doorbell-gemini-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "speech.json");
}
function wavChunks(bytes) {
  const buffer = Buffer.from(bytes);
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
  assert.equal(buffer.readUInt32LE(4), buffer.length - 8);
  assert.equal(buffer.toString("ascii", 8, 12), "WAVE");
  const chunks = {};
  for (let pos = 12; pos < buffer.length; ) {
    const length = buffer.readUInt32LE(pos + 4);
    chunks[buffer.toString("ascii", pos, pos + 4)] = buffer.subarray(
      pos + 8,
      pos + 8 + length,
    );
    pos += 8 + length + (length % 2);
  }
  return chunks;
}

test("legacy OpenAI files stay unchanged on read and both voices survive provider switches", async (t) => {
  const path = await fixture(t);
  const original = JSON.stringify({
    enabled: true,
    model: "gpt-4o-mini-tts",
    voice: "coral",
    style: { tone: "Formal." },
  });
  await writeFile(path, original);
  const legacy = await loadSpeechSettings(path);
  assert.equal(legacy.ok, true);
  assert.equal(legacy.settings.provider, "openai");
  assert.equal(legacy.settings.providers.openai.voice, "coral");
  assert.equal(legacy.settings.providers.gemini.voice, "Kore");
  assert.equal(await readFile(path, "utf8"), original);
  for (const patch of [
    { provider: "gemini", voice: "Puck" },
    { provider: "openai" },
    { provider: "gemini" },
  ]) {
    assert.equal(
      (await configureSpeech({ settingsPath: path }, freshSignal(), patch)).ok,
      true,
    );
  }
  const saved = JSON.parse(await readFile(path, "utf8"));
  assert.equal(saved.provider, "gemini");
  assert.equal(saved.providers.openai.voice, "coral");
  assert.equal(saved.providers.gemini.voice, "Puck");
  assert.equal(saved.enabled, true);
  assert.equal(Object.hasOwn(saved, "style"), false);
  const before = await readFile(path, "utf8");
  assert.equal(
    (
      await configureSpeech({ settingsPath: path }, freshSignal(), {
        voice: "nova",
      })
    ).ok,
    false,
  );
  assert.equal(await readFile(path, "utf8"), before);
});

test("settings reject cross-provider values and malformed inactive profiles", () => {
  for (const value of [
    { provider: "unknown" },
    { provider: "gemini", voice: "nova" },
    { provider: "openai", voice: "Kore" },
    { provider: "gemini", model: "gpt-4o-mini-tts" },
    { providers: { gemini: { apiKey: "private-key" } } },
    { provider: "openai", providers: { gemini: { voice: "unknown" } } },
    { providers: { other: {} } },
    { providers: {}, voice: "nova" },
    { providers: null },
    { providers: { openai: [] } },
  ]) {
    const result = parseSpeechSettings(value);
    assert.equal(result.ok, false, JSON.stringify(value));
    assert.doesNotMatch(result.reason, /private-key/);
  }
});

test("interactive speech offers the selected provider's voices and Gemini consent text", async (t) => {
  const path = await fixture(t);
  const messages = [];
  const result = await configureSpeech(
    {
      settingsPath: path,
      prompts: {
        choose: async (message, values, current) => {
          messages.push(message);
          if (message === "Speech provider:") return "gemini";
          if (message === "Gemini voice:") {
            assert.equal(values.length, 30);
            assert.equal(current, "Kore");
            assert.equal(values.includes("nova"), false);
            return "Aoede";
          }
          return current;
        },
        confirm: async (message) => {
          messages.push(message);
          return true;
        },
        text: async (_message, current) => {
          return current;
        },
        secret: async () => {
          throw new Error("Must not ask for a key");
        },
      },
    },
    freshSignal(),
  );
  assert.equal(result.ok, true);
  const saved = (await loadSpeechSettings(path)).settings;
  assert.equal(saved.provider, "gemini");
  assert.equal(saved.providers.gemini.voice, "Aoede");
  assert.equal(saved.enabled, true);
  assert.ok(messages.some((message) => /sent to Gemini/.test(message)));
  assert.doesNotMatch(messages.join(" "), /[가-힣]/u);
});

test("Gemini API-key setup names its target and does not request speech preferences", async () => {
  const messages = [];
  const writes = [];
  const result = await configureApiKey(
    {
      provider: "gemini",
      credentials: {
        ...credentials,
        write: async (key) => {
          writes.push(key);
          return { ok: true };
        },
      },
      prompts: {
        choose: async (message) => {
          messages.push(message);
          return "set";
        },
        secret: async (message) => {
          messages.push(message);
          return " fake-gemini-key ";
        },
        confirm: async () => {
          throw new Error("Key entry must save without another confirmation");
        },
        text: async () => {
          throw new Error("Unexpected preference prompt");
        },
      },
    },
    freshSignal(),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(writes, ["fake-gemini-key"]);
  assert.ok(messages.every((message) => message.includes("Gemini")));
});

test("Gemini sends one private, stateless request and wraps PCM as an exact mono WAV", async (t) => {
  const requests = [];
  let reads = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const request = new Request(url, init);
    requests.push({
      url: request.url,
      headers: request.headers,
      body: await request.json(),
      redirect: request.redirect,
    });
    return audioResponse();
  });
  for (const prompt of [
    "Audio profile: Playful assistant.\nDirection: Warm and concise.",
    undefined,
  ]) {
    const result = await provider(
      { style: { tone: "Ignored legacy tone" } },
      {
        read: async () => {
          reads++;
          return { ok: true, value: "fake-gemini-key" };
        },
      },
    ).synthesize({
      message: " Please review the preview. ",
      speech: prompt ? { prompt, voice: "Puck" } : {},
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.audio.format, "wav");
    const chunks = wavChunks(result.audio.bytes);
    assert.equal(chunks["fmt "].readUInt16LE(0), 1);
    assert.equal(chunks["fmt "].readUInt16LE(2), 1);
    assert.equal(chunks["fmt "].readUInt32LE(4), 24000);
    assert.equal(chunks["fmt "].readUInt16LE(14), 16);
    assert.deepEqual(
      chunks.data,
      Buffer.from([0, 0, 255, 127, 0, 128, 255, 255]),
    );
    const request = requests.at(-1);
    assert.equal(
      request.url,
      "https://generativelanguage.googleapis.com/v1beta/interactions",
    );
    assert.equal(request.headers.get("x-goog-api-key"), "fake-gemini-key");
    assert.equal(request.redirect, "error");
    assert.equal(request.body.model, "gemini-3.1-flash-tts-preview");
    assert.deepEqual(request.body.generation_config.speech_config, [
      { voice: prompt ? "Puck" : "Kore" },
    ]);
    assert.deepEqual(request.body.response_format, {
      type: "audio",
    });
    assert.equal(request.body.store, false);
    assert.equal(request.body.stream, false);
    assert.ok(
      request.body.input.endsWith("Transcript:\nPlease review the preview."),
    );
    assert.equal(
      request.body.input.includes("Audio profile:"),
      prompt !== undefined,
    );
    if (prompt) assert.ok(request.body.input.includes(prompt));
    assert.doesNotMatch(request.body.input, /Ignored legacy tone/);
    assert.doesNotMatch(
      JSON.stringify(request.body),
      /fake-gemini-key|source|previous_interaction_id/,
    );
  }
  assert.equal(reads, 2);
  assert.equal(requests.length, 2);
});

test("disabled, missing-key, invalid-message, and cancelled requests never contact Gemini", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network");
  });
  let reads = 0;
  const reader = {
    read: async () => {
      reads++;
      return { ok: true, value: undefined };
    },
  };
  for (const options of [{ enabled: false }]) {
    assert.equal(
      (await provider(options, reader).synthesize({ message: "Review." })).ok,
      false,
    );
  }
  assert.equal(
    (await provider({}, reader).synthesize({ message: " " })).ok,
    false,
  );
  assert.equal(
    (
      await provider({}, reader).synthesize(
        { message: "Review." },
        AbortSignal.abort(),
      )
    ).ok,
    false,
  );
  assert.equal(reads, 0);
  assert.match(
    (await provider({}, reader).synthesize({ message: "Review." })).reason,
    /not configured/,
  );
  assert.equal(reads, 1);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("Gemini debug logging blocks buffered and streaming requests before key access or output", async (t) => {
  const previous = process.env.GOOGLE_GENAI_DEBUG;
  t.after(() => {
    if (previous === undefined) delete process.env.GOOGLE_GENAI_DEBUG;
    else process.env.GOOGLE_GENAI_DEBUG = previous;
  });
  const logs = ["group", "log", "warn", "error"].map((name) =>
    t.mock.method(console, name, () => {}),
  );
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected network"); });
  const read = t.mock.fn(async () => ({ ok: true, value: "fake-test-key" }));
  for (const value of ["1", "0", "false"]) {
    process.env.GOOGLE_GENAI_DEBUG = value;
    for (const playbackMode of ["buffered", "streaming"]) {
      const speech = provider({ playbackMode }, { read });
      assert.equal((await speech.check()).available, false);
      const result = await speech.synthesize({ message: "Private test message." });
      assert.equal(result.ok, false);
      assert.match(result.reason, /GOOGLE_GENAI_DEBUG/);
    }
  }
  assert.equal(read.mock.callCount(), 0);
  delete process.env.GOOGLE_GENAI_DEBUG;
  const changedDuringRead = provider({}, { read: async () => {
    process.env.GOOGLE_GENAI_DEBUG = "1";
    return { ok: true, value: "fake-test-key" };
  } });
  assert.match((await changedDuringRead.synthesize({ message: "Private test message." })).reason, /GOOGLE_GENAI_DEBUG/);
  assert.equal(fetch.mock.callCount(), 0);
  assert.ok(logs.every((method) => method.mock.callCount() === 0));
});

test("SDK environment configuration cannot switch Gemini endpoints or supply a missing key", async (t) => {
  const warnings = [];
  t.mock.method(console, "warn", (message) => warnings.push(String(message)));
  const overrides = {
    GEMINI_API_KEY: "unapproved-env-key",
    GOOGLE_API_KEY: "unapproved-env-key",
    GOOGLE_GENAI_USE_VERTEXAI: "true",
    GOOGLE_GENAI_USE_ENTERPRISE: "true",
    GOOGLE_GEMINI_BASE_URL: "https://wrong.invalid",
    GOOGLE_VERTEX_BASE_URL: "https://wrong.invalid",
  };
  const previous = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, overrides);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls++;
    const request = new Request(url, init);
    assert.equal(
      new URL(request.url).hostname,
      "generativelanguage.googleapis.com",
    );
    assert.equal(request.headers.get("x-goog-api-key"), "fake-gemini-key");
    return audioResponse();
  });
  assert.equal(
    (
      await provider(
        {},
        { read: async () => ({ ok: true, value: undefined }) },
      ).synthesize({ message: "Review." })
    ).ok,
    false,
  );
  assert.equal(calls, 0);
  assert.equal((await provider().synthesize({ message: "Review." })).ok, true);
  assert.equal(calls, 1);
  assert.doesNotMatch(warnings.join(" "), /unapproved-env-key|fake-gemini-key/);
});

test("Gemini HTTP and network errors do not retry or reveal remote content", async (t) => {
  for (const status of [400, 401, 403, 404, 429, 500, undefined]) {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      if (status === undefined) throw new Error("private-network-error");
      return new Response(
        JSON.stringify({
          error: { message: "private-remote-error", code: status },
        }),
        {
          status,
          headers: { "content-type": "application/json" },
        },
      );
    });
    const result = await provider().synthesize({ message: "Review." });
    assert.equal(result.ok, false);
    assert.equal(result.status, status);
    if (status !== undefined)
      assert.ok(result.reason.includes(`HTTP ${status}`));
    assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(result), /private-|fake-gemini-key/);
    t.mock.restoreAll();
  }
});

test("malformed, empty, oversized, and unsupported Gemini audio fail without replay", async (t) => {
  const invalid = [
    { data: "" },
    { data: "!invalid!" },
    { data: "AA==" },
    { data: "AP==" },
    { data: "AA AA" },
    { data: "A".repeat(3_840_004) },
    { mime_type: "audio/mp3" },
    { mime_type: "audio/l16;rate=48000" },
    { sample_rate: 48000 },
    { channels: 2 },
  ];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return audioResponse(invalid[calls - 1]);
  });
  for (const _audio of invalid) {
    const result = await provider().synthesize({ message: "Review." });
    assert.equal(result.ok, false);
    assert.match(result.reason, /invalid or unsupported/);
  }
  assert.equal(calls, invalid.length);
});

test("incomplete or text-only interactions are not accepted as speech", async (t) => {
  for (const status of ["in_progress", "completed"]) {
    t.mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            id: "fake",
            status,
            steps: [
              {
                type: "model_output",
                content: [{ type: "text", text: "private-remote-text" }],
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const result = await provider().synthesize({ message: "Review." });
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /private-remote-text/);
    t.mock.restoreAll();
  }
});

test("timeout and user cancellation abort response body consumption without retry", async (t) => {
  for (const cancel of [false, true]) {
    const controller = new AbortController();
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (url, init) => {
      calls++;
      const request = new Request(url, init);
      return new Response(
        new ReadableStream({
          start(stream) {
            const keepAlive = setTimeout(
              () => stream.error(new Error("Test deadline")),
              2000,
            );
            const abort = () => {
              clearTimeout(keepAlive);
              stream.error(request.signal.reason);
            };
            request.signal.addEventListener("abort", abort, { once: true });
            if (request.signal.aborted) abort();
            if (cancel) setTimeout(() => controller.abort(), 10);
          },
        }),
      );
    });
    const result = await provider(
      {},
      credentials,
      cancel ? 1000 : 25,
    ).synthesize({ message: "Review." }, controller.signal);
    assert.equal(result.ok, false);
    assert.match(result.reason, cancel ? /cancelled/ : /timed out/);
    assert.equal(calls, 1);
    t.mock.restoreAll();
  }
});

test("notify routes only to Gemini, ignores legacy tone, and deletes the temporary WAV", async (t) => {
  let requests = 0;
  let path;
  const current = settings({ style: { tone: "User tone." } });
  const before = structuredClone(current);
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests++;
    const request = new Request(url, init);
    assert.equal(
      new URL(request.url).hostname,
      "generativelanguage.googleapis.com",
    );
    const body = await request.json();
    assert.match(body.input, /Agent performance\./);
    assert.doesNotMatch(body.input, /User tone|private-source/);
    return audioResponse();
  });
  const result = await notify(
    {
      message: "Review.",
      source: "private-source",
      speech: { prompt: "Agent performance." },
    },
    {
      settings: { ok: true, settings: current },
      createProvider: (value) => createSpeechProvider(value, credentials),
      player: {
        id: "fake",
        supports: () => true,
        check: async () => ({ available: true }),
        play: async (request) => {
          assert.equal(request.format, "wav");
          path = request.path;
          wavChunks(await readFile(path));
          return { ok: true };
        },
      },
    },
  );
  assert.equal(requests, 1);
  assert.equal(result.delivery.mode, "speech");
  assert.deepEqual(current, before);
  await assert.rejects(access(path));
});

test("Gemini failure uses only the packaged sound, and WAV preflight avoids paid requests", async (t) => {
  for (const supportsWav of [true, false]) {
    let requests = 0;
    const played = [];
    t.mock.method(globalThis, "fetch", async () => {
      requests++;
      return new Response("private-error", { status: 500 });
    });
    const result = await notify(
      { message: "Review.", speech: { prompt: "Friendly." } },
      {
        settings: { ok: true, settings: settings() },
        createProvider: (value) => createSpeechProvider(value, credentials),
        player: {
          id: "fake",
          supports: () => supportsWav,
          check: async () => ({ available: true }),
          play: async (request) => {
            played.push(request.format);
            return { ok: true };
          },
        },
      },
    );
    assert.equal(result.delivery.mode, "sound");
    assert.equal(requests, supportsWav ? 1 : 0);
    assert.deepEqual(played, ["mp3"]);
    assert.doesNotMatch(JSON.stringify(result), /private-error/);
    t.mock.restoreAll();
  }
});
