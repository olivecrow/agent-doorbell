import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import wavefile from "wavefile";
import { configureGemini } from "../dist/commands/configure-gemini.js";
import { GeminiCatalog } from "../dist/speech/providers/gemini-catalog.js";

const model = "gemini-3.8-flash-lite-tts";
const legacyModel = "gemini-3.1-flash-tts-preview";
const voice = { id: "voice_sample123", name: "My narrator", type: "prompted", canPreview: true };
const kore = { id: "Kore", name: "Kore", type: "prebuilt", canPreview: false };
const signal = new AbortController().signal;
const credentials = { read: async () => ({ ok: true, value: "test-catalog-key" }) };

test("live catalogs follow each pagination contract and expose supported IDs and safe labels", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const request = new URL(url);
    requests.push(request.pathname);
    assert.equal(request.origin, "https://generativelanguage.googleapis.com");
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).get("x-goog-api-key"), "test-catalog-key");
    if (request.pathname === "/v1beta/models") {
      if (!request.searchParams.has("pageToken")) return Response.json({
        models: [{ name: "models/gemini-3.8-flash" }], nextPageToken: "models+/=",
      });
      assert.equal(request.searchParams.get("pageToken"), "models+/=");
      return Response.json({ models: [{ name: `models/${model}` }] });
    }
    assert.equal(request.pathname, "/v1beta/voices");
    if (!request.searchParams.has("pageToken")) return Response.json({
      voices: [{ id: voice.id, display_name: "\x1b[31mMy narrator\x1b[0m", type: "prompted", prompted: { input: "Private" } }],
      next_page_token: "voices+/=",
    });
    assert.equal(request.searchParams.get("pageToken"), "voices+/=");
    return Response.json({ voices: [{ id: "kore", type: "prebuilt" }, { id: "../unsafe", type: "prebuilt" }] });
  });
  const catalog = new GeminiCatalog(credentials);
  const [models, voices] = await Promise.all([catalog.listModels(signal), catalog.listVoices(signal)]);
  assert.deepEqual(models, [{ id: model, name: model }]);
  assert.deepEqual(voices, [kore, voice]);
  assert.equal(requests.length, 4);
});

test("preview downloads only an existing designed voice sample and rejects unusable audio", async (t) => {
  const wav = new wavefile.WaveFile();
  wav.fromScratch(1, 24_000, "16", [0, 12, -12, 0]);
  const bytes = Buffer.from(wav.toBuffer());
  let data = bytes.toString("base64");
  const fetch = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), `https://generativelanguage.googleapis.com/v1beta/voices/${voice.id}`);
    assert.equal(init.method ?? "GET", "GET");
    return Response.json({ id: voice.id, type: "prompted", sample_audio: { mime_type: "audio/wav", data } });
  });
  const catalog = new GeminiCatalog(credentials);
  assert.throws(() => catalog.getVoiceSample("Kore", signal), /designed voices only/);
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(await catalog.getVoiceSample(voice.id, signal), bytes);
  data = Buffer.alloc(48).toString("base64");
  await assert.rejects(catalog.getVoiceSample(voice.id, signal), /invalid WAV/);
});

test("credential failures and provider failures leave keys and response bodies out of errors", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("test-catalog-key", { status: 403 }));
  const unconfigured = new GeminiCatalog({ read: async () => ({ ok: true, value: undefined }) });
  await assert.rejects(unconfigured.listModels(signal), /API key is not configured/);
  assert.equal(fetch.mock.callCount(), 0);
  const catalog = new GeminiCatalog(credentials);
  await assert.rejects(catalog.listVoices(signal), { message: "Gemini catalog request failed (HTTP 403)." });
  assert.equal(fetch.mock.callCount(), 1);
});

test("online selection previews before saving, preserves preferences, and rejects incompatible choices", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "doorbell-gemini-catalog-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settingsPath = join(directory, "speech.json");
  const original = JSON.stringify({ enabled: false, voice: "coral", playbackVolume: 1.5 });
  await writeFile(settingsPath, original);
  const actions = [model, "Play preview", "Use this voice"];
  const dependencies = {
    settingsPath,
    catalog: {
      listModels: async () => [{ id: legacyModel }, { id: model }],
      listVoices: async () => [kore, voice],
    },
    prompts: {
      choose: async () => actions.shift(),
      search: async (_message, choices) => {
        assert.match(choices[1].name, /Preview available/);
        return voice.id;
      },
      confirm: async () => true,
    },
    preview: async (id) => {
      assert.equal(id, voice.id);
      assert.equal(await readFile(settingsPath, "utf8"), original);
    },
    warning: assert.fail,
  };
  const invalid = await configureGemini(dependencies, signal, { model: legacyModel, voice: voice.id });
  assert.equal(invalid.ok, false);
  assert.equal(await readFile(settingsPath, "utf8"), original);
  assert.deepEqual(await configureGemini(dependencies, signal), { ok: true });
  assert.deepEqual(actions, []);
  const saved = JSON.parse(await readFile(settingsPath, "utf8"));
  assert.deepEqual(saved.providers.gemini, { model, voice: voice.id });
  assert.equal(saved.providers.openai.voice, "coral");
  assert.equal(saved.provider, "gemini");
  assert.equal(saved.enabled, false);
  assert.equal(saved.playbackVolume, 1.5);
  assert.deepEqual(await configureGemini(dependencies, signal, { model: legacyModel, voice: "kore" }), { ok: true });
  const legacy = JSON.parse(await readFile(settingsPath, "utf8"));
  assert.deepEqual(legacy.providers.gemini, { model: legacyModel, voice: "Kore" });
});
