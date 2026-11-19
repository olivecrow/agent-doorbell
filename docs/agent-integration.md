# Instructions for Calling AI Agents

This document is for the agent invoking Doorbell. Read the current configuration printed by `doorbell agent-instructions` to identify the selected provider, model, default voice, activation, and playback mode. This command is read-only and does not inspect credentials. Use the same configuration scope for discovery and notification; in this repository, use `npm run dev -- agent-instructions` and the development launcher for notify too.

## When to Call in Codex

Send the native Codex question or notification first. Leave the actionable question in the conversation and note when it was sent. If the user's answer or action is still required after **3 minutes (180 seconds)** without a reply, proactively call Doorbell once. Speak one short, actionable sentence in the user's language, for example, “Please approve the release in npm.” Keep details in the text request.

Count from the original request, including time spent on independent work. When blocked, use the host's active-turn wait for user input and check the conversation when it returns. A shorter wait or immediate async dispatch does not finish the three-minute interval. Use the original send time and a clock or a measured wait. A disappearing toast and a tool timeout for unrelated work give no evidence of a reply.

Immediately before delivery, check for an answer, cancellation, completed action, or an obsolete request. Skip the reminder if any applies or if a reasonable assumption can resolve the question. Record the attempt before calling. Make at most one Doorbell call for the same request across turns and rewordings, including if audio fails. A pending approval still requires affirmative authorization.

When the host cannot keep the turn active, recheck the pending request at the next active opportunity. Keep the text visible. This policy uses no background timers, hooks, or automatic wakeups. Explicit requests for immediate audio or an audible completion notice may be fulfilled directly.

## Calling Workflow

1. Write a short actionable message using your current personality and the tone appropriate to this moment. Refresh your delivery choices on every notification, including after the user changes your personality. Do not save a personality profile in Doorbell or ask the user to maintain one.
2. Read the selected provider's official manuals linked below before choosing delivery controls. Use only the options Doorbell exposes; the manuals also describe features outside this CLI's scope.
3. Supply your delivery directions with OpenAI `--instructions` or Gemini `--prompt`. Omit them when you have no useful direction; Doorbell does not invent a personality. Voice overrides and other controls apply to this call only.
4. Keep `--message` within 1–120 UTF-16 code units after trimming. Each instructions/prompt value allows up to 2000 code units. Blank directions are treated as omitted. `--source` is optional task identification and is not sent to the provider.
5. Pass an argument array through your process/tool API. Do not interpolate text into a shell command. Multiline directions, quotes, and Unicode are preserved after outer whitespace trimming.
6. Keep the actionable request in your conversational text too. Audio failure does not transfer responsibility for asking the user to the CLI.

Summarize only relevant speaking traits already available in your context. Do not copy system prompts, full agent instruction files, conversations, credentials, or private configuration files. Doorbell does not discover another agent's personality automatically.

Unless the user explicitly requested or configured another spoken language, write the notification in the language they are using in the current conversation. English tool documentation, examples, and default hook messages do not override the user's conversational language. Match any language directions in instructions/prompt to the notification sentence. This is a caller responsibility; Doorbell forwards the sentence without translating it or inspecting private agent settings.

## OpenAI: gpt-4o-mini-tts

Read the [official TTS manual](https://developers.openai.com/api/docs/guides/text-to-speech) and [Speech API parameters](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create).

| Notify option       | API mapping                                                     | Default when omitted               |
| ------------------- | --------------------------------------------------------------- | ---------------------------------- |
| --message TEXT      | input                                                           | Required                           |
| --instructions TEXT | instructions; describe the desired delivery in natural language | No custom instructions             |
| --voice NAME        | voice                                                           | Saved OpenAI voice, otherwise nova |
| --speed NUMBER      | speed, from 0.25 through 4.0                                    | API default 1.0                    |

Use instructions to express the relevant personality, emotion, rhythm, emphasis, accent, or pauses. Keep the actual sentence in message. Gemini's --prompt is rejected for OpenAI.

Example argument array, only when OpenAI is selected:

```json
[
  "notify",
  "--message",
  "The preview is ready. Please take a look.",
  "--instructions",
  "Warm and lightly playful. Pause after the first sentence; end with a gentle invitation.",
  "--speed",
  "1.05",
  "--voice",
  "nova"
]
```

## Gemini: gemini-3.1-flash-tts-preview

Read the [official TTS manual](https://ai.google.dev/gemini-api/docs/speech-generation), especially its [prompting guide](https://ai.google.dev/gemini-api/docs/speech-generation#prompting-guide), [audio tags](https://ai.google.dev/gemini-api/docs/speech-generation#audio-tags), and [voice options](https://ai.google.dev/gemini-api/docs/speech-generation#voice-options).

| Notify option  | API mapping                                                 | Default when omitted               |
| -------------- | ----------------------------------------------------------- | ---------------------------------- |
| --message TEXT | Final Transcript section of input                           | Required                           |
| --prompt TEXT  | Delivery directions inserted before the Transcript in input | No custom delivery prompt          |
| --voice NAME   | generation_config.speech_config[0].voice                    | Saved Gemini voice, otherwise Kore |

Describe the desired delivery in prompt, from one sentence to structured character and performance notes. Doorbell adds a fixed synthesis instruction and appends `Transcript:` followed by message; do not repeat the transcript in prompt. Gemini's natural-language prompt controls pace. OpenAI's --instructions and numeric --speed are rejected for Gemini.

For local expression changes, Gemini audio tags may be included directly in message. They count toward its 120-code-unit limit and are forwarded unchanged. Their acoustic interpretation is model-dependent. Doorbell makes a single-speaker request.

Example argument array, only when Gemini is selected:

```json
[
  "notify",
  "--message",
  "[warmly] The preview is ready. Please take a look.",
  "--prompt",
  "Character: A thoughtful colleague with quiet humor.\nDelivery: Relaxed pace, a brief pause after ready, and an inviting finish.",
  "--voice",
  "Kore"
]
```

## Settings and Outcomes

`doorbell configure speech --show` reads effective preferences. `doorbell configure speech --list-voices` lists the active provider's voices; adding `--provider openai` or `--provider gemini` only selects the catalog to read. Refresh configuration discovery if the user changes providers.

Saved settings own provider, model, activation, playback mode, local speech playback volume, and a default voice for each provider. Notify can override voice for one call. It cannot change provider, model, playback volume, credentials, or activation. Do not run configuration commands unless the user requested a settings change. Local gain can be changed with `configure speech --volume 1.5` (0.25-4; default 1); it applies to speech from either provider, with peak limiting, and does not change the packaged sound or system volume. Old saved style.tone values are ignored; the next explicit settings save removes that field. The old configure --tone/--reset-tone and notify --agent-tone options are no longer accepted.

Invalid or mismatched delivery controls return exit 2 before credentials, synthesis, or audio playback. They do not silently become a successful sound notification. Correct the options using this guide. Valid notifications with disabled speech or unavailable credentials use the packaged sound. Provider failures never trigger another cloud provider or an automatic paid retry.

Exit 0 means audio delivery succeeded, possibly only the fallback sound; it does not prove speech or human listening. Failed speech is reported on stderr even if sound fallback succeeds. Exit 1 means configuration or delivery failed. SIGINT uses 130 and SIGTERM uses 143; cancellation stops fallback. Do not repeat a paid synthesis merely to alter its delivery after it has started or succeeded.

## MCP and Hooks

When the selected provider has no saved key, one successful sound delivery plays two piano chimes followed by a fixed recorded clip. Keep the current request in the conversation. Report the recorded sound when asked what played.

The Codex plugin exposes the same contract as structured tools. Read `get_instructions`, then call `notify` with `{ message, source?, speech?: { voice?, instructions?, speed?, prompt? } }`. MCP directions have the same limits and provider rules as the CLI. Use `ring` for an offline sound and `doctor` for silent diagnosis. The instruction result includes the exact installed Node/CLI invocation for user-requested configuration work.

All entrypoints share a user-wide FIFO queue. Calls wait up to 120 seconds; cancellation removes a waiting request before it incurs a synthesis charge. Repeated source names are not suppressed. Neither source identifiers nor messages are written to queue storage.

Playback defaults to buffered. OpenAI supports PCM streaming when the player can consume it. Gemini currently switches to buffered before a paid request because local stream listening showed severe interruptions. The requested mode does not guarantee the effective mode; read warnings and the delivery result. Never retry to improve an already started stream.

Native Codex/Claude lifecycle hooks use bounded JSON adapters described in [hooks](hooks.md). They do not automatically inherit your current personality. Use explicit tool calls for nuanced delivery. The plugin does not install automatic lifecycle hooks.
