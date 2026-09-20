import { createAudioPlayer } from "./audio/create-player.js";
import { doctor } from "./commands/doctor.js";
import { notify, type NotifyResult } from "./commands/notify.js";
import { ring } from "./commands/ring.js";
import { getAppPaths } from "./config/app-path.js";
import { KeyringCredentialStore } from "./config/keyring-credential-store.js";
import { loadSpeechSettings } from "./config/load-speech-settings.js";
import { withDeliveryQueue } from "./coordination/file-delivery-queue.js";
import {
  normalizeAttentionMessage,
  type AttentionRequest,
} from "./domain/attention.js";
import { createSpeechProvider } from "./speech/create-provider.js";
import { normalizeSpeechOptions } from "./speech/options.js";
import { cleanupStaleSpeechFiles } from "./speech/temp-speech-files.js";

/** CLI, hooks, and MCP share one production composition and one user-wide queue. */
export async function deliverNotification(
  request: AttentionRequest,
  signal?: AbortSignal,
): Promise<NotifyResult> {
  signal?.throwIfAborted();
  const paths = getAppPaths();
  const settings = await loadSpeechSettings(paths.speechSettingsPath);
  normalizeAttentionMessage(request.message);
  normalizeSpeechOptions(
    request.speech,
    settings.ok ? settings.settings.provider : undefined,
  );
  const cleanup = await cleanupStaleSpeechFiles();
  signal?.throwIfAborted();
  const result = await withDeliveryQueue(
    () =>
      notify(
        request,
        {
          player: createAudioPlayer(),
          settings,
          createProvider: (selected) =>
            createSpeechProvider(
              selected,
              new KeyringCredentialStore(
                paths.credentialService,
                selected.provider,
              ),
            ),
        },
        signal,
      ),
    request.source,
    signal,
  );
  return {
    ...result,
    warnings: [
      ...(cleanup.failed > 0
        ? ["Some temporary speech files could not be cleaned."]
        : []),
      ...result.warnings,
    ],
  };
}

export function playNotificationSound(signal?: AbortSignal) {
  return withDeliveryQueue(
    () => ring(createAudioPlayer(), signal),
    undefined,
    signal,
  );
}

export function inspectEnvironment(signal?: AbortSignal, playSound = false) {
  const paths = getAppPaths();
  return doctor(
    {
      paths,
      player: createAudioPlayer(),
      credentials: (provider) =>
        new KeyringCredentialStore(paths.credentialService, provider),
      ...(playSound ? { playTest: playNotificationSound } : {}),
    },
    signal,
  );
}
