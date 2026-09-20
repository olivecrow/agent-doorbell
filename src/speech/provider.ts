import type { CapabilityAvailability } from "../domain/results.js";
import type { SpeechSynthesisResult } from "./failure.js";
import type { SpeechOptions } from "./options.js";

export interface SpeechSynthesisRequest {
  readonly message: string;
  readonly speech?: SpeechOptions;
}

export interface SpeechProviderDescriptor {
  readonly id: string;
}

export type SpeechBilling = "usage-billed" | "unknown";

export interface SpeechProviderCapabilities {
  readonly networkRequired: boolean;
  readonly billing: SpeechBilling;
  readonly outputFormats: readonly string[];
  readonly supportsStyle: boolean;
  readonly supportsStreaming?: boolean;
  readonly streamingUnavailableReason?: string;
}

export interface SpeechProvider extends SpeechProviderDescriptor {
  readonly capabilities: SpeechProviderCapabilities;
  check(signal?: AbortSignal): Promise<CapabilityAvailability>;
  synthesize(
    request: SpeechSynthesisRequest,
    signal?: AbortSignal,
  ): Promise<SpeechSynthesisResult>;
}
