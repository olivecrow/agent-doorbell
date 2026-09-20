---
name: doorbell
description: Use Doorbell for explicit audible notification requests, requested completion notices, or a still-needed user response after a confirmed unanswered Codex response wait. Use native Codex questions and notifications first for attention requests. Do not use for ordinary progress narration or general audio production.
---

# Doorbell

Use the Doorbell MCP server from any workspace. The installed runtime and normal user settings are independent of the Doorbell source repository.

## When to Notify

For an agent-initiated attention request, use Codex's native question or notification first and leave the actionable question in the conversation. Call Doorbell only when the active agent can confirm that this request's response wait timed out or a tool that actually waited for the user's response returned without an answer, and the user's answer or action is still needed. An optional question that can be resolved with a reasonable assumption does not require escalation.

Use the current question/wait tool's contract and result. There is no assumed timeout shared by all questions or notifications; do not invent a duration. An asynchronous question tool's immediate return is not a completed response wait. Push/toast disappearance, an unrelated tool timeout, or a generic request-resolved event alone is not evidence of an unanswered response wait. If the outcome is unknown, do not infer a timeout or whether the user read the notification.

Before calling, check for a reply, cancellation, or a request that is no longer needed. Skip audio in those cases. Make at most one Doorbell call for the same unanswered request, including after failure; track that in the conversation rather than relying on source-name deduplication. A timeout is never approval: required input or authorization remains pending. Explicit requests for audio now or an audible completion notice may be fulfilled directly.

This is an agent calling policy, not an automatic connection. Do not create timers, hooks, background monitors, or automations to implement it. It cannot wake an agent after its turn ends or detect notification read receipts. If the host does not expose an applicable wait outcome, keep the text request without claiming that delayed audio is scheduled.

## Delivery

1. Call `get_instructions` to discover the current provider, default voice, enabled state, and official TTS/prompting manuals. Read the selected provider's instructions before choosing controls. Refresh discovery if the user changes settings.
2. Write the final short sentence in the language the user is using in the current conversation, unless they explicitly requested or configured a different spoken language. English tool documentation and examples do not override this rule. Match any language directions in the delivery controls to the sentence. Keep it within 120 UTF-16 code units. Send only that sentence and brief delivery directions.
3. Call `notify` with `message` and, when useful, `speech`. For OpenAI, use `speech.instructions` and optional `speech.speed`; for Gemini, use `speech.prompt`. Both accept a one-call `speech.voice` override. Follow the manuals returned by `get_instructions`.
4. Derive delivery from your current personality and the present situation on every call. Summarize relevant speaking traits; never paste full system instructions, conversations, or private configuration. Omit custom directions when none are needed. Do not ask the user to maintain a Doorbell personality profile.
5. Keep the actionable request in the conversation as well. A successful sound fallback does not mean the sentence was spoken or heard. Report failure briefly when audio delivery fails; do not automatically repeat a paid request.

`ring` plays only the offline sound. `doctor` silently checks the runtime, player, settings, and credential statuses without exposing keys or making a paid request.

Do not change activation, provider, playback mode, playback volume, credentials, or saved defaults unless the user requested that configuration change. Use the exact installed CLI invocation returned by `get_instructions` for configuration: `configure api-key --provider openai|gemini` and `configure speech`. Local speech gain is configured with `configure speech --volume 1.5` (range 0.25-4; default 1). If tools are unavailable, report the missing plugin connection instead of guessing that audio played.
