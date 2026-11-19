import type { CredentialReader } from "../config/credentials.js";
import type { SpeechSynthesisResult } from "./failure.js";

export async function readApiKey(
  reader: CredentialReader,
  provider: string,
  signal: AbortSignal,
): Promise<{ ok: true; value: string } | Extract<SpeechSynthesisResult, { ok: false }>> {
  signal.throwIfAborted();
  const result = await reader.read(signal);
  signal.throwIfAborted();
  if (!result.ok) return result;
  const key = result.value?.trim();
  return key
    ? { ok: true, value: key }
    : { ok: false, code: "missing-api-key", reason: `${provider} API key is not configured.` };
}
