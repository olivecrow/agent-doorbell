# Development Plan

The runtime, automatic Windows player installation, direct Codex/Claude MCP setup, and local Codex plugin installation are implemented. This plan tracks deferred verification; feature documents describe current behavior, and [testing and release](testing-and-release.md) records completed evidence.

## Deferred Verification

- [ ] Validate macOS/Linux credentials, playback, human listening, and native queue/speech-directory ownership and permission rejection. Factory selection and mocked ownership checks do not establish support.
- [ ] Re-evaluate Gemini continuous streaming when the provider/model can supply audio fast enough in the target environment. Keep it disabled until new provider-throughput and human listening evidence is available.
- [ ] Verify actual Claude host-hook invocation. Native payload and CLI adapter behavior have automated coverage; Claude MCP connection verification does not exercise its lifecycle hook.

## Release Gate

Version 1.1.0 includes Windows x64 managed ffplay installation and direct host setup. Publish only the verified tarball under its version; never replace an existing release asset. Managed builds for other operating systems/architectures remain deferred until their binary provenance, prerequisites, and native playback have been verified.

## Distribution Review and Remaining Work

The 1.1.0 distribution uses an npm runtime package plus common local stdio MCP registration, with a GitHub tarball/checksum as the secondary channel. Optional host plugins can bundle discovery/calling skills around that same runtime. This follows the official [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [OpenAI plugin](https://learn.chatgpt.com/docs/plugins), and [Claude Code plugin](https://code.claude.com/docs/en/plugins) workflows. A remote MCP server cannot by itself play sound on a local desktop.

- [ ] Evaluate version-pinned npx as an optional convenience after measuring cold-start downloads; the default remains one installation at stable local launch paths.
- [ ] Provide a distributable Codex marketplace entry and a Claude Code plugin/skill wrapper if plugin discovery is desired. The current Codex personal-marketplace copy workflow is usable locally but cumbersome for public onboarding; no Claude plugin is currently shipped.
- [ ] Extend installation/update/removal and actual host verification to macOS/Linux before claiming support. Windows native host setup has separate evidence in testing-and-release.md. Keep hidden key entry and explicit speech activation separate from installation.

The current direct-MCP route is documented in [agent installation](installation.md) and does not require a custom marketplace. Publishing to npm simplifies acquisition and upgrades, but does not by itself install a host plugin, register MCP, or activate speech.

The active agent owns the three-minute unanswered-request policy. Host-specific behavior when a turn ends before three minutes remains a live verification item.

Public npm publication, tagging, pushing, and releases require a separate explicit request. See [Codex plugin](codex-plugin.md) for the completed local installation contract.
