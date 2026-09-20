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
import { saveSpeechSettings } from "../dist/config/save-speech-settings.js";
import { configureSpeech } from "../dist/commands/configure-speech.js";
import { configureApiKey } from "../dist/commands/configure-api-key.js";
import { notify } from "../dist/commands/notify.js";
import { OpenAiSpeechProvider } from "../dist/speech/providers/openai-provider.js";

const signal = () => new AbortController().signal;
function settings(value) {
  const parsed = parseSpeechSettings(value);
  assert.equal(parsed.ok, true);
  return parsed.settings;
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "doorbell-settings-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "speech.json");
}
function prompts(overrides = {}) {
  return {
    choose: async (_message, _values, current) => current,
    confirm: async () => true,
    text: async (_message, current) => current,
    secret: async () => " fake-test-key ",
    ...overrides,
  };
}

test("missing settings use nova, buffered, disabled speech, and no custom tone", () => {
  assert.deepEqual(settings(undefined), {
    enabled: false,
    provider: "openai",
    providers: {
      openai: { model: "gpt-4o-mini-tts", voice: "nova" },
      gemini: { model: "gemini-3.1-flash-tts-preview", voice: "Kore" },
    },
    playbackMode: "buffered",
    playbackVolume: 1,
  });
  assert.equal(Object.hasOwn(settings({ enabled: true }), "style"), false);
});

test("legacy tones are ignored without changing input and invalid shapes remain rejected", () => {
  for (const tone of [
    "Dry wit, warm delivery, and short pauses.",
    "neutral",
    "friendly",
    "calm",
    "차분한 말투",
  ]) {
    const original = { style: { tone } };
    assert.equal(Object.hasOwn(settings(original), "style"), false);
    assert.deepEqual(original, { style: { tone } });
  }
  for (const tone of [null, true, 1, {}, []]) {
    const result = parseSpeechSettings({ style: { tone } });
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.reason, /private-marker/);
  }
});

test("explicit existing preferences survive and unknown/secret fields are rejected", () => {
  const original = { voice: "alloy", style: { tone: "neutral" } };
  const parsed = settings(original);
  assert.equal(parsed.providers.openai.voice, "alloy");
  assert.equal(Object.hasOwn(parsed, "style"), false);
  assert.equal(original.style.tone, "neutral");
  for (const bad of [
    { apiKey: "secret" },
    { agentTone: "x" },
    { instructions: "x" },
    { speech: { prompt: "x" } },
    { style: { instructions: "x" } },
    { voice: "unknown" },
  ]) {
    assert.equal(parseSpeechSettings(bad).ok, false);
  }
});

test("speech can be enabled with defaults without a prompt or credential store", async (t) => {
  const path = await fixture(t);
  assert.equal(
    (await configureSpeech({ settingsPath: path }, signal(), { enabled: true }))
      .ok,
    true,
  );
  const loaded = await loadSpeechSettings(path);
  assert.equal(loaded.settings.enabled, true);
  assert.equal(loaded.settings.providers.openai.voice, "nova");
  assert.equal(Object.hasOwn(loaded.settings, "style"), false);
});

test("legacy settings are unchanged on read and drop tone on the next settings write", async (t) => {
  const path = await fixture(t);
  const original = JSON.stringify({
    enabled: true,
    voice: "coral",
    playbackMode: "streaming",
    style: { tone: "User tone" },
  });
  await writeFile(path, original);
  const legacy = await loadSpeechSettings(path);
  assert.equal(Object.hasOwn(legacy.settings, "style"), false);
  assert.equal(await readFile(path, "utf8"), original);
  await configureSpeech({ settingsPath: path }, signal(), { voice: "nova" });
  const loaded = await loadSpeechSettings(path);
  assert.equal(loaded.settings.enabled, true);
  assert.equal(loaded.settings.playbackMode, "streaming");
  assert.equal(
    Object.hasOwn(JSON.parse(await readFile(path, "utf8")), "style"),
    false,
  );
  assert.equal(loaded.settings.providers.openai.voice, "nova");
  assert.equal(loaded.settings.enabled, true);
});

test("invalid input, invalid files, and cancellation preserve settings bytes", async (t) => {
  const path = await fixture(t);
  await saveSpeechSettings({ voice: "coral" }, path);
  const before = await readFile(path, "utf8");
  for (const patch of [
    { tone: "x".repeat(501) },
    { tone: "x", resetTone: true },
    { voice: "unknown" },
  ]) {
    assert.equal(
      (await configureSpeech({ settingsPath: path }, signal(), patch)).ok,
      false,
    );
    assert.equal(await readFile(path, "utf8"), before);
  }
  const cancelled = await configureSpeech(
    { settingsPath: path },
    AbortSignal.abort(),
    { enabled: true },
  );
  assert.equal(cancelled.cancelled, true);
  assert.equal(await readFile(path, "utf8"), before);
  await writeFile(path, "{invalid", "utf8");
  assert.equal(
    (await configureSpeech({ settingsPath: path }, signal(), { enabled: true }))
      .ok,
    false,
  );
  assert.equal(await readFile(path, "utf8"), "{invalid");
});

test("interactive speech asks for provider, activation, playback mode, default voice, volume, and saving", async (t) => {
  const path = await fixture(t);
  const questions = [];
  const result = await configureSpeech(
    {
      settingsPath: path,
      prompts: prompts({
        choose: async (message, _values, current) => {
          questions.push(message);
          return current;
        },
        confirm: async (message) => {
          questions.push(message);
          return true;
        },
        text: async (message, current, validate) => {
          questions.push(message);
          assert.equal(current, "1");
          assert.equal(validate("1.5"), true);
          assert.equal(typeof validate("loud"), "string");
          return "1.5";
        },
        secret: async () => {
          throw new Error("No credentials");
        },
      }),
    },
    signal(),
  );
  assert.equal(result.ok, true);
  assert.equal(questions.length, 6);
  assert.deepEqual(
    [questions[0], questions[2], questions[3], questions[4], questions[5]],
    [
      "Speech provider:",
      "Playback mode:",
      "OpenAI voice:",
      "Speech playback volume (0.25-4; 1 keeps the original level):",
      "Save speech settings?",
    ],
  );
  assert.equal(
    Object.hasOwn((await loadSpeechSettings(path)).settings, "style"),
    false,
  );
  assert.equal((await loadSpeechSettings(path)).settings.playbackVolume, 1.5);
});

test("declining speech save leaves the existing file untouched", async (t) => {
  const path = await fixture(t);
  await saveSpeechSettings({ voice: "coral" }, path);
  const before = await readFile(path, "utf8");
  const result = await configureSpeech(
    {
      settingsPath: path,
      prompts: prompts({
        confirm: async (message) => !message.startsWith("Save"),
      }),
    },
    signal(),
  );
  assert.equal(result.cancelled, true);
  assert.equal(await readFile(path, "utf8"), before);
});

test("API-key set/remove/cancel never depend on speech configuration or read secrets", async () => {
  const calls = [];
  const confirmations = [];
  const credentials = {
    read: async () => {
      throw new Error("Unexpected credential read");
    },
    write: async (key) => {
      calls.push(["set", key]);
      return { ok: true, value: undefined };
    },
    remove: async () => {
      calls.push(["remove"]);
      return { ok: true, value: true };
    },
  };
  for (const action of ["set", "remove", "cancel"]) {
    const result = await configureApiKey(
      {
        credentials,
        prompts: prompts({
          choose: async (_message, values, current) => {
            assert.deepEqual(values, ["cancel", "set", "remove"]);
            assert.equal(current, "cancel");
            return action;
          },
          secret: async () => {
            assert.equal(action, "set");
            return " fake-test-key ";
          },
          confirm: async (message) => {
            assert.equal(action, "remove", "Only removal needs confirmation");
            confirmations.push(message);
            return true;
          },
        }),
      },
      signal(),
    );
    assert.equal(result.ok, action !== "cancel");
    if (action === "cancel") {
      assert.equal(result.cancelled, true);
      assert.equal(
        result.reason,
        "Configuration cancelled. Nothing was saved.",
      );
    }
  }
  assert.deepEqual(calls, [["set", "fake-test-key"], ["remove"]]);
  assert.deepEqual(confirmations, ["Remove the saved OpenAI API key?"]);
});

test("key cancellation does not mutate and native failures do not expose secrets", async () => {
  let writes = 0;
  const credentials = {
    read: async () => {
      throw new Error();
    },
    write: async () => {
      writes++;
      throw new Error("fake-secret-must-not-leak");
    },
    remove: async () => {
      throw new Error();
    },
  };
  for (const action of ["set", "remove"]) {
    const controller = new AbortController();
    const result = await configureApiKey(
      {
        credentials,
        prompts: prompts({
          choose: async () => action,
          secret: async () => {
            controller.abort();
            return "fake-test-key";
          },
          confirm: async () => {
            assert.equal(action, "remove");
            return false;
          },
        }),
      },
      controller.signal,
    );
    assert.equal(result.cancelled, true);
    assert.equal(writes, 0);
  }
  const failure = await configureApiKey(
    { credentials, prompts: prompts({ choose: async () => "set" }) },
    signal(),
  );
  assert.equal(failure.ok, false);
  assert.match(failure.reason, /may already/);
  assert.doesNotMatch(failure.reason, /fake-secret/);
});

for (const [name, userTone, instructions, expected] of [
  [
    "legacy tone ignored",
    "Measured and formal.",
    "Bouncy and cheerful.",
    "Bouncy and cheerful.",
  ],
  ["agent fallback", undefined, "Bouncy and cheerful.", "Bouncy and cheerful."],
  ["no tone context", undefined, undefined, undefined],
]) {
  test(
    "notify passes " + name + " without persisting speech options",
    async () => {
      const selected = settings({
        enabled: true,
        ...(userTone === undefined ? {} : { style: { tone: userTone } }),
      });
      const before = structuredClone(selected);
      let effective;
      let playedPath;
      const result = await notify(
        {
          message: " Please review the preview. ",
          source: "private-source",
          speech: {
            ...(instructions ? { instructions } : {}),
            voice: "coral",
            speed: 1.25,
          },
        },
        {
          settings: { ok: true, settings: selected },
          player: {
            id: "fake",
            supports: () => true,
            check: async () => ({ available: true }),
            play: async (request) => {
              playedPath = request.path;
              await access(playedPath);
              return { ok: true };
            },
          },
          createProvider: (value) => {
            effective = value;
            return {
              id: "fake",
              synthesize: async (request) => {
                assert.equal(request.message, "Please review the preview.");
                assert.equal(request.speech.instructions, expected);
                assert.equal(request.speech.voice, "coral");
                assert.equal(request.speech.speed, 1.25);
                assert.equal(Object.hasOwn(request, "source"), false);
                return {
                  ok: true,
                  audio: {
                    mode: "buffered",
                    format: "wav",
                    bytes: new Uint8Array([1, 2, 3]),
                  },
                };
              },
            };
          },
        },
      );
      assert.equal(result.delivery.ok, true);
      assert.equal(result.delivery.mode, "speech");
      assert.equal(Object.hasOwn(effective, "style"), false);
      assert.equal(effective.voice, "nova");
      assert.deepEqual(selected, before);
      await assert.rejects(access(playedPath));
    },
  );
}

test("disabled speech does not create a provider, even with speech options", async () => {
  const formats = [];
  const result = await notify(
    { message: "Please review.", speech: { instructions: "Cheerful" } },
    {
      settings: { ok: true, settings: settings() },
      player: {
        id: "fake",
        play: async (request) => {
          formats.push(request.format);
          return { ok: true };
        },
      },
      createProvider: () => {
        throw new Error("must not call");
      },
    },
  );
  assert.equal(result.delivery.mode, "sound");
  assert.deepEqual(formats, ["mp3"]);
});

test("OpenAI receives per-call instructions, voice and speed; a later call returns to defaults", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  });
  const provider = new OpenAiSpeechProvider(
    selectSpeechSettings(
      settings({
        enabled: true,
        playbackVolume: 1.5,
        style: { tone: "Legacy tone must be ignored" },
      }),
    ),
    {
      read: async () => ({ ok: true, value: "fake-test-key" }),
    },
  );
  for (const speech of [
    {
      instructions: "Warm, playful, concise; pause between sentences.",
      voice: "coral",
      speed: 0.8,
    },
    {},
  ]) {
    const result = await provider.synthesize({
      message: "Please review the preview.",
      speech,
    });
    assert.equal(result.ok, true);
    const body = requests.at(-1);
    assert.equal(body.voice, speech.voice ?? "nova");
    assert.equal(body.model, "gpt-4o-mini-tts");
    assert.equal(body.instructions, speech.instructions);
    assert.equal(
      Object.hasOwn(body, "instructions"),
      speech.instructions !== undefined,
    );
    assert.equal(body.speed, speech.speed);
    assert.equal(Object.hasOwn(body, "speed"), speech.speed !== undefined);
    assert.equal(body.input, "Please review the preview.");
    assert.equal(body.response_format, "wav");
    assert.equal(Object.hasOwn(body, "source"), false);
    assert.equal(Object.hasOwn(body, "playbackVolume"), false);
    assert.equal(Object.hasOwn(body, "volume"), false);
  }
  assert.equal(requests.length, 2);
});

test("failed speech makes one API request then plays the offline sound", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return new Response(
      JSON.stringify({ error: { message: "private-remote-error" } }),
      { status: 401 },
    );
  });
  const formats = [];
  const result = await notify(
    { message: "Please review.", speech: { instructions: "Cheerful" } },
    {
      settings: { ok: true, settings: settings({ enabled: true }) },
      player: {
        id: "fake",
        supports: () => true,
        check: async () => ({ available: true }),
        play: async (request) => {
          formats.push(request.format);
          return { ok: true };
        },
      },
      createProvider: (value) =>
        new OpenAiSpeechProvider(value, {
          read: async () => ({ ok: true, value: "fake-key" }),
        }),
    },
  );
  assert.equal(requests, 1);
  assert.equal(result.delivery.mode, "sound");
  assert.deepEqual(formats, ["mp3"]);
  assert.doesNotMatch(JSON.stringify(result), /private-remote-error|fake-key/);
});
