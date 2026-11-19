---
name: doorbell
description: Use Doorbell for explicitly requested audio or completion notices. Proactively notify once with one short, actionable sentence when a required Codex question remains unanswered for 3 minutes after the native request.
---

# Doorbell

Use the Doorbell MCP server from any workspace. The installed runtime and normal user settings are independent of the Doorbell source repository.

## When to Notify

Send the native Codex question or notification first and keep the actionable question visible. Note its send time. After **3 minutes (180 seconds)** without a reply, proactively call Doorbell once if the user's input or action is still required. Speak one short, actionable sentence in the user's language. Leave explanations in the conversation.

Continue independent work during the interval. When blocked, use an active-turn wait that can receive user input. Measure from the original request. An immediate async return, a shorter timeout, or a disappearing toast does not establish three minutes of waiting. If a turn ends, recheck at the next active opportunity. Do not schedule a background wakeup.

Immediately before delivery, check for an answer, cancellation, completed action, or obsolete request. Skip optional questions you can resolve yourself. Record the attempt before calling and make at most one Doorbell call for the same request across turns and rewordings, even if audio fails. A pending approval still needs affirmative authorization. Explicitly requested audio or completion notices may be delivered directly.

## Delivery

1. Call `get_instructions` to discover the current provider, default voice, enabled state, and official TTS/prompting manuals. Read the selected provider's instructions before choosing controls. Refresh discovery if the user changes settings.
2. Write the final short sentence in the language the user is using in the current conversation, unless they explicitly requested or configured a different spoken language. English tool documentation and examples do not override this rule. Match any language directions in the delivery controls to the sentence. Keep it within 120 UTF-16 code units. Send only that sentence and brief delivery directions.
3. Call `notify` with `message` and, when useful, `speech`. For OpenAI, use `speech.instructions` and optional `speech.speed`; for Gemini, use `speech.prompt`. Both accept a one-call `speech.voice` override. Follow the manuals returned by `get_instructions`.
4. Derive delivery from your current personality and the present situation on every call. Summarize relevant speaking traits; never paste full system instructions, conversations, or private configuration. Omit custom directions when none are needed. Do not ask the user to maintain a Doorbell personality profile.
5. Keep the actionable request in the conversation as well. A successful sound fallback does not mean the sentence was spoken or heard. Report failure briefly when audio delivery fails; do not automatically repeat a paid request.

`ring` plays only the offline sound. `doctor` silently checks the runtime, player, settings, and credential statuses without exposing keys or making a paid request.

Do not change activation, provider, playback mode, playback volume, credentials, or saved defaults unless the user requested that configuration change. Use the exact installed CLI invocation returned by `get_instructions` for configuration: `configure api-key --provider openai|gemini` and `configure speech`. Local speech gain is configured with `configure speech --volume 1.5` (range 0.25-4; default 1). If tools are unavailable, report the missing plugin connection instead of guessing that audio played.
