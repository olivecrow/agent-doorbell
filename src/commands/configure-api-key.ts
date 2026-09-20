import type { CredentialStore } from "../config/credentials.js";
import {
  DEFAULT_SPEECH_PROVIDER,
  SPEECH_PROVIDER_CATALOG,
  type SpeechProviderId,
} from "../speech/providers/catalog.js";
import {
  configurationFailure,
  createConfigurePrompts,
  type ConfigurePrompts,
  type ConfigureResult,
} from "./configure.js";

export interface ConfigureApiKeyDependencies {
  readonly credentials: CredentialStore;
  readonly provider?: SpeechProviderId;
  readonly prompts?: ConfigurePrompts;
}

/** This command has no access to the speech settings file. */
export async function configureApiKey(
  dependencies: ConfigureApiKeyDependencies,
  signal: AbortSignal,
): Promise<ConfigureResult> {
  let mutationStarted = false;
  try {
    signal.throwIfAborted();
    const label =
      SPEECH_PROVIDER_CATALOG[dependencies.provider ?? DEFAULT_SPEECH_PROVIDER]
        .label;
    const prompts =
      dependencies.prompts ?? (await createConfigurePrompts(signal));
    const action = await prompts.choose(
      `${label} API key action:`,
      ["cancel", "set", "remove"] as const,
      "cancel",
    );
    if (action === "cancel") {
      return {
        ok: false,
        cancelled: true,
        reason: "Configuration cancelled. Nothing was saved.",
      };
    }

    const key =
      action === "set"
        ? (await prompts.secret(`${label} API key:`)).trim()
        : undefined;
    if (key !== undefined && (key.length === 0 || /\s/.test(key))) {
      return {
        ok: false,
        cancelled: false,
        reason: "API key must be nonempty and contain no whitespace.",
      };
    }
    if (
      action === "remove" &&
      !(await prompts.confirm(`Remove the saved ${label} API key?`, true))
    ) {
      return {
        ok: false,
        cancelled: true,
        reason: "Configuration cancelled. Nothing was saved.",
      };
    }
    signal.throwIfAborted();
    mutationStarted = true;
    const result =
      key === undefined
        ? await dependencies.credentials.remove(signal)
        : await dependencies.credentials.write(key, signal);
    signal.throwIfAborted();
    return result.ok
      ? { ok: true }
      : {
          ok: false,
          cancelled: false,
          reason:
            "Could not update the API key. Credential changes may already have been applied.",
        };
  } catch (error: unknown) {
    const failure = configurationFailure(error, signal);
    if (!failure.ok && mutationStarted) {
      return {
        ...failure,
        reason: `Credential changes may already have been applied. ${failure.reason}`,
      };
    }
    return failure;
  }
}
