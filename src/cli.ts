#!/usr/bin/env node
import { loadSpeechSettings } from "./config/load-speech-settings.js";
import {
  normalizeAttentionMessage,
  type AttentionRequest,
} from "./domain/attention.js";
import { parseArgs } from "node:util";
import { configureApiKey } from "./commands/configure-api-key.js";
import {
  configureSpeech,
  type SpeechSettingsPatch,
} from "./commands/configure-speech.js";
import {
  InvalidSpeechOptionsError,
  normalizeSpeechOptions,
} from "./speech/options.js";
import {
  DEFAULT_SPEECH_PROVIDER,
  SPEECH_PROVIDERS,
  SPEECH_PROVIDER_CATALOG,
  isSpeechProviderId,
  isSpeechVoice,
  type SpeechProviderId,
} from "./speech/providers/catalog.js";
import { getAppPaths } from "./config/app-path.js";
import { KeyringCredentialStore } from "./config/keyring-credential-store.js";
import {
  InvalidHookError,
  parseHook,
  readHookInput,
  type HookAgent,
} from "./commands/hook.js";

import {
  deliverNotification,
  playNotificationSound,
  inspectEnvironment,
} from "./runtime.js";
import { getAgentInstructions } from "./commands/agent-instructions.js";

import { isSpeechPlaybackMode } from "./config/speech.js";
import { isPlaybackVolume } from "./audio/playback-volume.js";

type CliCommand =
  | {
      kind: "ring";
      event: string | undefined;
      message: string | undefined;
    }
  | { kind: "doctor"; json: boolean; playSound: boolean }
  | { kind: "help" }
  | { kind: "unknown"; value: string }
  | { kind: "invalid"; message: string }
  | { kind: "notify"; request: AttentionRequest }
  | { kind: "hook"; agent: HookAgent; payload?: string }
  | { kind: "configure-api-key"; provider: SpeechProviderId }
  | { kind: "configure-speech"; patch?: SpeechSettingsPatch }
  | { kind: "show-speech" }
  | { kind: "list-voices"; provider?: SpeechProviderId }
  | { kind: "agent-instructions" };

async function main(args: readonly string[]): Promise<void> {
  const command = parseCommand(args);
  const controller = new AbortController();

  let cancellationExitCode: number | undefined;

  function onInterrupt(): void {
    cancellationExitCode ??= 130;
    controller.abort();
  }

  function onTerminate(): void {
    cancellationExitCode ??= 143;
    controller.abort();
  }

  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);

  try {
    process.exitCode = await runCommand(command, controller.signal);
  } catch (error: unknown) {
    if (!controller.signal.aborted) {
      throw error;
    }
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);

    if (controller.signal.aborted) {
      console.error("[doorbell] Command cancelled.");
      process.exitCode = cancellationExitCode ?? 130;
    }
  }
}

function parseCommand(args: readonly string[]): CliCommand {
  const [first, ...rest] = args;

  if (first === undefined || first === "--help" || first === "-h") {
    return { kind: "help" };
  }

  if (first === "configure") {
    const [target, ...options] = rest;
    if (target === undefined || target === "--help" || target === "-h")
      return { kind: "help" };
    if (
      options.length === 1 &&
      (options[0] === "--help" || options[0] === "-h")
    )
      return { kind: "help" };
    if (target === "api-key") {
      try {
        const { values } = parseArgs({
          args: options,
          options: { provider: { type: "string" } },
          strict: true,
          allowPositionals: false,
        });
        const provider = values.provider ?? DEFAULT_SPEECH_PROVIDER;
        if (!isSpeechProviderId(provider)) throw new Error();
        return { kind: "configure-api-key", provider };
      } catch {
        return {
          kind: "invalid",
          message:
            "Use configure api-key [--provider openai|gemini]. Never pass API keys as arguments.",
        };
      }
    }
    if (target === "speech") {
      if (options.length === 0) return { kind: "configure-speech" };
      try {
        const { values } = parseArgs({
          args: options,
          options: {
            provider: { type: "string" },
            enable: { type: "boolean" },
            disable: { type: "boolean" },
            voice: { type: "string" },
            show: { type: "boolean" },
            "list-voices": { type: "boolean" },
            "playback-mode": { type: "string" },
            volume: { type: "string" },
          },
          strict: true,
          allowPositionals: false,
        });
        const provider = values.provider;
        const voice = values.voice;
        const playbackMode = values["playback-mode"];
        const playbackVolume =
          values.volume === undefined ? undefined : Number(values.volume);
        if (playbackVolume !== undefined && !isPlaybackVolume(playbackVolume))
          throw new Error();
        if (playbackMode !== undefined && !isSpeechPlaybackMode(playbackMode))
          throw new Error();
        if (values.enable && values.disable) throw new Error();
        if (provider !== undefined && !isSpeechProviderId(provider))
          throw new Error();
        if (values.show) {
          if (Object.keys(values).length !== 1) throw new Error();
          return { kind: "show-speech" };
        }
        if (values["list-voices"]) {
          if (
            Object.keys(values).some(
              (key) => key !== "list-voices" && key !== "provider",
            )
          )
            throw new Error();
          return {
            kind: "list-voices",
            ...(provider === undefined ? {} : { provider }),
          };
        }
        if (
          voice !== undefined &&
          !(provider !== undefined
            ? isSpeechVoice(provider, voice)
            : SPEECH_PROVIDERS.some((candidate) =>
                isSpeechVoice(candidate, voice),
              ))
        )
          throw new Error();
        return {
          kind: "configure-speech",
          patch: {
            ...(playbackMode === undefined ? {} : { playbackMode }),
            ...(playbackVolume === undefined ? {} : { playbackVolume }),
            ...(provider === undefined ? {} : { provider }),
            ...(values.enable
              ? { enabled: true }
              : values.disable
                ? { enabled: false }
                : {}),
            ...(values.voice === undefined ? {} : { voice: values.voice }),
          },
        };
      } catch {
        return {
          kind: "invalid",
          message:
            "Invalid speech options. Use --help for supported options; do not combine conflicting actions.",
        };
      }
    }
    return {
      kind: "invalid",
      message:
        "Use configure api-key [--provider openai|gemini] or configure speech. Never pass API keys as arguments.",
    };
  }

  if (first === "agent-instructions") {
    return rest.length === 0
      ? { kind: "agent-instructions" }
      : {
          kind: "invalid",
          message: "agent-instructions does not accept arguments.",
        };
  }

  if (first === "hook") {
    const [agent, payload, ...extra] = rest;
    if (
      (agent !== "codex" && agent !== "claude") ||
      extra.length > 0 ||
      (agent === "claude" && payload !== undefined)
    )
      return {
        kind: "invalid",
        message: "Use hook codex [JSON] or hook claude with JSON on stdin.",
      };
    return {
      kind: "hook",
      agent,
      ...(payload === undefined ? {} : { payload }),
    };
  }

  if (first === "notify") {
    try {
      const { values } = parseArgs({
        args: rest,
        options: {
          message: { type: "string" },
          source: { type: "string" },
          voice: { type: "string" },
          instructions: { type: "string" },
          speed: { type: "string" },
          prompt: { type: "string" },
        },
        strict: true,
        allowPositionals: false,
      });

      if (values.message === undefined) {
        throw new Error("--message is required");
      }

      const message = normalizeAttentionMessage(values.message);
      const speech = normalizeSpeechOptions({
        ...(values.voice === undefined ? {} : { voice: values.voice }),
        ...(values.instructions === undefined
          ? {}
          : { instructions: values.instructions }),
        ...(values.speed === undefined ? {} : { speed: Number(values.speed) }),
        ...(values.prompt === undefined ? {} : { prompt: values.prompt }),
      });

      return {
        kind: "notify",
        request: {
          message,
          ...(values.source === undefined ? {} : { source: values.source }),
          speech,
        },
      };
    } catch (error: unknown) {
      return {
        kind: "invalid",
        message:
          "notify requires a message of 1 to 120 characters. Use --instructions/--speed for OpenAI or --prompt for Gemini (up to 2000 characters), and optional --voice. Read doorbell agent-instructions.",
      };
    }
  }

  if (first === "ring") {
    try {
      const { values } = parseArgs({
        args: rest,
        options: {
          event: { type: "string" },
          message: { type: "string" },
        },
        strict: true,
        allowPositionals: false,
      });

      return {
        kind: "ring",
        event: values.event,
        message: values.message,
      };
    } catch (error: unknown) {
      return {
        kind: "invalid",
        message: "Invalid ring arguments. Use --help for supported options.",
      };
    }
  }

  if (first === "doctor") {
    try {
      const { values } = parseArgs({
        args: rest,
        options: {
          json: { type: "boolean" },
          "play-sound": { type: "boolean" },
        },
        strict: true,
        allowPositionals: false,
      });
      return {
        kind: "doctor",
        json: values.json ?? false,
        playSound: values["play-sound"] ?? false,
      };
    } catch {
      return {
        kind: "invalid",
        message: "Use doctor [--json] [--play-sound].",
      };
    }
  }

  return { kind: "unknown", value: first };
}

function printHelp(): void {
  console.log(`Usage:
  doorbell notify --message <text> [--source <name>] [--voice <name>]
                 [--instructions <text>] [--speed <0.25-4.0>]  (OpenAI)
                 [--prompt <text>]                          (Gemini)
  doorbell ring [--event <name>] [--message <text>]
  doorbell hook codex [JSON]
  doorbell hook claude                 (JSON on stdin)
  doorbell configure api-key [--provider openai|gemini]
  doorbell configure speech
  doorbell configure speech [--provider openai|gemini] [--enable | --disable] [--voice <name>]
  doorbell configure speech --playback-mode buffered|streaming
  doorbell configure speech --volume <0.25-4> (local speech gain; default 1)
  doorbell configure speech --show
  doorbell configure speech --list-voices [--provider openai|gemini]
  doorbell agent-instructions
  doorbell doctor [--json] [--play-sound]
  doorbell --help

API keys are entered interactively and stored separately by provider in the OS credential store.
configure api-key defaults to OpenAI; use --provider gemini for a Gemini API key.
Speech settings are independent. Default provider: OpenAI (gpt-4o-mini-tts, nova).
Gemini: gemini-3.1-flash-tts-preview, default voice Kore. Each provider remembers its voice.
Speech is disabled until explicitly enabled. --enable may incur charges from the selected provider.
Playback defaults to buffered; streaming uses raw PCM. A provider failure falls back to the bundled sound, never another provider.
Delivery instructions, prompts, speed, and voice overrides apply only to the current notify call.
Tone is never saved. Old saved tones are ignored. Instructions/prompt allow up to 2000 characters.
Gemini appends --message as the Transcript after --prompt; describe delivery without repeating it.
AI agents: read doorbell agent-instructions before calling notify.`);
}

async function runCommand(
  command: CliCommand,
  signal: AbortSignal,
): Promise<number> {
  signal.throwIfAborted();

  switch (command.kind) {
    case "help":
      printHelp();
      return 0;

    case "agent-instructions": {
      const result = await getAgentInstructions();
      if (result.configuration) {
        console.log(
          "Current speech configuration (read-only; credentials are not checked):",
        );
        console.log(JSON.stringify(result.configuration, null, 2));
      }
      if (result.error) console.error(`[doorbell] ${result.error}`);
      console.log(result.instructions);
      return result.ok ? 0 : 1;
    }

    case "show-speech": {
      const loaded = await loadSpeechSettings(getAppPaths().speechSettingsPath);
      if (!loaded.ok) {
        console.error(`[doorbell] ${loaded.reason}`);
        return 1;
      }
      console.log(JSON.stringify(loaded.settings, null, 2));
      return 0;
    }

    case "list-voices": {
      let provider = command.provider;
      if (provider === undefined) {
        const loaded = await loadSpeechSettings(
          getAppPaths().speechSettingsPath,
        );
        if (!loaded.ok) {
          console.error(`[doorbell] ${loaded.reason}`);
          return 1;
        }
        provider = loaded.settings.provider;
      }
      const catalog = SPEECH_PROVIDER_CATALOG[provider];
      console.log(
        JSON.stringify(
          {
            provider,
            model: catalog.model,
            defaultVoice: catalog.defaultVoice,
            voices: catalog.voices,
          },
          null,
          2,
        ),
      );
      return 0;
    }

    case "configure-api-key": {
      const paths = getAppPaths();
      const result = await configureApiKey(
        {
          provider: command.provider,
          credentials: new KeyringCredentialStore(
            paths.credentialService,
            command.provider,
          ),
        },
        signal,
      );

      if (!result.ok) {
        console.error(`[doorbell] ${result.reason}`);
        return result.cancelled ? 130 : 1;
      }

      console.log("[doorbell] API key configuration complete.");
      return 0;
    }

    case "configure-speech": {
      const result = await configureSpeech(
        { settingsPath: getAppPaths().speechSettingsPath },
        signal,
        command.patch,
      );
      if (!result.ok) {
        console.error(`[doorbell] ${result.reason}`);
        return result.cancelled ? 130 : 1;
      }
      console.log("[doorbell] Speech settings saved.");
      return 0;
    }

    case "hook": {
      try {
        if (command.payload === undefined && process.stdin.isTTY)
          throw new InvalidHookError(
            "Hook input must be provided as JSON, not an interactive terminal.",
          );
        const input =
          command.payload ?? (await readHookInput(process.stdin, signal));
        const request = parseHook(command.agent, input);
        return request
          ? await runCommand({ kind: "notify", request }, signal)
          : 0;
      } catch (error) {
        if (!(error instanceof InvalidHookError)) throw error;
        console.error(`[doorbell] ${error.message}`);
        return 2;
      }
    }

    case "notify": {
      let result;
      try {
        result = await deliverNotification(command.request, signal);
      } catch (error) {
        if (!(error instanceof InvalidSpeechOptionsError)) throw error;
        console.error(`[doorbell] Invalid speech options: ${error.message}`);
        return 2;
      }

      for (const warning of result.warnings) {
        console.error(`[doorbell] ${warning}`);
      }

      if (!result.delivery.ok && result.delivery.cancelled) {
        return 130;
      }

      for (const attempt of result.delivery.attempts) {
        if (!attempt.ok) {
          console.error(`[doorbell] ${attempt.mode} failed: ${attempt.reason}`);
        }
      }

      return result.delivery.ok ? 0 : 1;
    }

    case "ring":
      const result = await playNotificationSound(signal);

      if (signal.aborted) {
        return 130;
      }

      if (!result.ok) {
        console.error(`[doorbell] Audio playback failed: ${result.reason}`);
        return 1;
      }

      return 0;

    case "doctor": {
      const report = await inspectEnvironment(signal, command.playSound);
      if (command.json) console.log(JSON.stringify(report, null, 2));
      else {
        console.log(
          `Runtime: Node ${report.runtime.node} (${report.runtime.platform}/${report.runtime.arch})`,
        );
        console.log(`Settings: ${report.configuration.path}`);
        console.log(
          `Player: ${report.player.id} (${report.player.available ? "available" : "unavailable"})`,
        );
        console.log(
          `OpenAI key: ${report.credentials.openai}\nGemini key: ${report.credentials.gemini}`,
        );
        console.log(
          `Sound ready: ${report.soundReady}\nSpeech ready: ${report.speechReady}`,
        );
        console.log(JSON.stringify(report.configuration, null, 2));
        if (report.playbackTest)
          console.log(
            `Sound test: ${report.playbackTest.ok ? "completed" : "failed"}`,
          );
        for (const note of report.notes) console.log(note);
      }
      return report.ok ? 0 : 1;
    }

    case "unknown":
      console.error("Unknown command.");
      printHelp();
      return 2;

    case "invalid":
      console.error(`Invalid arguments: ${command.message}`);
      printHelp();
      return 2;
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const reason =
    error instanceof Error ? error.message : "Unexpected command failure";

  console.error(`[doorbell] Command failed: ${reason}`);
  process.exitCode = 1;
});
