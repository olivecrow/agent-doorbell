export const GEMINI_ORIGIN = "https://generativelanguage.googleapis.com";

// The pinned Interactions SDK treats any nonempty value, including "0", as on.
export function geminiLoggingBlock(): string | undefined {
  return process.env.GOOGLE_GENAI_DEBUG
    ? "Gemini speech is unavailable while GOOGLE_GENAI_DEBUG is set. Unset it to enable private speech requests."
    : undefined;
}
