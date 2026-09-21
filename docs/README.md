# Documentation Map

Feature documents describe the current implementation. The [development plan](development-plan.md) tracks deferred verification and release gates.

| Document                                      | Contents                                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [Product](product.md)                         | Ownership boundaries, default behavior, scope                                                            |
| [Installation](installation.md)              | Agent-operated installation, direct Codex/Claude MCP setup, speech activation, updates and removal |
| [CLI](cli.md)                                 | Commands, options, output, and exit codes                                                                |
| [Agent integration](agent-integration.md)     | Instructions for calling AI agents, including per-call controls and official TTS manuals                 |
| [Speech settings](speech-settings.md)         | Provider profiles, default voices and legacy tone removal, validation, migration, paths, and persistence |
| [Credentials](credentials.md)                 | Provider-specific OS key storage and security boundaries                                                 |
| [Speech provider](speech-provider.md)         | Provider selection, cancellation, private temporary audio, Windows ACL checks and cleanup                |
| [Gemini TTS](gemini-tts.md)                   | Gemini 3.1 Flash TTS, voices, request mapping, and PCM-to-WAV conversion                                 |
| [Audio player](audio-player.md)               | ffplay prerequisites and platform evidence                                                               |
| [Process runner](process-runner.md)           | Process, timeout, and cancellation contracts                                                             |
| [Testing and release](testing-and-release.md) | Regression command, evidence limits, and release gates                                                   |
| [Editor](editor.md)                           | Project VS Code formatting settings                                                                      |
| [Development plan](development-plan.md)       | Deferred platform and host verification, streaming support, and release gates                            |

Feature change history is stored as JSONL under \_change_logs/.

- [Delivery coordination and diagnosis](delivery-coordination.md): shared FIFO queue, crash/cancellation behavior, and doctor.
- [Native hooks](hooks.md): Codex notify arguments and Claude Notification stdin.
- [Codex plugin and MCP](codex-plugin.md): structured tools, installation, and use outside the repository.
