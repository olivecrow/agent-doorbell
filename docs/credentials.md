# Credential Storage

`src/config/credentials.ts` defines CredentialResult<T>, read-only CredentialReader, and CredentialStore with write/remove methods. `keyring-credential-store.ts` adapts optional dependency @napi-rs/keyring 2.1.0 through lazy import and AsyncEntry. The constructor receives the path-derived service identity and provider. Accounts are openai-api-key and gemini-api-key; omitted provider retains the existing OpenAI identity. Linux requires secret-service. CLI configure api-key and provider reader injection are connected.

Empty or whitespace-containing keys are rejected after trim. Native failures become a static reason; cancellation has a separate reason and does not promise rollback. Read success contains the secret and must never be logged or serialized for diagnostics.

The action menu defaults to cancel. Selecting cancel ends configuration as cancelled without reading, writing, or deleting a credential. Selecting set and submitting valid hidden input immediately writes the key to the OS store. There is no additional save or storage-choice prompt. Cancel before submitting to retain the existing key. Selecting remove still asks for deletion confirmation.

## Result Normalization

On Windows, version 2.1.0 returns null for an absent password and for a successful setPassword, despite its async declarations using undefined and void. The adapter normalizes nullish read results to undefined and awaits writes without returning their native value. Missing credentials are successful reads with value undefined; inaccessible storage is a failure. Removal returns true when an entry was deleted and false when already absent.

## Verification

2026-09-20: clean build passed. The existing 28 mock assertions covered lazy loading, absent module, input validation, service separation, safe error conversion and cancellation. After normalization, six targeted mock assertions confirmed null/undefined/value reads, void write results, safe errors and pre-cancellation.

The corrected product build passed 15 assertions across three independent Windows Node processes: two path-derived service identities, exact undefined on missing reads and successful writes, trimmed-key readback, isolated update, deletion and repeated deletion. A final cleanup process confirmed both fake entries were absent. No real API key, user credential enumeration, API request or audio playback was used.

Provider isolation was additionally verified in the native Windows store with a unique test service and fake values: OpenAI and Gemini read back independently, Gemini replacement preserves OpenAI, OpenAI deletion preserves Gemini, and the legacy constructor finds the same OpenAI entry. Final cleanup confirmed both test accounts absent. Saved subprocess tests verify that notify selects the matching credential reader and SDK. Native checks were session harnesses; macOS/Linux and mid-operation native cancellation remain unverified.

## Independent Configuration

configure api-key [--provider openai|gemini] does not read or write speech.json. Omitted provider always means OpenAI, regardless of the active speech provider. Prompts identify the key being edited. A malformed speech file cannot block key replacement or removal. Registering a key does not select or enable speech, and removing a key preserves activation and default voice preferences; notification then falls back to sound if the selected provider's key is missing. The other provider's key is never tried as a fallback.

configure speech never accesses this store. It can enable default preferences or edit default voice preferences before a key is registered or when the native credential adapter is unavailable.

When speech is disabled, notification delivery checks the selected account's status to choose its offline sound. The native status check clears the returned byte buffer and exposes only configured, missing, or unavailable. Only confirmed absence selects the two chimes followed by the recorded clip. With speech enabled, the provider reports a missing key from its existing credential read.

## Security Boundary

`configure api-key` uses hidden terminal input with visibility toggling disabled. The key is passed directly to the credential adapter, never to the settings writer or a child-process argument. `speech.json` contains only validated non-secret settings. Only the selected provider's key is read for synthesis. Both adapters use explicit official HTTPS endpoints and convert native/network/API failures to safe results. OpenAI SDK logging is disabled. Gemini uses x-goog-api-key, stateless Interactions requests, and rejected redirects; SDK environment keys/base URLs do not override the injected credential or endpoint. Storage failure does not fall back to a plaintext file or environment variable.

On Windows, the package's [version 2.1.0 entry builder](https://github.com/Brooooooklyn/keyring-node/blob/v2.1.0/src/entry_builder.rs) selects the native credential store. Windows Credential Manager encrypts credentials in the OS vault; see Microsoft's [credential handling guidance](https://learn.microsoft.com/en-us/windows/win32/secbp/handling-passwords). The repository's OneDrive location does not make the key part of its configuration JSON.

This is a user-account boundary, not application isolation: [CredRead uses the current token's logon-session credential set](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credreadw). Another program with the same effective access can retrieve the credential. A malicious dependency or code running in the Doorbell process can also access the key. The SHA-256 service name separates configuration scopes; it does not encrypt the key or enforce access control. CredentialReader's TypeScript interface limits normal responsibilities, not the privileges of hostile code.

During a request, the key necessarily exists as a JavaScript string and SDK authorization data in process memory. There is no secure-zeroization guarantee. Terminal input hiding also does not protect against a compromised terminal or OS. Use a dedicated key, monitor usage, and rotate or revoke it when appropriate; OpenAI's [API key guidance](https://developers.openai.com/api/docs/guides/production-best-practices#api-keys) recommends secure storage, expiration and rotation.

Gemini Interactions receives a placeholder credential. Doorbell attaches the OS-stored key to a fresh set of outgoing headers only for the exact HTTPS Interactions POST and rejects redirects. Any nonempty `GOOGLE_GENAI_DEBUG` value blocks Gemini synthesis before the SDK can log request headers or the transcript. Unset the variable to resume speech. The notification falls back to the bundled sound, and doctor reports the reason. OpenAI also rejects redirects and explicitly disables SDK logging.

## Current Security Review Evidence

2026-09-20: the user's configured development credential was read only inside a local validation process. Exact-match scanning of 146 project text files, including development settings and generated code, found no plaintext copy. The scan excluded dependencies, Git internals, audio assets and symbolic links; it does not cover shell history, clipboard data, backups or memory dumps. No key value, length, hash or prefix was printed, and no real credential was changed or deleted.

Six fake-secret scenarios verified safe native read/write/remove errors, rejection of an API key field in settings, and safe HTTP/network failures. Setting OPENAI_LOG=debug still produced no SDK output, and OPENAI_BASE_URL did not override the fixed endpoint. `npm audit --omit=dev --ignore-scripts --json` reported zero known vulnerabilities for the audited production dependency tree. These checks are bounded evidence, not a guarantee against unknown dependency defects or a compromised Windows account. No actionable key-storage or logging defect was found in the inspected flow. Actual-account TTS evidence is recorded in [speech-provider.md](speech-provider.md).
