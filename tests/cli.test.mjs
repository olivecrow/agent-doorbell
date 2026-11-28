import assert from "node:assert/strict";
import "./fixtures/speech-temp.mjs";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
async function environment(t) {
  const dir = await mkdtemp(join(tmpdir(), "doorbell-cli-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function run(dir, args, preload, input, extraEnv = {}) {
  try {
    const pending = exec(
      process.execPath,
      [...(preload ? ["--import", preload] : []), cli, ...args],
      {
        cwd: dir,
        windowsHide: true,
        timeout: 10000,
        env: {
          ...process.env,
          DOORBELL_CONFIG_DIR: dir,
          DOORBELL_QUEUE_DIR: join(dir, "queue"),
          ...extraEnv,
        },
      },
    );
    if (input !== undefined) pending.child.stdin.end(input);
    return { code: 0, ...(await pending) };
  } catch (error) {
    if (typeof error.code !== "number") throw error;
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test("help and agent instructions are English and work outside the package directory", async (t) => {
  const dir = await environment(t);
  for (const args of [
    [],
    ["--help"],
    ["configure"],
    ["configure", "api-key", "--help"],
  ]) {
    const result = await run(dir, args);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /configure api-key/);
    assert.match(result.stdout, /configure speech/);
    assert.match(result.stdout, /nova/);
    assert.doesNotMatch(result.stdout, /[가-힣]/u);
  }
  const instructions = await run(dir, ["agent-instructions"]);
  assert.equal(instructions.code, 0);
  assert.match(instructions.stdout, /--instructions/);
  assert.match(instructions.stdout, /--prompt/);
  assert.match(
    instructions.stdout,
    /https:\/\/developers\.openai\.com\/api\/docs\/guides\/text-to-speech/,
  );
  assert.match(
    instructions.stdout,
    /https:\/\/ai\.google\.dev\/gemini-api\/docs\/speech-generation/,
  );
  assert.match(instructions.stdout, /"provider": "openai"/);
  assert.match(instructions.stdout, /"defaultVoice": "nova"/);
  assert.match(instructions.stdout, /personality/i);
  assert.match(
    instructions.stdout,
    /language they are using in the current conversation/,
  );
  assert.doesNotMatch(instructions.stdout, /[가-힣]/u);
});

test("CLI configures speech defaults without a tone setting or API key", async (t) => {
  const dir = await environment(t);
  let result = await run(dir, ["configure", "speech", "--show"]);
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout).providers.openai.voice, "nova");
  await assert.rejects(access(join(dir, "speech.json")));
  result = await run(dir, ["configure", "speech", "--enable"]);
  assert.equal(result.code, 0);
  let saved = JSON.parse(await readFile(join(dir, "speech.json"), "utf8"));
  assert.equal(saved.enabled, true);
  assert.equal(Object.hasOwn(saved, "style"), false);
  result = await run(dir, [
    "configure",
    "speech",
    "--voice",
    "coral",
    "--volume",
    "1.5",
  ]);
  assert.equal(result.code, 0);
  saved = JSON.parse(await readFile(join(dir, "speech.json"), "utf8"));
  assert.equal(Object.hasOwn(saved, "style"), false);
  assert.equal(saved.providers.openai.voice, "coral");
  assert.equal(saved.playbackVolume, 1.5);
  assert.equal(saved.enabled, true);
  result = await run(dir, ["configure", "speech", "--disable"]);
  assert.equal(result.code, 0);
  assert.equal(
    JSON.parse(await readFile(join(dir, "speech.json"), "utf8")).enabled,
    false,
  );
});

test("configuration errors reject conflicting flags and never echo key-like input", async (t) => {
  const dir = await environment(t);
  for (const args of [
    ["configure", "api-key", "fake-secret-marker"],
    ["configure", "speech", "--api-key", "fake-secret-marker"],
    ["configure", "speech", "--enable", "--disable"],
    ["configure", "speech", "--tone", "x", "--reset-tone"],
    ["configure", "speech", "--tone", "x"],
    ["configure", "speech", "--reset-tone"],
    ["configure", "speech", "--show", "--enable"],
    ["configure", "speech", "--voice", "unknown"],
    ["configure", "speech", "--volume", "NaN"],
    ["configure", "speech", "--volume", "Infinity"],
    ["configure", "speech", "--volume", "0"],
    ["configure", "speech", "--volume", "4.01"],
    ["configure", "speech", "--show", "--volume", "1.5"],
    ["notify", "--message", "Review.", "--volume", "1.5"],
    ["configure", "speech", "--provider", "unknown"],
    ["configure", "speech", "--provider", "gemini", "--voice", "nova"],
    ["configure", "speech", "--provider", "openai", "--voice", "Kore"],
    ["configure", "speech", "--list-voices", "--enable"],
    ["configure", "api-key", "--provider", "unknown"],
    ["configure", "api-key", "--provider", "gemini", "fake-secret-marker"],
    ["configure", "speech", "--tone", "x".repeat(501)],
    ["notify", "--message", "Review.", "--api-key", "fake-secret-marker"],
    ["notify", "--message", "Review.", "--voice", "unknown"],
    ["notify", "--message", "Review.", "--provider", "gemini"],
    ["notify", "--message", "Review.", "--agent-tone", "x".repeat(501)],
    ["notify", "--agent-tone", "Cheerful"],
    ["notify", "--message", "Review.", "--agent-tone", "Cheerful"],
    ["notify", "--message", "Review.", "--instructions", "x".repeat(2001)],
    ["notify", "--message", "Review.", "--prompt", "x".repeat(2001)],
    [
      "notify",
      "--message",
      "Review.",
      "--instructions",
      "Warm",
      "--prompt",
      "Calm",
    ],
    ...["NaN", "Infinity", "0.24", "4.01", "fast"].map((speed) => [
      "notify",
      "--message",
      "Review.",
      "--speed",
      speed,
    ]),
  ]) {
    const result = await run(dir, args);
    assert.equal(result.code, 2, args.join(" ").slice(0, 80));
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /fake-secret-marker|[가-힣]/u,
    );
  }
  await assert.rejects(access(join(dir, "speech.json")));
});

test("CLI lists provider voices without writes and preserves each voice when switching", async (t) => {
  const dir = await environment(t);
  for (const [provider, count, defaultVoice] of [
    ["openai", 13, "nova"],
    ["gemini", 30, "Kore"],
  ]) {
    const result = await run(dir, [
      "configure",
      "speech",
      "--list-voices",
      "--provider",
      provider,
    ]);
    assert.equal(result.code, 0);
    const catalog = JSON.parse(result.stdout);
    assert.equal(catalog.provider, provider);
    assert.equal(catalog.voices.length, count);
    assert.equal(catalog.defaultVoice, defaultVoice);
  }
  await assert.rejects(access(join(dir, "speech.json")));
  for (const args of [
    ["--provider", "gemini", "--voice", "Aoede", "--enable"],
    ["--provider", "openai", "--voice", "coral"],
    ["--provider", "gemini"],
  ])
    assert.equal((await run(dir, ["configure", "speech", ...args])).code, 0);
  const saved = JSON.parse(await readFile(join(dir, "speech.json"), "utf8"));
  assert.equal(saved.provider, "gemini");
  assert.equal(saved.providers.gemini.voice, "Aoede");
  assert.equal(saved.providers.openai.voice, "coral");
  assert.equal(saved.enabled, true);
  const listed = await run(dir, ["configure", "speech", "--list-voices"]);
  assert.equal(JSON.parse(listed.stdout).provider, "gemini");
  const instructions = await run(dir, ["agent-instructions"]);
  assert.equal(instructions.code, 0);
  assert.match(instructions.stdout, /"provider": "gemini"/);
  assert.match(instructions.stdout, /"defaultVoice": "Aoede"/);
  const key = await run(dir, ["configure", "api-key", "--provider", "gemini"]);
  assert.equal(key.code, 1);
  assert.match(key.stderr, /interactive terminal/i);
});

test("Gemini CLI lists live choices, plays a downloaded preview, and saves the chosen pair", async (t) => {
  const dir = await environment(t);
  const preload = join(dir, "catalog-preload.mjs");
  const model = "gemini-3.8-flash-lite-tts";
  const voice = "voice_test42";
  const credentialModule = new URL("../dist/config/keyring-credential-store.js", import.meta.url).href;
  const playerModule = new URL("../dist/audio/ffplay-player.js", import.meta.url).href;
  await writeFile(preload, `
    import assert from 'node:assert/strict';
    import { readFile, writeFile } from 'node:fs/promises';
    import { basename, join } from 'node:path';
    import { KeyringCredentialStore } from ${JSON.stringify(credentialModule)};
    import { FfplayAudioPlayer } from ${JSON.stringify(playerModule)};
    const voice = ${JSON.stringify(voice)};
    const model = ${JSON.stringify(model)};
    const sample = Buffer.from('524946462600000057415645666d74201000000001000100c05d000080bb00000200100064617461020000000000', 'hex');
    KeyringCredentialStore.prototype.read = async () => ({ ok: true, value: 'fake-catalog-key' });
    globalThis.fetch = async (url, init) => {
      assert.equal(new Headers(init.headers).get('x-goog-api-key'), 'fake-catalog-key');
      const path = new URL(url).pathname;
      if (path === '/v1beta/models') return Response.json({ models: [{ name: 'models/' + model }] });
      const entry = { id: voice, type: 'prompted', display_name: 'My voice' };
      if (path === '/v1beta/voices') return Response.json({ voices: [entry] });
      assert.equal(path, '/v1beta/voices/' + voice);
      return Response.json({ ...entry, sample_audio: { mime_type: 'audio/wav', data: sample.toString('base64') } });
    };
    let chimePlayed = false;
    FfplayAudioPlayer.prototype.play = async ({ path, format }) => {
      if (format === 'mp3') {
        assert.equal(basename(path), 'notification.mp3');
        chimePlayed = true;
        return { ok: true };
      }
      assert.equal(format, 'wav');
      assert.equal(chimePlayed, true);
      assert.deepEqual(await readFile(path), sample);
      await writeFile(join(process.env.DOORBELL_CONFIG_DIR, 'played-path.txt'), path);
      return { ok: true };
    };
  `);
  const browse = (args) => run(dir, ["configure", "gemini", ...args], pathToFileURL(preload).href);
  const [models, voices] = await Promise.all([browse(["--list-models"]), browse(["--list-voices"])]);
  assert.equal(models.code, 0, models.stderr);
  assert.deepEqual(JSON.parse(models.stdout).map(({ id }) => id), [model]);
  assert.equal(voices.code, 0, voices.stderr);
  assert.deepEqual(JSON.parse(voices.stdout), [{ id: voice, type: "prompted", name: "My voice", canPreview: true }]);
  const settingsPath = join(dir, "speech.json");
  const preview = await browse(["--preview-voice", voice]);
  assert.equal(preview.code, 0, preview.stderr);
  await assert.rejects(access(await readFile(join(dir, "played-path.txt"), "utf8")), { code: "ENOENT" });
  await assert.rejects(access(settingsPath), { code: "ENOENT" });
  const saved = await browse(["--model", model, "--voice", voice]);
  assert.equal(saved.code, 0, saved.stderr);
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  assert.deepEqual(settings.providers.gemini, { model, voice });
  assert.equal(settings.enabled, false);
});

test("real CLI routes per-call controls to each SDK, ignores old tones, and never writes settings", async (t) => {
  const dir = await environment(t);
  const preload = new URL("./fixtures/provider-routing.mjs", import.meta.url)
    .href;
  for (const provider of ["gemini", "openai"]) {
    assert.equal(
      (
        await run(dir, [
          "configure",
          "speech",
          "--provider",
          provider,
          "--enable",
        ])
      ).code,
      0,
    );
    const settingsPath = join(dir, "speech.json");
    const legacy = JSON.parse(await readFile(settingsPath, "utf8"));
    legacy.style = { tone: "Stale personality" };
    await writeFile(settingsPath, JSON.stringify(legacy));
    const before = await readFile(settingsPath, "utf8");
    const directions =
      'Warm and clear.\nPause after "ready"; preserve $() and `literal`.';
    const result = await run(
      dir,
      [
        "notify",
        "--message",
        "Please review.",
        ...(provider === "openai"
          ? ["--instructions", directions, "--speed", "1.2", "--voice", "coral"]
          : ["--prompt", directions, "--voice", "Puck"]),
      ],
      preload,
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    const trace = JSON.parse(result.stdout);
    assert.deepEqual(trace.credentials, [provider]);
    assert.deepEqual(trace.requests, [provider]);
    assert.deepEqual(trace.played, ["notification.mp3", "speech.wav"]);
    const body = trace.bodies[0];
    assert.doesNotMatch(JSON.stringify(body), /Stale personality/);
    if (provider === "openai") {
      assert.equal(body.instructions, directions);
      assert.equal(body.speed, 1.2);
      assert.equal(body.voice, "coral");
      assert.equal(body.input, "Please review.");
    } else {
      assert.ok(body.input.includes(directions));
      assert.ok(body.input.endsWith("Transcript:\nPlease review."));
      assert.deepEqual(body.generation_config.speech_config, [
        { voice: "Puck" },
      ]);
    }
    const next = await run(
      dir,
      ["notify", "--message", "Please review."],
      preload,
    );
    assert.equal(next.code, 0, next.stderr);
    const nextBody = JSON.parse(next.stdout).bodies[0];
    if (provider === "openai") {
      assert.equal(nextBody.voice, "nova");
      assert.equal(Object.hasOwn(nextBody, "instructions"), false);
      assert.equal(Object.hasOwn(nextBody, "speed"), false);
    } else {
      assert.deepEqual(nextBody.generation_config.speech_config, [
        { voice: "Kore" },
      ]);
      assert.equal(nextBody.input.includes(directions), false);
    }
    assert.equal(await readFile(settingsPath, "utf8"), before);
  }
});

test("missing-key sound is local and specific to the selected provider, including fresh installs", async (t) => {
  const dir = await environment(t);
  const preload = new URL("./fixtures/provider-routing.mjs", import.meta.url).href;
  const args = ["notify", "--message", "Please review."];
  async function expectSound(mode, filename, credentials) {
    const result = await run(dir, args, preload, undefined, { DOORBELL_TEST_MODE: mode });
    assert.equal(result.code, 0, result.stderr);
    const trace = JSON.parse(result.stdout);
    assert.deepEqual(trace.played, [filename]);
    assert.deepEqual(trace.requests, []);
    assert.deepEqual(trace.credentials, [credentials]);
  }
  await expectSound("missing", "notification-no-key.mp3", "openai");
  await expectSound("unavailable", "notification.mp3", "openai");
  for (const enabled of [false, true]) {
    await writeFile(join(dir, "speech.json"), JSON.stringify({ enabled, provider: "gemini" }));
    await expectSound("missing", "notification-no-key.mp3", "gemini");
    await expectSound("unavailable", "notification.mp3", "gemini");
  }
});

test("wrong-provider options fail before credentials, network, or even fallback sound", async (t) => {
  const dir = await environment(t);
  const preload = new URL("./fixtures/provider-routing.mjs", import.meta.url)
    .href;
  for (const provider of ["openai", "gemini"]) {
    assert.equal(
      (
        await run(dir, [
          "configure",
          "speech",
          "--provider",
          provider,
          "--enable",
        ])
      ).code,
      0,
    );
    const invalid =
      provider === "openai"
        ? [
            ["--prompt", "Wrong option"],
            ["--voice", "Kore"],
          ]
        : [
            ["--instructions", "Wrong option"],
            ["--speed", "1.2"],
            ["--voice", "nova"],
          ];
    for (const options of invalid) {
      const result = await run(
        dir,
        ["notify", "--message", "Review.", ...options],
        preload,
      );
      assert.equal(result.code, 2);
      assert.match(result.stderr, /Invalid speech options/);
      assert.deepEqual(JSON.parse(result.stdout), {
        credentials: [],
        requests: [],
        bodies: [],
        played: [],
      });
    }
  }
});

test("interactive configuration rejects non-TTY without writing a settings file", async (t) => {
  const dir = await environment(t);
  for (const target of ["api-key", "speech"]) {
    const result = await run(dir, ["configure", target]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /interactive terminal/i);
  }
  await assert.rejects(access(join(dir, "speech.json")));
});

test("Codex argument and Claude stdin hooks share validation, fallback, and provider routing", async (t) => {
  const dir = await environment(t);
  const preload = new URL("./fixtures/provider-routing.mjs", import.meta.url)
    .href;
  for (const mode of ["disabled", "missing", "failure", "speech"]) {
    await run(dir, [
      "configure",
      "speech",
      mode === "disabled" ? "--disable" : "--enable",
    ]);
    const before = await readFile(join(dir, "speech.json"), "utf8");
    for (const agent of ["codex", "claude"]) {
      const payload = JSON.stringify(
        agent === "codex"
          ? {
              type: "agent-turn-complete",
              "last-assistant-message": "private transcript marker",
              doorbell: {
                message: "Please review.",
                speech: { instructions: "Quiet and clear." },
              },
            }
          : {
              hook_event_name: "Notification",
              notification_type: "permission_prompt",
              message: "Please review.",
              transcript_path: "private transcript marker",
            },
      );
      const result = await run(
        dir,
        ["hook", agent, ...(agent === "codex" ? [payload] : [])],
        preload,
        agent === "claude" ? payload : undefined,
        { DOORBELL_TEST_MODE: mode },
      );
      assert.equal(result.code, 0, result.stderr);
      const trace = JSON.parse(result.stdout);
      const sound = mode === "missing" ? "notification-no-key.mp3" : "notification.mp3";
      assert.deepEqual(trace.played, mode === "speech" ? ["notification.mp3", "speech.wav"] : [sound]);
      assert.equal(
        trace.requests.length,
        ["failure", "speech"].includes(mode) ? 1 : 0,
      );
      assert.doesNotMatch(JSON.stringify(trace), /private transcript marker/);
      if (mode === "failure") assert.match(result.stderr, /speech failed/);
      assert.equal(await readFile(join(dir, "speech.json"), "utf8"), before);
    }
  }
  const invalid = await run(
    dir,
    ["hook", "claude"],
    preload,
    JSON.stringify({
      hook_event_name: "Notification",
      notification_type: "permission_prompt",
      message: "Review.",
      apiKey: "secret marker",
    }),
  );
  assert.equal(invalid.code, 2);
  assert.doesNotMatch(invalid.stderr, /secret marker/);
  assert.deepEqual(JSON.parse(invalid.stdout), {
    credentials: [],
    requests: [],
    bodies: [],
    played: [],
  });
});
