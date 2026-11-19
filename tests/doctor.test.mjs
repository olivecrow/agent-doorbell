import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctor } from "../dist/commands/doctor.js";
import { getAppPaths } from "../dist/config/app-path.js";
import { saveSpeechSettings } from "../dist/config/save-speech-settings.js";

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "doorbell-doctor-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return {
    paths: getAppPaths(dir),
    player: {
      id: "fake",
      supports: () => true,
      check: async () => ({ available: true }),
      play: async () => assert.fail("No implicit playback"),
    },
  };
}
test("doctor reports safe credential states and does not write settings, synthesize, or play", async (t) => {
  const deps = await setup(t);
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("No diagnostic network"),
  );
  const result = await doctor({
    ...deps,
    credentials: (provider) => ({
      read: async () => ({
        ok: true,
        value: provider === "openai" ? "fake-secret-marker" : undefined,
      }),
    }),
  });
  assert.deepEqual(result.credentials, {
    openai: "configured",
    gemini: "missing",
  });
  assert.equal(result.soundReady, true);
  assert.equal(result.speechReady, false);
  assert.equal(result.ok, true);
  assert.doesNotMatch(JSON.stringify(result), /fake-secret-marker/);
  await assert.rejects(access(deps.paths.speechSettingsPath));
});
test("enabled speech with a missing key and unavailable storage fails readiness safely", async (t) => {
  const deps = await setup(t);
  await saveSpeechSettings(
    { enabled: true, provider: "gemini" },
    deps.paths.speechSettingsPath,
  );
  const result = await doctor({
    ...deps,
    credentials: () => ({
      read: async () => {
        throw new Error("private-native-detail");
      },
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.soundReady, true);
  assert.equal(result.speechReady, false);
  assert.equal(result.credentials.gemini, "unavailable");
  assert.doesNotMatch(JSON.stringify(result), /private-native-detail/);
});
test("doctor reports Gemini debug logging as a speech blocker with sound ready", async (t) => {
  const deps = await setup(t);
  const previous = process.env.GOOGLE_GENAI_DEBUG;
  process.env.GOOGLE_GENAI_DEBUG = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.GOOGLE_GENAI_DEBUG;
    else process.env.GOOGLE_GENAI_DEBUG = previous;
  });
  await saveSpeechSettings({ enabled: true, provider: "gemini" }, deps.paths.speechSettingsPath);
  const result = await doctor({
    ...deps,
    credentials: () => ({ read: async () => ({ ok: true, value: "fake-test-key" }) }),
  });
  assert.equal(result.speechReady, false);
  assert.equal(result.soundReady, true);
  assert.equal(result.credentials.gemini, "configured");
  assert.ok(result.notes.some((note) => note.includes("GOOGLE_GENAI_DEBUG")));
  assert.doesNotMatch(JSON.stringify(result), /fake-test-key/);
});

test("doctor only plays when explicitly requested and propagates test failure and cancellation", async (t) => {
  const deps = await setup(t);
  let plays = 0;
  const options = {
    ...deps,
    credentials: () => ({ read: async () => ({ ok: true, value: undefined }) }),
    playTest: async () => {
      plays++;
      return { ok: false, reason: "No device" };
    },
  };
  const result = await doctor(options);
  assert.equal(plays, 1);
  assert.equal(result.ok, false);
  assert.equal(result.playbackTest.reason, "No device");
  await assert.rejects(doctor(options, AbortSignal.abort()));
  assert.equal(plays, 1);
});
