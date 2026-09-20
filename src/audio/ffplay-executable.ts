import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, parse } from "node:path";

export type FfplayExecutableResolver = () => Promise<string>;

export const FFPLAY_UNAVAILABLE =
  "ffplay must be installed in an absolute PATH directory outside the current working directory.";

function identity(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

/** Resolve only explicit PATH entries; never delegate executable search to spawn. */
export async function resolveFfplayExecutable(): Promise<string> {
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
