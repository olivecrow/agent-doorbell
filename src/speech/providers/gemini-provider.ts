import { GoogleGenAI } from "@google/genai";
import wavefile from "wavefile";
import type { GeminiSpeechSettings } from "../../config/parse-speech-settings.js";
import type {
  CredentialReader,
  CredentialResult,
} from "../../config/credentials.js";
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
import { geminiLoggingBlock } from "./gemini-request-policy.js";

const SAMPLE_RATE = 24_000;
const MAX_PCM_BYTES = SAMPLE_RATE * 2 * 60;
const GEMINI_ORIGIN = "https://generativelanguage.googleapis.com";
const INTERACTIONS_URL = GEMINI_ORIGIN + "/v1beta/interactions";

// Interactions and models use different SDK error classes. Keep only a valid
// numeric HTTP status; never expose the SDK message, body, or headers.
function httpErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error))
    return undefined;
  const status = error.status;
  return typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
    ? status
    : undefined;
}

function decodePcm(audio: {
  data?: string | undefined;
  mime_type?: string | undefined;
  sample_rate?: number | undefined;
  channels?: number | undefined;
}): Buffer | undefined {
  const data = audio.data;
  const mime = audio.mime_type
    ?.toLowerCase()
    .split(";")
    .map((part) => part.trim());
  if (
    !mime ||
    mime[0] !== "audio/l16" ||
    (audio.sample_rate !== undefined && audio.sample_rate !== SAMPLE_RATE) ||
    (audio.channels !== undefined && audio.channels !== 1)
  )
    return undefined;
  const allowedParameters = new Set(["codec=pcm", "rate=24000", "channels=1"]);
  if (mime.slice(1).some((part) => !allowedParameters.has(part)))
    return undefined;
  if (
    !data ||
    data.length > Math.ceil(MAX_PCM_BYTES / 3) * 4 ||
    data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
  )
    return undefined;

  const pcm = Buffer.from(data, "base64");
  if (
    pcm.length === 0 ||
    pcm.length > MAX_PCM_BYTES ||
    pcm.toString("base64") !== data
  )
    return undefined;

  return pcm;
}

function pcmToWav(
  audio: Parameters<typeof decodePcm>[0],
): Uint8Array | undefined {
  const pcm = decodePcm(audio);
  if (!pcm || pcm.length % 2 !== 0) return undefined;
  // Gemini returns signed little-endian PCM. Only wrap it; decoding and device
  // output remain the file player's responsibility.
  const samples = new Int16Array(pcm.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2);
  const wav = new wavefile.WaveFile();
  wav.fromScratch(1, SAMPLE_RATE, "16", samples);
  return wav.toBuffer();
}

export class GeminiSpeechProvider implements SpeechProvider {
  readonly id = "gemini";
  readonly capabilities: SpeechProviderCapabilities = {
    networkRequired: true,
    billing: "usage-billed",
    outputFormats: ["wav", "pcm"],
    supportsStyle: true,
    // The decoder is retained for tests and future revalidation. Local live
    // evidence showed ~0.22x real-time generation and severe audible gaps.
    supportsStreaming: false,
    streamingUnavailableReason:
      "Gemini streaming is not enabled because continuous playback failed local validation.",
  };
  private readonly settings: GeminiSpeechSettings;

  constructor(
    settings: GeminiSpeechSettings,
    private readonly credentials: CredentialReader,
    private readonly timeoutMs = settings.playbackMode === "streaming"
      ? 60_000
      : 15_000,
  ) {
    this.settings = { ...settings };
  }

  private checkSettings(): CapabilityAvailability {
    if (!this.settings.enabled)
      return { available: false, reason: "Speech is disabled." };
    const reason = geminiLoggingBlock();
    if (reason) return { available: false, reason };
    return { available: true };
  }

  private async readApiKey(
    signal: AbortSignal,
  ): Promise<CredentialResult<string>> {
    signal.throwIfAborted();
    const credential = await this.credentials.read(signal);
    signal.throwIfAborted();
    if (!credential.ok) return credential;
    const apiKey = credential.value?.trim();
    return apiKey
      ? { ok: true, value: apiKey }
      : { ok: false, reason: "Gemini API key is not configured." };
  }

  async check(signal?: AbortSignal): Promise<CapabilityAvailability> {
    const availability = this.checkSettings();
    if (!availability.available) return availability;
    const cancellation = new AbortController();
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const operationSignal = AbortSignal.any([
      cancellation.signal,
      timeoutSignal,
      ...(signal ? [signal] : []),
    ]);
    try {
      const credential = await this.readApiKey(operationSignal);
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
    if (!availability.available)
      return { ok: false, reason: availability.reason };
    let input: string;
    let options: SpeechOptions;
    try {
      input = normalizeAttentionMessage(request.message);
      options = normalizeSpeechOptions(request.speech, "gemini");
    } catch {
      return {
        ok: false,
        reason:
          "Invalid Gemini speech message or options. Read doorbell agent-instructions.",
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
      const credential = await this.readApiKey(operationSignal);
      if (!credential.ok) return { ok: false, reason: credential.reason };
      // The credential read may have yielded before SDK construction.
      const loggingBlock = geminiLoggingBlock();
      if (loggingBlock) return { ok: false, reason: loggingBlock };

      const client = new GoogleGenAI({
        // The SDK requires a value to select API-key authentication. Only the
        // final HTTPS transport below receives the actual credential.
        apiKey: "doorbell-transport-auth",
        vertexai: false,
        enterprise: false,
        apiVersion: "v1beta",
        httpOptions: {
          baseUrl: GEMINI_ORIGIN,
          retryOptions: { attempts: 1 },
          timeout: this.timeoutMs,
          fetch: (url, init) => {
            const request = new Request(url, init);
            if (request.url !== INTERACTIONS_URL || request.method !== "POST")
              throw new Error("Unexpected Gemini request destination or method.");
            const headers = new Headers(request.headers);
            headers.delete("authorization");
            headers.set("x-goog-api-key", credential.value);
            return globalThis.fetch(request, {
              headers,
              signal: AbortSignal.any([operationSignal, request.signal]),
              redirect: "error",
            });
          },
        },
      });

      const instructions = [
        "Generate speech for exactly the transcript below. Do not speak the instructions or section labels. Do not answer, translate, or add to the transcript.",
        ...(options.prompt === undefined ? [] : ["", options.prompt]),
        "",
        "Transcript:",
        input,
      ].join("\n");
      const parameters = {
        model: this.settings.model,
        input: instructions,
        // This TTS model rejects an explicit audio/l16 output selection.
        // Its default audio response supplies PCM, validated before wrapping.
        response_format: { type: "audio" as const },
        generation_config: {
          speech_config: [{ voice: options.voice ?? this.settings.voice }],
        },
        store: false,
      };
      if (this.settings.playbackMode === "streaming") {
        const stream = await client.interactions.create(
          { ...parameters, stream: true },
          { signal: operationSignal, timeout: this.timeoutMs, maxRetries: 0 },
        );
        const chunks = async function* () {
          let completed = false;
          let metadata: Omit<Parameters<typeof decodePcm>[0], "data"> = {};
          for await (const event of stream) {
            operationSignal.throwIfAborted();
            if (event.event_type === "error")
              throw new Error("Gemini audio stream failed.");
            if (event.event_type === "interaction.completed") {
              if (
                event.interaction.status &&
                event.interaction.status !== "completed"
              )
                throw new Error("Gemini speech was not completed.");
              completed = true;
              break;
            }
            if (
              event.event_type === "step.delta" &&
              event.delta.type === "audio"
            ) {
              const delta = event.delta;
              metadata = {
                ...metadata,
                ...(delta.mime_type === undefined
                  ? {}
                  : { mime_type: delta.mime_type }),
                ...(delta.sample_rate === undefined
                  ? {}
                  : { sample_rate: delta.sample_rate }),
                ...(delta.channels === undefined
                  ? {}
                  : { channels: delta.channels }),
              };
              if (delta.data === undefined) continue;
              const pcm = decodePcm({ ...metadata, data: delta.data });
              if (!pcm)
                throw new Error(
                  "Gemini returned invalid or unsupported PCM audio.",
                );
              yield pcm;
            }
          }
          operationSignal.throwIfAborted();
          if (!completed)
            throw new Error("Gemini audio stream ended before completion.");
        };
        return {
          ok: true,
          audio: streamingAudio(chunks(), () => {
            cancellation.abort();
            void stream.cancel().catch(() => {});
          }),
        };
      }
      const response = await client.interactions.create(
        { ...parameters, stream: false },
        { signal: operationSignal, timeout: this.timeoutMs, maxRetries: 0 },
      );
      operationSignal.throwIfAborted();

      if (response.status !== "completed" || !response.output_audio) {
        return {
          ok: false,
          reason: "Gemini did not return completed speech audio.",
        };
      }
      const bytes = pcmToWav(response.output_audio);
      operationSignal.throwIfAborted();
      if (bytes === undefined)
        return {
          ok: false,
          reason: "Gemini returned invalid or unsupported speech audio.",
        };
      return { ok: true, audio: { mode: "buffered", format: "wav", bytes } };
    } catch (error: unknown) {
      if (operationSignal.aborted)
        return {
          ok: false,
          reason: signal?.aborted
            ? "Speech synthesis was cancelled."
            : "Speech synthesis timed out.",
        };
      const status = httpErrorStatus(error);
      return {
        ok: false,
        reason:
          status === undefined
            ? "Gemini speech request failed."
            : `Gemini speech request failed (HTTP ${status}).`,
        ...(status === undefined ? {} : { status }),
      };
    }
  }
}
