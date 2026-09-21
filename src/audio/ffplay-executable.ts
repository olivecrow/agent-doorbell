import { constants } from "node:fs";
import { access, lstat, readFile, realpath, stat } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

export type FfplayExecutableResolver = () => Promise<string>;

export const FFPLAY_UNAVAILABLE =
  "Managed ffplay is unavailable. Run npm run setup:player in the installed Doorbell package, or install ffplay in an absolute PATH directory outside the current working directory.";

function identity(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

/** Package-owned files take priority; playback never downloads or installs software. */
export async function resolveFfplayExecutable(): Promise<string> {
  const root = fileURLToPath(new URL("../../player/", import.meta.url));
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as
    Record<string, { directory: string; executable: string }>;
  const build = manifest[`${process.platform}-${process.arch}`];
  if (build) {
    const directory = join(root, "bin", build.directory);
    const candidate = join(directory, build.executable);
    try {
      for (const path of [join(root, "bin"), directory]) {
        const info = await lstat(path);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(FFPLAY_UNAVAILABLE);
      }
      const info = await lstat(candidate);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(FFPLAY_UNAVAILABLE);
      await access(candidate, constants.X_OK);
      return await realpath(candidate);
    } catch (error) {
      // Missing managed files allow an explicit system installation; unsafe files do not.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return resolvePathFfplayExecutable();
}

/** Resolve only explicit PATH entries; never delegate executable search to spawn. */
export async function resolvePathFfplayExecutable(): Promise<string> {
  const cwd = identity(await realpath(process.cwd()));
  const pathKey = Object.keys(process.env)
    .sort()
    .find((key) =>
      process.platform === "win32" ? key.toUpperCase() === "PATH" : key === "PATH",
    );
  const searchPath = pathKey === undefined ? "" : process.env[pathKey] ?? "";
  const filename = process.platform === "win32" ? "ffplay.exe" : "ffplay";
  for (const entry of searchPath.split(delimiter)) {
    const directory = entry.trim().replace(/^"(.*)"$/, "$1");
    if (
      !isAbsolute(directory) ||
      (process.platform === "win32" && parse(directory).root.length <= 1)
    )
      continue;
    try {
      const canonicalDirectory = await realpath(directory);
      if (identity(canonicalDirectory) === cwd) continue;
      const executable = await realpath(join(canonicalDirectory, filename));
      if (identity(dirname(executable)) === cwd) continue;
      if (!(await stat(executable)).isFile()) continue;
      await access(executable, constants.X_OK);
      return executable;
    } catch {
      // Missing, inaccessible, or invalid PATH entries are not executable candidates.
    }
  }
  throw new Error(FFPLAY_UNAVAILABLE);
}
