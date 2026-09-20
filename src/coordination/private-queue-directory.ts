import { preparePrivateDirectory } from "../filesystem/private-directory.js";

export { validatePrivateDirectory as validateQueueDirectory } from "../filesystem/private-directory.js";

/** Queue compatibility: POSIX checks and the existing Windows profile boundary. */
export function prepareQueueDirectory(directory: string): Promise<string> {
  return preparePrivateDirectory(directory);
}
