import { randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, mkdtemp, readdir, rename, rmdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  preparePrivateDirectory,
  sameDirectory,
  validatePrivateDirectory,
} from "../filesystem/private-directory.js";

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const DIRECTORY_PATTERN = /^agent-doorbell-speech-([1-9]\d*)-[A-Za-z0-9]+$/;

export interface StaleSpeechCleanupResult {
  readonly removed: number;
  readonly failed: number;
}

export function getSpeechTempDirectory(): string {
  return process.env.DOORBELL_SPEECH_TEMP_DIR ??
    join(homedir(), ".agent-doorbell", "speech-tmp");
}

export function prepareSpeechTempDirectory(signal?: AbortSignal): Promise<string> {
  return preparePrivateDirectory(getSpeechTempDirectory(), {
    windowsAcl: true,
    ...(signal === undefined ? {} : { signal }),
  });
}

export function getSpeechTempPrefix(root = getSpeechTempDirectory()): string {
  return join(root, "agent-doorbell-speech-" + process.pid + "-");
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === code;
}

function isProcessGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error: unknown) {
    return hasErrorCode(error, "ESRCH");
  }
}

async function assertIdentity(path: string, expected: Stats): Promise<void> {
  const actual = await lstat(path);
  validatePrivateDirectory(actual, process.getuid?.(), true);
  if (!sameDirectory(expected, actual))
    throw new Error("Temporary speech directory changed.");
}

/** Capture identity so cleanup cannot silently adopt a replacement directory. */
export async function createSpeechTempDirectory(signal?: AbortSignal) {
  const root = await prepareSpeechTempDirectory(signal);
  const rootStat = await lstat(root);
  signal?.throwIfAborted();
  const directory = await mkdtemp(getSpeechTempPrefix(root));
  const directoryStat = await lstat(directory);
  validatePrivateDirectory(directoryStat, process.getuid?.(), true);
  await assertIdentity(root, rootStat);
  return {
    directory,
    remove: () => removeSpeechDirectory(root, rootStat, directory, directoryStat),
  };
}

/** Claim an entry inside the private root, then delete only its known regular WAV. */
async function removeSpeechDirectory(
  root: string,
  rootStat: Stats,
  directory: string,
  directoryStat: Stats,
): Promise<void> {
  if (dirname(resolve(directory)) !== root)
    throw new Error("Invalid temporary speech directory.");
  await assertIdentity(root, rootStat);
  await assertIdentity(directory, directoryStat);
  const claim = getSpeechTempPrefix(root) + randomBytes(16).toString("hex");
  await rename(directory, claim);
  await assertIdentity(root, rootStat);
  await assertIdentity(claim, directoryStat);
  const children = await readdir(claim);
  if (children.some((child) => child !== "speech.wav"))
    throw new Error("Unexpected temporary speech files.");
  if (children.includes("speech.wav")) {
    const path = join(claim, "speech.wav");
    const stats = await lstat(path);
    if (
      !stats.isFile() || stats.isSymbolicLink() ||
      (process.getuid && (stats.uid !== process.getuid() || (stats.mode & 0o077) !== 0))
    )
      throw new Error("Unsafe temporary speech file.");
    await assertIdentity(root, rootStat);
    await assertIdentity(claim, directoryStat);
    await unlink(path);
  }
  await rmdir(claim);
}

export async function cleanupStaleSpeechFiles(): Promise<StaleSpeechCleanupResult> {
  let root: string;
  try {
    root = await preparePrivateDirectory(getSpeechTempDirectory(), {
      create: false,
      windowsAcl: true,
    });
  } catch (error) {
    return { removed: 0, failed: hasErrorCode(error, "ENOENT") ? 0 : 1 };
  }
  const cutoff = Date.now() - STALE_AFTER_MS;
  let names: string[];
  let rootStat: Stats;
  try {
    rootStat = await lstat(root);
    names = await readdir(root);
  } catch {
    return { removed: 0, failed: 1 };
  }
  let removed = 0;
  let failed = 0;
  for (const name of names) {
    const pidText = DIRECTORY_PATTERN.exec(name)?.[1];
    if (pidText === undefined) continue;
    const pid = Number(pidText);
    if (!Number.isSafeInteger(pid) || pid > 0x7fffffff || !isProcessGone(pid)) continue;
    const directory = join(root, name);
    try {
      const stats = await lstat(directory);
      if (!stats.isDirectory() || stats.isSymbolicLink() || stats.mtimeMs > cutoff) continue;
      validatePrivateDirectory(stats, process.getuid?.(), true);
      const children = await readdir(directory);
      if (children.some((child) => child !== "speech.wav")) continue;
      if (children.includes("speech.wav")) {
        const file = await lstat(join(directory, "speech.wav"));
        if (!file.isFile() || file.isSymbolicLink() || file.mtimeMs > cutoff) continue;
      }
      await removeSpeechDirectory(root, rootStat, directory, stats);
      removed++;
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) failed++;
    }
  }
  return { removed, failed };
}
