# Codex Plugin and MCP

The `plugins/doorbell` bundle contains a Codex manifest, the Doorbell calling skill, and a stdio MCP definition. `doorbell-mcp` starts the official MCP SDK server. Standard output contains only protocol messages; failures use safe tool results or stderr.

| Tool             | Behavior                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| get_instructions | Current non-secret settings, catalogs, agent guidance, and official provider manuals; no credential lookup  |
| notify           | Bounded final sentence and optional per-call speech controls through the shared runtime and user-wide queue |
| ring             | One queued offline sound                                                                                    |
| doctor           | Silent local diagnosis and credential statuses                                                              |

Schemas reject unknown fields, secrets, and settings overrides. Delivery controls remain transient. Cancellation from an MCP request reaches queue waiting, synthesis, and the local player. Tool results distinguish speech from fallback sound, retain failed attempts, and remind the caller to keep its text request visible.

The calling skill and `get_instructions` follow the [Codex attention policy](agent-integration.md#when-to-call-in-codex). Send the native request first. After 3 minutes without a reply, proactively notify once with one short, actionable sentence if input is still required. Explicit audio requests may be fulfilled directly. The active agent tracks elapsed time and prior attempts. Installed copies receive updated guidance through both the plugin bundle and the runtime package.

## Local Installation

Requires Node 24+ and OS credential-store access for speech. The npm package automatically installs ffplay on Windows x64. Other platforms require ffplay on PATH. For direct MCP registration without a marketplace, follow [agent installation](installation.md). To use this optional skill bundle, create an npm tarball with `npm pack`, then install it in a clean user runtime:

```sh
npm install --prefix /absolute/user/home/.agent-doorbell/runtime /absolute/path/agent-doorbell-1.1.3.tgz
```

The plugin's small bootstrap resolves `~/.agent-doorbell/runtime/node_modules/agent-doorbell/dist/mcp.js` independently of the current directory. It selects normal `~/.agent-doorbell` settings explicitly. Development settings remain isolated. API keys must exist under the normal settings scope; installing package files does not make development-scoped keys available there.

Copy the validated plugin source to `~/plugins/doorbell`, register its personal marketplace entry using the Codex plugin-creator workflow, then install `doorbell@<personal-marketplace-name>` using `codex plugin add`. The default personal marketplace lives at `~/.agents/plugins/marketplace.json`. Use the existing validated marketplace name when present, and preserve unrelated entries.

Start a new Codex conversation after installing or updating the plugin. Existing conversations may retain their earlier tool inventory. In the new conversation, ask Doorbell to notify you; the agent should discover `get_instructions` and then call `notify` with its own current delivery choices.

For configuration, run the installed runtime's `dist/cli.js` with Node and `configure api-key` or `configure speech`. These remain separate flows; MCP offers no credential-writing or configuration-changing tool.

The calling skill, MCP tool guidance, and bundled agent instructions default to the user's current conversational language unless the user explicitly requested or configured another spoken language. Delivery remains derived from the agent's current personality. English documentation does not force English speech. get_instructions exposes the saved local playbackVolume; a user-requested change uses `configure speech --volume NUMBER` through its exact installed CLI invocation.

## Verification Boundaries

Automated tests launch the stdio server from an unrelated temporary directory containing spaces and Korean characters. They verify tool discovery, instruction retrieval, schema rejection before side effects, structured fallback status, cancellation, and shutdown before removing the child process's working directory. Package installation and actual separate-session use require their own checks; see [testing and release](testing-and-release.md).

The local installation on 2026-09-20 completed an actual separate Codex session outside the repository: get_instructions succeeded, then exactly one notify returned speech success with no warnings. The user confirmed hearing the Korean notification. A clean tarball installation and the installed normal-scope doctor also passed. Public publication and other operating systems were not part of this check.
