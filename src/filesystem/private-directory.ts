import type { Stats } from "node:fs";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, resolve } from "node:path";
import { assertWindowsPrivateDirectory } from "./windows-directory-acl.js";

const UNSAFE_DIRECTORY = "Directory is not private or safe to use.";

export function validatePrivateDirectory(
  stats: Stats,
  userId: number | undefined,
  privateDirectory: boolean,
): void {
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(UNSAFE_DIRECTORY);
  if (userId === undefined) return;
  if (privateDirectory) {
    if (stats.uid !== userId || (stats.mode & 0o077) !== 0)
      throw new Error(UNSAFE_DIRECTORY);
  } else {
    const protectedStickyRoot = stats.uid === 0 && (stats.mode & 0o1000) !== 0;
    if (
      (stats.uid !== userId && stats.uid !== 0) ||
      ((stats.mode & 0o022) !== 0 && !protectedStickyRoot)
    )
      throw new Error(UNSAFE_DIRECTORY);
  }
}

export function sameDirectory(left: Stats, right: Stats): boolean {
  return right.isDirectory() && !right.isSymbolicLink() &&
    left.dev === right.dev && left.ino === right.ino &&
    left.birthtimeMs === right.birthtimeMs;
}

/** Validate the creation anchor first; never repair or traverse an unsafe directory. */
export async function preparePrivateDirectory(
  directory: string,
  options: { create?: boolean; windowsAcl?: boolean; signal?: AbortSignal } = {},
): Promise<string> {
  if (!isAbsolute(directory) || (process.platform === "win32" && parse(directory).root.length <= 1))
    throw new Error("Private directory must be absolute.");
  options.signal?.throwIfAborted();
  const userId = process.getuid?.();
  let existing = resolve(directory);
  const missing: string[] = [];
  while (true) {
    try {
      validatePrivateDirectory(await lstat(existing), userId, missing.length === 0);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || options.create === false) throw error;
      missing.unshift(basename(existing));
      const parent = dirname(existing);
      if (parent === existing) throw new Error(UNSAFE_DIRECTORY);
      existing = parent;
    }
  }
  let canonical = await realpath(existing);
  for (let ancestor = canonical; ; ancestor = dirname(ancestor)) {
    validatePrivateDirectory(await lstat(ancestor), userId, false);
    if (dirname(ancestor) === ancestor) break;
  }
  if (options.windowsAcl && process.platform === "win32")
    await assertWindowsPrivateDirectory(canonical, options.signal);
  for (const name of missing) {
    options.signal?.throwIfAborted();
    canonical = join(canonical, name);
    try {
      await mkdir(canonical, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    validatePrivateDirectory(await lstat(canonical), userId, true);
  }
  validatePrivateDirectory(await lstat(canonical), userId, true);
  if (missing.length > 0 && options.windowsAcl && process.platform === "win32")
    await assertWindowsPrivateDirectory(canonical, options.signal);
  return canonical;
}
