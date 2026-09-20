export type CredentialResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

export interface CredentialReader {
  read(signal?: AbortSignal): Promise<CredentialResult<string | undefined>>;
}

export interface CredentialStore extends CredentialReader {
  write(apiKey: string, signal?: AbortSignal): Promise<CredentialResult<void>>;

  remove(signal?: AbortSignal): Promise<CredentialResult<boolean>>;
}
