import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, parse, resolve } from "node:path";

export interface AppPaths {
  readonly configDirectory: string;
  readonly speechSettingsPath: string;
  readonly credentialService: string;
}

export function getAppPaths(
  directory: string = process.env.DOORBELL_CONFIG_DIR ??
    join(homedir(), ".agent-doorbell"),
): AppPaths {
  if (
    !isAbsolute(directory) ||
    (process.platform === "win32" && parse(directory).root.length <= 1)
  ) {
    throw new Error("Doorbell config directory must be an absolute path.");
  }

  const configDirectory = resolve(directory);
  const identity =
    process.platform === "win32"
      ? configDirectory.toLowerCase()
      : configDirectory;
  const scope = createHash("sha256").update(identity).digest("hex");

  return {
    configDirectory,
    speechSettingsPath: join(configDirectory, "speech.json"),
    credentialService: `agent-doorbell:${scope}`,
  };
}
