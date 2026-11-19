import type { AsyncEntry } from "@napi-rs/keyring";
import type { CredentialResult, CredentialStatus, CredentialStore } from "./credentials.js";
import {
  DEFAULT_SPEECH_PROVIDER,
  type SpeechProviderId,
} from "../speech/providers/catalog.js";

export class KeyringCredentialStore implements CredentialStore {
  constructor(
    private readonly service: string,
    private readonly provider: SpeechProviderId = DEFAULT_SPEECH_PROVIDER,
  ) {}

  async read(
    signal?: AbortSignal,
  ): Promise<CredentialResult<string | undefined>> {
    return this.run(
      async (entry) => (await entry.getPassword(signal)) ?? undefined,
      signal,
    );
  }

  async status(signal?: AbortSignal): Promise<CredentialStatus> {
    const present = await this.run(async (entry) => {
      const bytes = await entry.getSecret(signal);
      try {
        return Boolean(bytes?.length);
      } finally {
        bytes?.fill(0);
      }
    }, signal);
    if (!present.ok || signal?.aborted) return "unavailable";
    return present.value ? "configured" : "missing";
  }

  async write(
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<CredentialResult<void>> {
    const normalized = apiKey.trim();

    if (normalized.length === 0 || /\s/.test(normalized)) {
      return {
        ok: false,
        reason: "API key must be nonempty and contain no whitespace.",
      };
    }

    return this.run(async (entry) => {
      await entry.setPassword(normalized, signal);
    }, signal);
  }

  async remove(signal?: AbortSignal): Promise<CredentialResult<boolean>> {
    return this.run((entry) => entry.deleteCredential(signal), signal);
  }

  private async run<T>(
    operation: (entry: AsyncEntry) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<CredentialResult<T>> {
    try {
      signal?.throwIfAborted();

      const { AsyncEntry } = await import("@napi-rs/keyring");

      signal?.throwIfAborted();

      const entry = new AsyncEntry(this.service, `${this.provider}-api-key`, {
        linux: { store: "secret-service" },
      });

      return {
        ok: true,
        value: await operation(entry),
      };
    } catch {
      return {
        ok: false,
        reason: signal?.aborted
          ? "Credential operation was cancelled; changes may already have been applied."
          : "Could not access the credential store.",
      };
    }
  }
}
