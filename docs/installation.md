# Agent Installation

Doorbell runs on the user's audio-capable computer. Install its npm runtime once, then connect local Codex or Claude Code to the same stdio MCP server. Hosts share user settings, OS credentials, and the delivery queue. Remote/cloud/SSH installation plays on that machine, not the user's desktop.

## Quick Start

Requires Node.js 24+ and an installed Codex or Claude Code CLI. Windows x64 automatically downloads and verifies ffplay 8.1.1 during npm installation (about 109 MB downloaded, 103 MB installed). Other operating systems/architectures need ffplay in an absolute PATH directory and remain unverified. If lifecycle scripts were disabled, run `npm run setup:player` in the installed package directory. See [managed player](../player/README.md).

```sh
npm install --global agent-doorbell@1.1.1
doorbell --version
doorbell doctor
doorbell setup codex
# Or: doorbell setup claude
```

Restart/reconnect the selected host. Ask its agent to call get_instructions, then notify with an explicitly requested short test message. The offline sound needs no key. Setup does not play audio, enable speech, register completion hooks, or schedule delayed notifications.

The [GitHub release](https://github.com/olivecrow/agent-doorbell/releases/tag/v1.1.1) supplies the npm archive and SHA256SUMS.txt as a secondary channel:

```sh
npm install --global https://github.com/olivecrow/agent-doorbell/releases/download/v1.1.1/agent-doorbell-1.1.1.tgz
```

Use an explicit version for reproducibility. Install once at a stable path rather than start an unpinned npx download during notification delivery.

## Host Setup Contract

```sh
doorbell setup codex --preview
doorbell setup codex
doorbell setup claude --preview
doorbell setup claude
```

Run only the host command requested by the user. Setup emits non-secret JSON with its scope, action, Node executable, server path, configuration location, and verification result. Absolute Node/script paths avoid npm command-shim quoting. Native host CLIs own configuration writes; Doorbell parses configuration to check conflicts and read back the result. This follows the official [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) and [Claude Code MCP](https://code.claude.com/docs/en/mcp) registration contracts.

- Preview reads configuration without starting host/MCP processes or changing files.
- Normal setup verifies all four MCP tools before registration, invokes the host CLI, and reads back the entry. An identical registration is preserved, including after an in-place package update.
- Conflicting paths, environment overrides, other Doorbell registrations, and enabled user-level Doorbell plugins stop setup without overwriting them. Review/remove an old entry explicitly before switching installation locations.
- User-level configuration honors absolute CODEX_HOME and CLAUDE_CONFIG_DIR overrides. Setup does not manage project, organization, or remote policies. Review project-level plugins/servers in the active host; global setup cannot prove every project's effective inventory.
- The optional [Codex plugin](codex-plugin.md) already supplies the connection and calling skill. Choose one connection method per host.
- Failed/cancelled host writes are not retried; inspect the saved entry before retrying. A runtime probe does not prove an active host session reloaded its configuration. Restart/reconnect and confirm tool availability.

Windows native verification uses isolated settings: Codex app-server discovers all four tools and Claude Code reports a connected MCP server. This does not imply an LLM autonomously called notify or that the user heard audio. See [verification evidence](testing-and-release.md).

## Optional User-local Runtime

A dedicated runtime avoids relying on global npm PATH and matches the optional Codex plugin's expected location:

```powershell
$runtimeRoot = Join-Path ($env:USERPROFILE) '.agent-doorbell/runtime'
npm install --prefix $runtimeRoot --save-exact agent-doorbell@1.1.1
$nodeExe = (Get-Command node -CommandType Application).Source
$packageRoot = Join-Path $runtimeRoot 'node_modules/agent-doorbell'
$cliPath = Join-Path $packageRoot 'dist/cli.js'
& $nodeExe $cliPath doctor --json
& $nodeExe $cliPath setup codex
```

Substitute setup claude when requested. Replace the package spec with an absolute tarball path for a local build. Keep development configuration separate.

## Optional Speech

The agent can open the local key configuration command, but the user enters the key directly into its hidden prompt. Never request keys in chat or pass them as command arguments:

```sh
doorbell configure api-key
doorbell configure speech --enable
```

For Gemini, use configure api-key --provider gemini and configure speech --provider gemini --enable. Credentials and activation remain separate. MCP cannot write keys/settings. Speech may incur API charges; a host subscription does not supply the selected provider's key.

Agents call get_instructions before notify and use the current conversational language. Keep the text request visible. [Agent integration](agent-integration.md) describes calling policy; connection does not imply automatic completion or unanswered-wait monitoring.

## Updates and Removal

Close sessions using the runtime before upgrading. Re-run installation with the selected version at the same global/prefix location, then run doctor and setup again. Settings and credentials live outside the package. Moving the package or Node executable requires re-registering its launch paths; setup never silently takes over a different registration.

Remove only the host entries used, before uninstalling:

```sh
doorbell setup codex --remove
doorbell setup claude --remove
npm uninstall --global agent-doorbell
```

For a user-local runtime, use npm uninstall --prefix <runtimeRoot> agent-doorbell. Removal only touches a matching direct registration, never a plugin or someone else's entry. Remove plugins through host plugin management. Removing the runtime or registration preserves speech preferences and API keys.
