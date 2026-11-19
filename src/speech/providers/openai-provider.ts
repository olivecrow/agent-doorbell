import OpenAI from "openai";
import type { OpenAiSpeechSettings } from "../../config/parse-speech-settings.js";
import { normalizeAttentionMessage } from "../../domain/attention.js";
import type { CapabilityAvailability } from "../../domain/results.js";
import type { SpeechSynthesisResult } from "../failure.js";
import type {
  SpeechProvider,
  SpeechProviderCapabilities,
  SpeechSynthesisRequest,
} from "../provider.js";
import { normalizeSpeechOptions, type SpeechOptions } from "../options.js";
import { streamingAudio } from "../pcm-stream.js";
import type { CredentialReader } from "../../config/credentials.js";
import { readApiKey } from "../read-api-key.js";

export class OpenAiSpeechProvider implements SpeechProvider {
  readonly id = "openai";

  readonly capabilities: SpeechProviderCapabilities = {
    networkRequired: true,
    billing: "usage-billed",
    outputFormats: ["wav", "pcm"],
    supportsStyle: true,
    supportsStreaming: true,
  };

  private readonly settings: OpenAiSpeechSettings;
  constructor(
    settings: OpenAiSpeechSettings,
    private readonly credentials: CredentialReader,
    private readonly timeoutMs = settings.playbackMode === "streaming"
      ? 60_000
      : 15_000,
  ) {
    this.settings = { ...settings };
  }

  private checkSettings(): CapabilityAvailability {
    if (!this.settings.enabled) {
      return {
        available: false,
        reason: "Speech is disabled.",
      };
    }

    return { available: true };
  }


  async check(signal?: AbortSignal): Promise<CapabilityAvailability> {
    const availability = this.checkSettings();

    if (!availability.available) {
      return availability;
    }

    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const operationSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;

    try {
      const credential = await readApiKey(this.credentials, "OpenAI", operationSignal);

      return credential.ok
        ? { available: true }
        : { available: false, reason: credential.reason };
    } catch {
      return {
        available: false,
        reason: signal?.aborted
          ? "Speech availability check was cancelled."
          : operationSignal.aborted
            ? "Speech availability check timed out."
            : "Could not check speech availability.",
      };
    }
  }

  async synthesize(
    request: SpeechSynthesisRequest,
    signal?: AbortSignal,
  ): Promise<SpeechSynthesisResult> {
    const availability = this.checkSettings();

    if (!availability.available) {
      return { ok: false, reason: availability.reason };
    }

    let input: string;
    let options: SpeechOptions;

    try {
      input = normalizeAttentionMessage(request.message);
      options = normalizeSpeechOptions(request.speech, "openai");
    } catch {
      return {
        ok: false,
        reason:
          "Invalid OpenAI speech message or options. Read doorbell agent-instructions.",
      };
    }

    const cancellation = new AbortController();
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const operationSignal = AbortSignal.any([
      cancellation.signal,
      timeoutSignal,
      ...(signal ? [signal] : []),
    ]);

    try {
      operationSignal.throwIfAborted();

      const credential = await readApiKey(this.credentials, "OpenAI", operationSignal);

      if (!credential.ok) return credential;

      const apiKey = credential.value;

      const client = new OpenAI({
        apiKey,
        baseURL: "https://api.openai.com/v1",
        maxRetries: 0,
        timeout: this.timeoutMs,
        logLevel: "off",

        // Keep cancellation active until the entire response body is read.
        fetch: (url, init) => {
          const fetchSignal = init?.signal
            ? AbortSignal.any([operationSignal, init.signal])
            : operationSignal;

          return globalThis.fetch(url, {
            ...init,
            signal: fetchSignal,
            redirect: "error",
          });
        },
      });

      const response = await client.audio.speech.create(
        {
          model: this.settings.model,
          voice: options.voice ?? this.settings.voice,
          input,
          ...(options.instructions === undefined
            ? {}
            : { instructions: options.instructions }),
          ...(options.speed === undefined ? {} : { speed: options.speed }),
          response_format:
            this.settings.playbackMode === "streaming" ? "pcm" : "wav",
          ...(this.settings.playbackMode === "streaming"
            ? { stream_format: "audio" as const }
            : {}),
        },
        { signal: operationSignal },
      );

      if (this.settings.playbackMode === "streaming") {
        const body = response.body;
        if (!body)
          return { ok: false, reason: "OpenAI returned no audio stream." };
        const chunks = async function* () {
          const reader = body.getReader();
          try {
            while (true) {
              operationSignal.throwIfAborted();
              const part = await reader.read();
              operationSignal.throwIfAborted();
              if (part.done) break;
              yield part.value;
            }
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
        };
        return {
          ok: true,
          audio: streamingAudio(chunks(), () => {
            cancellation.abort();
            void body.cancel().catch(() => {});
          }),
        };
      }

      const bytes = new Uint8Array(await response.arrayBuffer());

      operationSignal.throwIfAborted();

      if (bytes.byteLength === 0) {
        return {
          ok: false,
          reason: "OpenAI returned empty audio.",
        };
      }

      return {
        ok: true,
        audio: {
          mode: "buffered",
          format: "wav",
          bytes,
        },
      };
    } catch (error: unknown) {
      if (operationSignal.aborted) {
        return {
          ok: false,
          reason: signal?.aborted
            ? "Speech synthesis was cancelled."
            : "Speech synthesis timed out.",
        };
      }

      if (error instanceof OpenAI.APIError) {
        if (error.status !== undefined) {
          return {
            ok: false,
            reason: "OpenAI speech request failed.",
            status: error.status,
          };
        }
      }

      return {
        ok: false,
        reason: "Speech synthesis failed.",
      };
    }
  }
}
