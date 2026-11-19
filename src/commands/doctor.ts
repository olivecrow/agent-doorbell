import { access } from "node:fs/promises";
import { release } from "node:os";
import { getNotificationAssetPath } from "../audio/assets.js";
import type { AudioPlayer, PlaybackResult } from "../audio/player.js";
import type { AppPaths } from "../config/app-path.js";
import type { CredentialReader } from "../config/credentials.js";
import { loadSpeechSettings } from "../config/load-speech-settings.js";
import { selectSpeechSettings } from "../config/parse-speech-settings.js";
import { geminiLoggingBlock } from "../speech/providers/gemini-request-policy.js";
import {
  SPEECH_PROVIDERS,
  type SpeechProviderId,
} from "../speech/providers/catalog.js";

export type CredentialStatus = "configured" | "missing" | "unavailable";

export interface DoctorDependencies {
  readonly paths: AppPaths;
  readonly player: AudioPlayer;
  readonly credentials: (provider: SpeechProviderId) => CredentialReader;
  readonly playTest?: (signal?: AbortSignal) => Promise<PlaybackResult>;
}

/** Silent, local diagnostics: no synthesis, key values, or settings writes. */
export async function doctor(
  dependencies: DoctorDependencies,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const settings = await loadSpeechSettings(
    dependencies.paths.speechSettingsPath,
  );
  const selected = settings.ok
    ? selectSpeechSettings(settings.settings)
    : undefined;
  const credentials = {} as Record<SpeechProviderId, CredentialStatus>;
  for (const provider of SPEECH_PROVIDERS) {
    const deadline = AbortSignal.timeout(5000);
    const operation = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      const result = await dependencies.credentials(provider).read(operation);
      credentials[provider] = result.ok
        ? result.value?.trim()
          ? "configured"
          : "missing"
        : "unavailable";
    } catch {
      credentials[provider] = "unavailable";
    }
    signal?.throwIfAborted();
  }
  const player = await dependencies.player.check(signal).catch(() => ({
    available: false as const,
    reason: "Could not check the audio player.",
  }));
  const streaming =
    dependencies.player.checkStreaming && dependencies.player.playStream
      ? await dependencies.player
          .checkStreaming(signal)
          .catch(() => ({
            available: false as const,
            reason: "Could not check PCM streaming.",
          }))
      : {
          available: false as const,
          reason: "The audio player has no PCM stream support.",
        };
  let assetAvailable = false;
  try {
    await access(getNotificationAssetPath());
    assetAvailable = true;
  } catch {}
  signal?.throwIfAborted();
  const runtimeSupported = Number(process.versions.node.split(".")[0]) >= 24;
  const soundReady =
    runtimeSupported &&
    assetAvailable &&
    player.available &&
    dependencies.player.supports("mp3");
  const loggingBlock =
    selected?.enabled && selected.provider === "gemini" ? geminiLoggingBlock() : undefined;
  const speechReady =
    runtimeSupported &&
    !loggingBlock &&
    selected?.enabled === true &&
    credentials[selected.provider] === "configured" &&
    player.available &&
    dependencies.player.supports("wav");
  const playbackTest = dependencies.playTest
    ? await dependencies.playTest(signal)
    : undefined;
  signal?.throwIfAborted();
  return {
    ok:
      soundReady &&
      settings.ok &&
      (!selected?.enabled || speechReady) &&
      playbackTest?.ok !== false,
    runtime: {
      node: process.versions.node,
      supported: runtimeSupported,
      platform: process.platform,
      arch: process.arch,
    },
    context: {
      wsl: Boolean(process.env.WSL_DISTRO_NAME || /microsoft/i.test(release())),
      ssh: Boolean(process.env.SSH_CONNECTION || process.env.SSH_TTY),
      ci: Boolean(process.env.CI && process.env.CI !== "false"),
      stdinTty: Boolean(process.stdin.isTTY),
      stdoutTty: Boolean(process.stdout.isTTY),
    },
    configuration: {
      path: dependencies.paths.speechSettingsPath,
      ...(selected
        ? { ...selected }
        : { error: settings.ok ? "Unavailable" : settings.reason }),
    },
    credentials,
    player: {
      id: dependencies.player.id,
      ...player,
      wav: dependencies.player.supports("wav"),
      mp3: dependencies.player.supports("mp3"),
      streaming,
    },
    asset: { available: assetAvailable },
    soundReady,
    speechReady,
    effectivePlaybackMode:
      selected?.provider === "gemini" || !streaming.available
        ? "buffered"
        : selected?.playbackMode,
    ...(playbackTest ? { playbackTest } : {}),
    notes: [
      ...(loggingBlock ? [loggingBlock] : []),
      "Credential status does not verify API validity, quota, or network access.",
      "Readiness checks do not prove physical audio output.",
    ],
  };
}
