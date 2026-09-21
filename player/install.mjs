import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, readFile, rename, rmdir, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const hash = (data) => createHash("sha256").update(data).digest("hex");

export function extractPlayer(archive, build) {
  if (archive.length !== build.archiveBytes || hash(archive) !== build.sha256)
    throw new Error("ffplay archive checksum or size mismatch.");
  const entries = new Set(Object.values(build.files).map((file) => file.entry));
  const extracted = unzipSync(archive, {
    filter: (file) => entries.has(file.name) && file.originalSize <= 128 * 1024 * 1024,
  });
  const result = {};
  for (const [name, file] of Object.entries(build.files)) {
    const data = extracted[file.entry];
    if (!data || hash(data) !== file.sha256)
      throw new Error("ffplay file checksum mismatch or required file missing.");
    // Output names come only from the package manifest, never ZIP paths.
    if (name !== name.replace(/[\\/]/g, "") || name === "." || name === "..")
      throw new Error("Invalid ffplay output name.");
    result[name] = data;
  }
  return result;
}

async function directory(path) {
  await mkdir(path, { recursive: true });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("ffplay installation directory must not be a link.");
}

async function installed(destination, build) {
  let info;
  try { info = await lstat(destination); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Unsafe ffplay installation. Reinstall Doorbell.");
  for (const [name, file] of Object.entries(build.files)) {
    const path = join(destination, name);
    const entry = await lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink() || hash(await readFile(path)) !== file.sha256)
      throw new Error("Existing ffplay installation is incomplete or changed. Reinstall Doorbell.");
  }
  return true;
}

export async function installPlayer({
  platform = process.platform,
  arch = process.arch,
  destinationRoot = join(root, "bin"),
  builds = manifest,
  fetchArchive = fetch,
  signal = AbortSignal.timeout(180_000),
} = {}) {
  const build = builds[`${platform}-${arch}`];
  if (!build) return { installed: false, reason: "No managed ffplay build for this platform; install ffplay in an absolute PATH directory. Platform playback remains unverified." };
  signal.throwIfAborted();
  await directory(destinationRoot);
  const destination = join(destinationRoot, build.directory);
  if (await installed(destination, build)) return { installed: true, reused: true };
  const response = await fetchArchive(build.url, { signal });
  if (!response.ok || !response.body) throw new Error("Could not download the pinned ffplay archive.");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    signal.throwIfAborted();
    size += chunk.length;
    if (size > build.archiveBytes) throw new Error("ffplay download exceeded its expected size.");
    chunks.push(chunk);
  }
  const files = extractPlayer(Buffer.concat(chunks), build);
  signal.throwIfAborted();
  const staging = await mkdtemp(join(destinationRoot, ".install-"));
  const written = [];
  try {
    for (const [name, data] of Object.entries(files)) {
      const path = join(staging, name);
      const handle = await open(path, "wx", 0o755);
      written.push(path);
      try { await handle.writeFile(data); }
      finally { await handle.close(); }
    }
    signal.throwIfAborted();
    await rename(staging, destination);
    return { installed: true, reused: false };
  } finally {
    // Only our own fixed files and empty staging directory; no recursive deletion.
    for (const path of written) await unlink(path).catch((error) => { if (error.code !== "ENOENT") throw error; });
    await rmdir(staging).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    const result = await installPlayer({ signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]) });
    console.error(result.installed ? "[doorbell] Managed ffplay is ready." : `[doorbell] ${result.reason}`);
  } catch (error) {
    console.error(`[doorbell] ffplay setup failed: ${error.message} Retry with npm run setup:player in the installed package directory. No automatic retry was made.`);
    process.exitCode = controller.signal.aborted ? 130 : 1;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
