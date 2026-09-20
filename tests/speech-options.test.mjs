import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseSpeechSettings,
  selectSpeechSettings,
} from "../dist/config/parse-speech-settings.js";
import { createSpeechProvider } from "../dist/speech/create-provider.js";
import { notify } from "../dist/commands/notify.js";

test("both adapters reject invalid performance controls before credential or network access", async (t) => {
  let reads = 0;
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network");
  });
  const credentials = {
    read: async () => {
      reads++;
      throw new Error("Unexpected key read");
    },
  };
  for (const provider of ["openai", "gemini"]) {
    const selected = selectSpeechSettings(
      parseSpeechSettings({ enabled: true, provider }).settings,
    );
    const adapter = createSpeechProvider(selected, credentials);
    const invalid = [
      null,
      [],
      "private-marker",
      { apiKey: "private-marker" },
      { model: "other" },
      { voice: "private-marker" },
      { instructions: 7 },
      { prompt: false },
      { instructions: "x".repeat(2001) },
      { prompt: "😀".repeat(1001) },
      { speed: NaN },
      { speed: Infinity },
      { speed: 0.24 },
      { speed: 4.01 },
      { speed: "1" },
      { instructions: "Warm", prompt: "Calm" },
      ...(provider === "openai"
        ? [{ voice: "Kore" }, { prompt: "Calm" }]
        : [{ voice: "nova" }, { instructions: "Calm" }, { speed: 1 }]),
    ];
    for (const speech of invalid) {
      const result = await adapter.synthesize({ message: "Review.", speech });
      assert.equal(result.ok, false);
      assert.doesNotMatch(result.reason, /private-marker/);
    }
  }
  assert.equal(reads, 0);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("invalid notify controls never turn into a successful fallback sound, even when disabled", async () => {
  for (const enabled of [false, true]) {
    await assert.rejects(
      notify(
        { message: "Review.", speech: { prompt: "Wrong provider" } },
        {
          settings: parseSpeechSettings({ provider: "openai", enabled }),
          player: {
            play: async () => assert.fail("Unexpected playback"),
            check: async () => assert.fail("Unexpected check"),
          },
          createProvider: () => assert.fail("Unexpected provider"),
        },
      ),
      /OpenAI uses --instructions/,
    );
  }
});

test("OpenAI accepts exact direction and speed boundaries and preserves expressive text", async (t) => {
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(new Uint8Array([1, 2, 3]));
  });
  const provider = createSpeechProvider(
    selectSpeechSettings(parseSpeechSettings({ enabled: true }).settings),
    { read: async () => ({ ok: true, value: "fake-key" }) },
  );
  for (const [instructions, speed] of [
    ["😀".repeat(1000), 0.25],
    ['Quiet.\nEmphasize "review"; $() is literal.', 4],
    [" \n ", undefined],
  ]) {
    const speech = { instructions, ...(speed === undefined ? {} : { speed }) };
    const before = structuredClone(speech);
    assert.equal(
      (await provider.synthesize({ message: "Please review.", speech })).ok,
      true,
    );
    assert.deepEqual(speech, before);
    assert.equal(bodies.at(-1).instructions, instructions.trim() || undefined);
    assert.equal(bodies.at(-1).speed, speed);
  }
  assert.equal(bodies.length, 3);
});
