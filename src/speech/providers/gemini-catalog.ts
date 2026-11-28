import { stripVTControlCharacters } from "node:util";
import { z } from "zod";
import type { CredentialReader } from "../../config/credentials.js";
import { decodeBoundedWav } from "../audio.js";
import { readApiKey } from "../read-api-key.js";
import { GEMINI_ORIGIN } from "./gemini-request-policy.js";
import {
  canonicalGeminiPreset,
  GEMINI_TTS_VOICES,
  isGeminiCatalogVoiceId,
  isGeminiStoredVoiceId,
  isGeminiTtsModel,
  type GeminiTtsModel,
} from "./gemini.js";

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_SAMPLE_BYTES = 3 * 1024 * 1024;
const MAX_PAGES = 20;

export class GeminiCatalogError extends Error {}

export interface GeminiCatalogModel {
  readonly id: GeminiTtsModel;
  readonly name: string;
}

export interface GeminiCatalogVoice {
  readonly id: string;
  readonly name: string;
  readonly type: "prebuilt" | "prompted" | "replicated";
  readonly language?: string;
  readonly canPreview: boolean;
}

const modelPage = z.object({
  models: z.array(z.object({ name: z.string(), displayName: z.string().optional() })).optional(),
  nextPageToken: z.string().optional(),
});

const voicePage = z.object({
  voices: z.array(z.object({
    id: z.string().optional(),
    type: z.string(),
    display_name: z.string().optional(),
    language_code: z.string().optional(),
  })).optional(),
  next_page_token: z.string().optional(),
  nextPageToken: z.string().optional(),
});

const voiceDetails = z.object({
  id: z.string(),
  type: z.string(),
  sample_audio: z.object({ mime_type: z.string(), data: z.string() }).optional(),
});

function displayText(value: string | undefined): string {
  return stripVTControlCharacters(value ?? "").replace(/\p{C}/gu, "").trim().slice(0, 120);
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new GeminiCatalogError("Gemini returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new GeminiCatalogError("The Gemini catalog response is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Use the REST endpoints directly because the pinned synthesis SDK predates Voices. */
export class GeminiCatalog {
  constructor(private readonly credentials: CredentialReader) {}

  private async query<T>(
    signal: AbortSignal,
    operation: (get: (url: URL) => Promise<unknown>) => Promise<T>,
  ): Promise<T> {
    const deadline = AbortSignal.timeout(15_000);
    const requestSignal = AbortSignal.any([signal, deadline]);
    try {
      const credential = await readApiKey(this.credentials, "Gemini", requestSignal);
      if (!credential.ok) throw new GeminiCatalogError(credential.reason);
      return await operation(async (url) => {
        // URLs and paths are constructed locally. Never follow redirects with the key.
        const response = await fetch(url, {
          headers: { "x-goog-api-key": credential.value },
          signal: requestSignal,
          redirect: "error",
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          throw new GeminiCatalogError(`Gemini catalog request failed (HTTP ${response.status}).`);
        }
        const body = await readJson(response);
        requestSignal.throwIfAborted();
        return body;
      });
    } catch (error) {
      signal.throwIfAborted();
      if (deadline.aborted) throw new GeminiCatalogError("The Gemini catalog request timed out.");
      if (error instanceof GeminiCatalogError) throw error;
      throw new GeminiCatalogError("Could not read the Gemini catalog response.");
    }
  }

  listModels(signal: AbortSignal): Promise<GeminiCatalogModel[]> {
    return this.query(signal, async (get) => {
      const url = new URL("/v1beta/models", GEMINI_ORIGIN);
      url.searchParams.set("pageSize", "100");
      const models = new Map<GeminiTtsModel, GeminiCatalogModel>();
      for (let page = 0; page < MAX_PAGES; page++) {
        const response = modelPage.parse(await get(url));
        for (const model of response.models ?? []) {
          const id = model.name.replace(/^models\//, "");
          if (isGeminiTtsModel(id)) models.set(id, { id, name: displayText(model.displayName) || id });
        }
        if (!response.nextPageToken) return [...models.values()];
        url.searchParams.set("pageToken", response.nextPageToken);
      }
      throw new GeminiCatalogError("The Gemini model catalog returned too many pages.");
    });
  }

  listVoices(signal: AbortSignal): Promise<GeminiCatalogVoice[]> {
    return this.query(signal, async (get) => {
      const url = new URL("/v1beta/voices", GEMINI_ORIGIN);
      // The live service returns a snake_case cursor but reads the camelCase query parameter.
      url.searchParams.set("pageSize", "500");
      const voices = new Map<string, GeminiCatalogVoice>();
      for (let page = 0; page < MAX_PAGES; page++) {
        const response = voicePage.parse(await get(url));
        for (const { id, type, display_name, language_code } of response.voices ?? []) {
          if (
            id === undefined || !isGeminiCatalogVoiceId(id) ||
            (type !== "prebuilt" && type !== "prompted" && type !== "replicated") ||
            (type !== "prebuilt" && !isGeminiStoredVoiceId(id))
          ) continue;
          const voiceId = (type === "prebuilt" ? canonicalGeminiPreset(id) : undefined) ?? id;
          const language = displayText(language_code);
          voices.set(voiceId, {
            id: voiceId, type, name: displayText(display_name) || voiceId,
            ...(language ? { language } : {}),
            canPreview: type === "prompted",
          });
        }
        const nextPage = response.next_page_token ?? response.nextPageToken;
        if (!nextPage) {
          const studioVoices = GEMINI_TTS_VOICES.flatMap((id) => {
            const voice = voices.get(id);
            voices.delete(id);
            return voice === undefined ? [] : [voice];
          });
          return [...studioVoices, ...voices.values()];
        }
        if (nextPage === url.searchParams.get("pageToken"))
          throw new GeminiCatalogError("The Gemini voice catalog repeated a page cursor.");
        url.searchParams.set("pageToken", nextPage);
      }
      throw new GeminiCatalogError("The Gemini voice catalog returned too many pages.");
    });
  }

  getVoiceSample(id: string, signal: AbortSignal): Promise<Buffer> {
    if (!isGeminiStoredVoiceId(id))
      throw new GeminiCatalogError("Gemini provides downloadable previews for stored designed voices only.");
    return this.query(signal, async (get) => {
      const url = new URL(`/v1beta/voices/${encodeURIComponent(id)}`, GEMINI_ORIGIN);
      const voice = voiceDetails.parse(await get(url));
      if (voice.id !== id || voice.type !== "prompted" || !voice.sample_audio)
        throw new GeminiCatalogError("Gemini did not provide a preview for this voice.");
      const bytes = voice.sample_audio.mime_type === "audio/wav"
        ? decodeBoundedWav(voice.sample_audio.data, MAX_SAMPLE_BYTES)
        : undefined;
      if (!bytes) throw new GeminiCatalogError("Gemini returned an invalid WAV preview.");
      return bytes;
    });
  }
}
