import assert from "node:assert/strict";
import { before, after } from "node:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

let root;
let parent;
const original = process.env.DOORBELL_SPEECH_TEMP_DIR;
before(async () => {
  // A shared/custom Windows TEMP can legitimately fail the production ACL gate.
  parent = await realpath(process.platform === "win32" ? homedir() : tmpdir());
  root = await mkdtemp(join(parent, "doorbell-speech-test-"));
  process.env.DOORBELL_SPEECH_TEMP_DIR = join(root, "speech");
});
after(async () => {
  if (original === undefined) delete process.env.DOORBELL_SPEECH_TEMP_DIR;
  else process.env.DOORBELL_SPEECH_TEMP_DIR = original;
  if (root) {
    assert.equal(dirname(root), parent);
    await rm(root, { recursive: true, force: true });
  }
});
