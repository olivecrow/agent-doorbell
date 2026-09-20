// Explicit opt-in native check: isolated fake credentials only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { KeyringCredentialStore } from "../dist/config/keyring-credential-store.js";
if (!process.argv.includes("--run"))
  throw new Error("Use --run to test isolated OS credential entries.");
const service = `agent-doorbell-native-test:${randomUUID()}`;
const openai = new KeyringCredentialStore(service);
const gemini = new KeyringCredentialStore(service, "gemini");
try {
  assert.equal((await openai.read()).value, undefined);
  assert.equal((await openai.write("fake-test-openai")).ok, true);
  assert.equal((await gemini.write("fake-test-gemini")).ok, true);
  assert.equal(
    (await new KeyringCredentialStore(service, "openai").read()).value,
    "fake-test-openai",
  );
  assert.equal((await gemini.read()).value, "fake-test-gemini");
  assert.equal((await openai.write("fake-test-replaced")).ok, true);
  assert.equal((await openai.read()).value, "fake-test-replaced");
  assert.equal((await gemini.read()).value, "fake-test-gemini");
} finally {
  assert.equal((await openai.remove()).ok, true);
  assert.equal((await gemini.remove()).ok, true);
  assert.equal((await openai.read()).value, undefined);
  assert.equal((await gemini.read()).value, undefined);
}
console.log(
  "Native provider credential isolation, replacement, and cleanup passed.",
);
