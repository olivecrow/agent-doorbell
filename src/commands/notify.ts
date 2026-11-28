import type { AudioPlayer, PlaybackResult } from "../audio/player.js";
import type {
  SelectedSpeechSettings,
  SpeechSettingsResult,
} from "../config/parse-speech-settings.js";
import { selectSpeechSettings } from "../config/parse-speech-settings.js";
import {
  normalizeAttentionMessage,
  type AttentionRequest,
} from "../domain/attention.js";
import { runDeliveryPolicy } from "../domain/delivery-policy.js";
import { normalizeSpeechOptions } from "../speech/options.js";
import type {
  DeliveryAttempt,
  DeliveryMode,
  DeliveryResult,
} from "../domain/results.js";
import { playBufferedSpeech } from "../speech/play-buffered-speech.js";
import { prepareSpeechTempDirectory } from "../speech/temp-speech-files.js";
import type { SpeechProvider } from "../speech/provider.js";
import { ring } from "./ring.js";
import type { CredentialStatus } from "../config/credentials.js";
import type { SpeechProviderId } from "../speech/providers/catalog.js";

export interface NotifyDependencies {
  readonly player: AudioPlayer;
  readonly settings: SpeechSettingsResult;
  readonly createProvider: (settings: SelectedSpeechSettings) => SpeechProvider;
  readonly credentialStatus?: (provider: SpeechProviderId, signal?: AbortSignal) => Promise<CredentialStatus>;
}

export interface NotifyResult {
  readonly delivery: DeliveryResult;
  readonly warnings: readonly string[];
}

function toAttempt(
  mode: DeliveryMode,
  handler: string,
  result: PlaybackResult,
): DeliveryAttempt {
  return result.ok
    ? { ok: true, mode, handler }
    : { ok: false, mode, handler, reason: result.reason };
}

export async function notify(
  request: AttentionRequest,
  dependencies: NotifyDependencies,
  signal?: AbortSignal,
): Promise<NotifyResult> {
  const message = normalizeAttentionMessage(request.message);
  const { player, settings, createProvider } = dependencies;
  const speechOptions = normalizeSpeechOptions(
    request.speech,
    settings.ok ? settings.settings.provider : undefined,
  );
  const warnings: string[] = [];
  let missingApiKey = false;
  let chimePlayed = false;

  const playChime = async (): Promise<PlaybackResult> => {
    signal?.throwIfAborted();
    const result = await ring(player, signal);
    chimePlayed = result.ok;
    return result;
  };

  let speech: (() => Promise<DeliveryAttempt>) | undefined;

  if (!settings.ok) {
    warnings.push(settings.reason);
  } else if (settings.settings.enabled) {
    const selected = selectSpeechSettings(settings.settings);

    speech = async () => {
      try {
        signal?.throwIfAborted();
        if (!player.supports("wav")) {
          return {
            ok: false,
            mode: "speech",
            handler: player.id,
            reason: "The audio player does not support WAV.",
          };
        }

        const availability = await player.check(signal);
        signal?.throwIfAborted();

        if (!availability.available) {
          return {
            ok: false,
            mode: "speech",
            handler: player.id,
            reason: availability.reason,
          };
        }

        let effective = selected;
        let provider = createProvider(effective);
        if (selected.playbackMode === "streaming") {
          const streaming =
            provider.capabilities.supportsStreaming &&
            player.playStream &&
            player.checkStreaming
              ? await player.checkStreaming(signal)
              : {
                  available: false as const,
                  reason:
                    provider.capabilities.streamingUnavailableReason ??
                    "The provider or player does not support streaming.",
                };
          signal?.throwIfAborted();
          if (!streaming.available) {
            warnings.push(
              `${streaming.reason} Using buffered speech before requesting audio.`,
            );
            effective = { ...selected, playbackMode: "buffered" };
            provider = createProvider(effective);
          }
        }
        if (effective.playbackMode === "buffered") {
          try {
            await prepareSpeechTempDirectory(signal);
          } catch {
            return {
              ok: false,
              mode: "speech",
              handler: "speech",
              reason: "Private temporary speech storage is unavailable.",
            };
          }
        }
        const synthesis = await provider.synthesize(
          { message, speech: speechOptions },
          signal,
        );
        if (!synthesis.ok) {
          missingApiKey = synthesis.code === "missing-api-key";
          return {
            ok: false,
            mode: "speech",
            handler: provider.id,
            reason: synthesis.reason,
          };
        }
        if (synthesis.audio.mode === "streaming") {
          const audio = synthesis.audio;
          let source: AsyncIterator<Uint8Array> | undefined;
          try {
            signal?.throwIfAborted();
            if (effective.playbackMode !== "streaming" || !player.playStream)
              return {
                ok: false,
                mode: "speech",
                handler: provider.id,
                reason: "Unexpected streaming audio.",
              };
            const iterator = audio.chunks[Symbol.asyncIterator]();
            source = iterator;
            // Wait for actual speech before playing the cue. Hold one chunk
            // while the cue plays, then let the player pull the rest.
            const first = await iterator.next();
            if (first.done)
              return { ok: false, mode: "speech", handler: provider.id, reason: "Speech audio is empty." };
            const chime = await playChime();
            signal?.throwIfAborted();
            if (!chime.ok) return toAttempt("speech", player.id, chime);

            const chunks = (async function* () {
              yield first.value;
              for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
                yield next.value;
              }
            })();
            return toAttempt(
              "speech",
              player.id,
              await player.playStream(
                { ...audio, chunks },
                signal,
                effective.playbackVolume,
              ),
            );
          } finally {
            audio.cancel();
            await source?.return?.().catch(() => {});
          }
        }
        signal?.throwIfAborted();
        if (effective.playbackMode !== "buffered")
          return {
            ok: false,
            mode: "speech",
            handler: provider.id,
            reason: "Expected streaming audio.",
          };

        const playback = await playBufferedSpeech(
          synthesis.audio,
          player,
          signal,
          effective.playbackVolume,
          playChime,
        );

        if (playback.cleanupWarning !== undefined) {
          warnings.push(playback.cleanupWarning);
        }

        return toAttempt("speech", player.id, playback);
      } catch {
        return {
          ok: false,
          mode: "speech",
          handler: "speech",
          reason: "Speech delivery failed.",
        };
      }
    };
  }

  const sound = async (): Promise<DeliveryAttempt> => {
    try {
      signal?.throwIfAborted();
      // A completed prelude has already delivered the normal fallback sound.
      if (chimePlayed) return toAttempt("sound", player.id, { ok: true });
      if (settings.ok && !settings.settings.enabled) {
        missingApiKey = (await dependencies.credentialStatus?.(settings.settings.provider, signal)) === "missing";
        signal?.throwIfAborted();
      }
      return toAttempt("sound", player.id, await ring(player, signal, missingApiKey ? "missing-api-key" : "default"));
    } catch {
      return {
        ok: false,
        mode: "sound",
        handler: player.id,
        reason: "Notification sound playback failed.",
      };
    }
  };

  const delivery = await runDeliveryPolicy(
    speech === undefined ? { sound } : { speech, sound },
    signal,
  );

  return { delivery, warnings };
}
