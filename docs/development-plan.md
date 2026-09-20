# Development Plan

The local implementation and Codex plugin installation are complete. This plan tracks deferred verification; feature documents describe current behavior, and [testing and release](testing-and-release.md) records completed evidence.

## Deferred Verification

- [ ] Validate macOS/Linux credentials, playback, human listening, and native queue/speech-directory ownership and permission rejection. Factory selection and mocked ownership checks do not establish support.
- [ ] Re-evaluate Gemini continuous streaming when the provider/model can supply audio fast enough in the target environment. Keep it disabled until new provider-throughput and human listening evidence is available.
- [ ] Verify actual Claude host-hook invocation. Native payload and CLI adapter behavior have automated coverage, but no Claude installation has been exercised.

## Release Gate

The Codex unanswered-response calling policy is documented in the source skill and agent instructions. Updating the installed runtime/plugin and verifying host-observable unanswered-wait behavior remain separate work; no timeout automation or new execution connection is implemented.

Public npm publication, tagging, pushing, and releases require a separate explicit request. See [Codex plugin](codex-plugin.md) for the completed local installation contract.
