export type CredentialResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

export interface CredentialReader {
  read(signal?: AbortSignal): Promise<CredentialResult<string | undefined>>;
  status?(signal?: AbortSignal): Promise<CredentialStatus>;
}

export type CredentialStatus = "configured" | "missing" | "unavailable";

export async function readCredentialStatus(
  reader: CredentialReader,
  signal?: AbortSignal,
): Promise<CredentialStatus> {
  const timeout = AbortSignal.timeout(5000);
  const operation = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    if (reader.status) return await reader.status(operation);
    const result = await reader.read(operation);
    if (!result.ok || operation.aborted) return "unavailable";
    return result.value?.trim() ? "configured" : "missing";
  } catch {
    return "unavailable";
  }
}

export interface CredentialStore extends CredentialReader {
  write(apiKey: string, signal?: AbortSignal): Promise<CredentialResult<void>>;

  remove(signal?: AbortSignal): Promise<CredentialResult<boolean>>;
}
