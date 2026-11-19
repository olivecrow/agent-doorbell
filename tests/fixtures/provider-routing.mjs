// Used only by CLI subprocess tests. All external boundaries are replaced.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { KeyringCredentialStore } from "../../dist/config/keyring-credential-store.js";
import { FfplayAudioPlayer } from "../../dist/audio/ffplay-player.js";

const trace = { credentials: [], requests: [], bodies: [], played: [] };
KeyringCredentialStore.prototype.status = async function () {
  trace.credentials.push(this.provider);
  if (process.env.DOORBELL_TEST_MODE === "unavailable") return "unavailable";
  return process.env.DOORBELL_TEST_MODE === "missing" ? "missing" : "configured";
};
KeyringCredentialStore.prototype.read = async function () {
  trace.credentials.push(this.provider);
  if (process.env.DOORBELL_TEST_MODE === "unavailable")
    return { ok: false, reason: "Could not access the credential store." };
  return {
    ok: true,
    value:
      process.env.DOORBELL_TEST_MODE === "missing"
        ? undefined
        : `fake-${this.provider}-key`,
  };
};
FfplayAudioPlayer.prototype.check = async () => ({ available: true });
FfplayAudioPlayer.prototype.play = async (request) => {
  trace.played.push(basename(request.path));
  assert.ok((await readFile(request.path)).length > 0);
  return { ok: true };
};
globalThis.fetch = async (url, init) => {
  const request = new Request(url, init);
  const body = await request.json();
  trace.bodies.push(body);
  if (new URL(request.url).hostname === "generativelanguage.googleapis.com") {
    trace.requests.push("gemini");
    assert.equal(request.headers.get("x-goog-api-key"), "fake-gemini-key");
    assert.equal(body.model, "gemini-3.1-flash-tts-preview");
    return new Response(
      JSON.stringify({
        id: "test",
        status: "completed",
        steps: [
          {
            type: "model_output",
            content: [
              {
                type: "audio",
                mime_type: "audio/l16",
                data: "AAAAAA==",
              },
            ],
          },
        ],
      }),
      { headers: { "content-type": "application/json" } },
    );
  }
  assert.equal(new URL(request.url).hostname, "api.openai.com");
  trace.requests.push("openai");
  assert.equal(request.headers.get("authorization"), "Bearer fake-openai-key");
  assert.equal(body.model, "gpt-4o-mini-tts");
  if (process.env.DOORBELL_TEST_MODE === "failure")
    return new Response("private remote content", { status: 429 });
  return new Response(new Uint8Array([1, 2, 3]));
};
process.on("exit", () => console.log(JSON.stringify(trace)));
