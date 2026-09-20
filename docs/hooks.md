# Native Agent Hooks

Explicit `notify` calls or MCP tools are the baseline for actionable, personality-aware requests. Lifecycle hooks provide a separate adapter for host events; they do not determine every moment when a human decision is needed. Installing the plugin does not automatically enable lifecycle hooks.

## Codex

The official [Codex notification contract](https://learn.chatgpt.com/docs/config-file/config-advanced) invokes an argument-array command with one appended JSON argument. Configure the user-level `notify` array to run Node with the absolute installed `dist/cli.js` path, followed by `hook`, `codex`. Codex's project configuration cannot override that user-level setting.

Example argument array (replace the installed path):

```json
["node", "/absolute/path/to/agent-doorbell/dist/cli.js", "hook", "codex"]
```

Only `type: "agent-turn-complete"` is handled. It becomes a short generic review request. The adapter never speaks `last-assistant-message`, `input-messages`, or `cwd`, because those fields can contain much more than a final notification. The optional thread ID stays local as the source.

This completion hook does not observe unanswered questions or response-wait timeouts. The [agent calling policy](agent-integration.md#when-to-call-in-codex) uses native Codex questions/notifications first and permits one explicit Doorbell call only after a confirmed unanswered response wait while input is still needed. Installing or configuring this hook does not implement that policy; no timer, background monitor, automatic wakeup, or read-receipt detection is provided.

## Claude

The official [Claude Notification hook](https://code.claude.com/docs/en/hooks#notification) sends JSON to the hook command's stdin. Run the installed CLI with `hook claude`. Configure the command with a fixed quoted executable/script path in Claude's hook settings; never interpolate message or payload fields into shell text.

The adapter accepts `hook_event_name: "Notification"`, a notification type, and a message. A valid short native message is used directly; blank or oversized native text becomes a generic attention request. It ignores transcript paths and other conversation metadata. Other event names return success without notification.

## Optional Custom Payload

An agent-owned adapter may attach a `doorbell` object containing only `message` and `speech`, using the same per-call contract as MCP. Native lifecycle callbacks usually have no current personality context; they therefore omit custom directions. Doorbell does not discover private personality settings.

```json
{
  "type": "agent-turn-complete",
  "doorbell": {
    "message": "The preview is ready. Please review it.",
    "speech": { "instructions": "Warm, clear, and concise." }
  }
}
```

Input is limited to 64 KiB; stdin has a five-second deadline and supports cancellation. Malformed input and settings/credential overrides fail before audio. Provider-specific options are validated again against current settings before queue admission. Supported hooks use the same selected credentials, queue, playback, cancellation, and one-request sound fallback as explicit notifications. Failed audio remains an error; the agent must retain its conversational text request.

Saved tests validate native JSON shapes, Unicode split across stdin chunks, unsupported events, oversized input, override rejection, and both real CLI entry routes with disabled speech, missing credentials, failed synthesis, and successful speech at fake boundaries. This does not claim a real Claude installation was exercised.
