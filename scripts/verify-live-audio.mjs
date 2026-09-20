// Explicit account-backed development smoke check. Never included in npm packages.
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { getAppPaths } from "../dist/config/app-path.js";
import { loadSpeechSettings } from "../dist/config/load-speech-settings.js";
import { KeyringCredentialStore } from "../dist/config/keyring-credential-store.js";
import { createAudioPlayer } from "../dist/audio/create-player.js";
import { createSpeechProvider } from "../dist/speech/create-provider.js";
import { notify } from "../dist/commands/notify.js";
import { withDeliveryQueue } from "../dist/coordination/file-delivery-queue.js";
const { values } = parseArgs({
  options: {
    provider: { type: "string" },
    mode: { type: "string", default: "streaming" },
    run: { type: "boolean" },
  },
});
if (
  !values.run ||
  !["openai", "gemini"].includes(values.provider) ||
  !["buffered", "streaming"].includes(values.mode)
)
  throw new Error(
    "Use --run --provider openai|gemini [--mode buffered|streaming]. This makes one paid request.",
  );
const paths = getAppPaths(
  fileURLToPath(new URL("../.doorbell-dev/", import.meta.url)),
);
const loaded = await loadSpeechSettings(paths.speechSettingsPath);
if (!loaded.ok || !loaded.settings.enabled)
  throw new Error("Enable development speech before the live check.");
const settings = {
  ...loaded,
  settings: {
    ...loaded.settings,
    provider: values.provider,
    playbackMode: values.mode,
  },
};
const request =
  values.provider === "openai"
    ? {
        message: "OpenAI streaming is ready. Please listen for clear speech.",
        speech: { voice: "nova" },
      }
    : {
        message:
          "[warmly] Gemini streaming is ready. Please check that this voice sounds clear.",
        speech: {
          voice: "Puck",
          prompt:
            "Speak like a thoughtful colleague, with an easy conversational pace and a brief pause between sentences.",
        },
      };
const player = createAudioPlayer();
const started = performance.now();
const measurements = {
  chunks: 0,
  bytes: 0,
  firstChunkMs: null,
  sourceEndedMs: null,
};
const originalStream = player.playStream.bind(player);
let previousChunkAt;
const gaps = [];
player.playStream = (audio, signal) =>
  originalStream(
    {
      ...audio,
      chunks: (async function* () {
        for await (const chunk of audio.chunks) {
          const now = Math.round(performance.now() - started);
          if (previousChunkAt !== undefined) gaps.push(now - previousChunkAt);
          previousChunkAt = now;
          measurements.firstChunkMs ??= now;
          measurements.chunks++;
          measurements.bytes += chunk.length;
          yield chunk;
        }
        measurements.sourceEndedMs = Math.round(performance.now() - started);
      })(),
    },
    signal,
  );
const controller = new AbortController();
const onInterrupt = () => controller.abort();
process.once("SIGINT", onInterrupt);
process.once("SIGTERM", onInterrupt);
try {
  const result = await withDeliveryQueue(
    () =>
      notify(
        request,
        {
          settings,
          player,
          createProvider: (selected) =>
            createSpeechProvider(
              selected,
              new KeyringCredentialStore(
                paths.credentialService,
                selected.provider,
              ),
            ),
        },
        controller.signal,
      ),
    "live-verification",
    controller.signal,
  );
  console.log(
    JSON.stringify({
      provider: values.provider,
      mode: values.mode,
      ...result,
      measurements: {
        ...measurements,
        largestGapsMs: gaps.sort((a, b) => b - a).slice(0, 8),
      },
      elapsedMs: Math.round(performance.now() - started),
    }),
  );
  process.exitCode =
    result.delivery.ok && result.delivery.mode === "speech" ? 0 : 1;
} finally {
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onInterrupt);
}
