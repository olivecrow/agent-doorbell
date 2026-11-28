# Gemini TTS

GeminiSpeechProvider implements buffered speech for `gemini-3.8-flash-tts`, `gemini-3.8-flash-lite-tts`, and `gemini-3.1-flash-tts-preview` using the official `@google/genai` SDK. The legacy settings defaults are `gemini-3.1-flash-tts-preview` and Kore. Google's [deprecation schedule](https://aistudio.google.com/docs/deprecations#gemini-3-preview-models) lists a shutdown date for the 3.1 preview. Choose a 3.8 model to keep using Gemini after shutdown.

## Configuration

```sh
doorbell configure api-key --provider gemini
doorbell configure gemini
doorbell configure speech --enable
doorbell configure gemini --list-models
doorbell configure gemini --list-voices
doorbell configure gemini --model gemini-3.8-flash-lite-tts --voice Kore
doorbell configure gemini --preview-voice voice_abc123
```

The key is entered through hidden input and stored in the `gemini-api-key` OS credential account. `configure gemini` reads the stored key and loads both catalogs concurrently. Select a model, search the compatible voices by name, ID, or language, and confirm to save the selection and make Gemini the active provider. Supplying the model and voice IDs together validates them against the same live catalogs and saves without a prompt. Both forms preserve activation, playback preferences, and the OpenAI profile. `configure speech --enable` explicitly activates the selected provider. Use `npm run dev --` in place of `doorbell` for the isolated development configuration.

Read-only listing prints JSON. The [Models API](https://aistudio.google.com/api-reference/models/list-models) results are limited to models the adapter implements. The [Voices API](https://aistudio.google.com/api-reference/voices) exposes prebuilt and project-owned voices. The 3.1 preview can select the original 30 prebuilt voices when returned by the API. The 3.8 models can select voices from the extended catalog and stored custom voice IDs. The catalog adapter follows pagination with bounded responses and a 15-second deadline per operation. It sends the key in an HTTPS header to the Gemini API and rejects redirects.

The voice list marks stored designed voices with `canPreview`. ListVoices returns metadata. Selecting **Play preview**, or passing `--preview-voice` with the stored voice ID, reads `sample_audio` from [GetVoice](https://aistudio.google.com/api-reference/voices/get-voice) and plays the piano cue followed by the sample WAV under the same queue lease. Prebuilt and replicated voices lack a downloadable sample in this API. Google AI Studio offers [prebuilt voice auditions](https://aistudio.google.com/generate-speech). Local previews use the existing private WAV file lifecycle and do not call speech synthesis.

`doorbell configure speech --list-voices --provider gemini` remains the offline list of the 30 case-sensitive presets available for `notify --voice`, in the [official speech guide](https://ai.google.dev/gemini-api/docs/speech-generation) order.

```text
Zephyr, Puck, Charon, Kore, Fenrir, Leda, Orus, Aoede, Callirrhoe,
Autonoe, Enceladus, Iapetus, Umbriel, Algieba, Despina, Erinome,
Algenib, Rasalgethi, Laomedeia, Achernar, Alnilam, Schedar, Gacrux,
Pulcherrima, Achird, Zubenelgenubi, Vindemiatrix, Sadachbia,
Sadaltager, Sulafat
```

## Request and Audio

The adapter calls Interactions at `https://generativelanguage.googleapis.com/v1beta/interactions`, with an explicit API key and Vertex and enterprise modes disabled. It sends the selected model, `generation_config.speech_config: [{ voice }]`, `response_format: { type: "audio" }`, `store: false`, and `stream: false`. Each model uses its default output format. `store: false` disables interaction storage and history.

When `GOOGLE_GENAI_DEBUG` is nonempty, Doorbell uses the bundled sound and reports why. With debug logging off, only the final transport attaches the stored Gemini key to the official Interactions POST.

With 3.8, `message` is the verbatim text and the optional `speech.prompt` goes in `speech_metadata.style`. The 3.1 preview uses a fixed synthesis instruction, optional prompt, and final Transcript section. Both preserve multiline style directions after outer whitespace trimming and forward audio tags in the message unchanged. `speech.voice` accepts one of the 30 presets as a per-call override. Omit it to use the saved voice, including a catalog voice selected with `configure gemini`. See [agent integration](agent-integration.md) for prompting guides and per-call options.

A completed interaction must contain inline 24 kHz mono signed 16-bit little-endian PCM audio. The 3.8 models return WAV, which the adapter validates and passes to the player. The 3.1 preview returns raw `audio/l16`, which the adapter validates before wrapping. Both paths require canonical nonempty base64, whole samples, and at most 60 seconds of PCM (2,880,000 bytes). The SDK buffers the JSON response before decoded-audio validation.

The wavefile package wraps raw 3.1 PCM samples in a WAV container. The temporary-file and ffplay path handles decoding, output, cancellation, and cleanup. A narrow local declaration is mapped through tsconfig for the two wavefile APIs used here because version 11's bundled declaration is incompatible with TypeScript 7.

## Failure and Evidence

One synthesis reads one selected-provider key and permits one request. The adapter sets maxRetries to zero, rejects redirects, and combines caller cancellation with a 15-second buffered timeout through response-body consumption. Missing keys, HTTP/network errors, incomplete output, and invalid audio become safe failures without returning remote error text. Numeric HTTP error status is preserved in the result and safe reason, including errors from the Interactions SDK's separate error class. notify then tries the packaged MP3, unless cancelled. It never calls OpenAI to recover a Gemini failure.

Automated evidence covers the actual SDK's intercepted request, the absence of unsupported format overrides, environment override isolation, PCM wrapping, timeout/cancellation, HTTP status preservation, malformed responses, no retries, CLI routing, and fallback. A native Windows fake-key check covers credential separation.

Windows / Node 24.15.0 account-backed verification received HTTP 200 using Kore and neutral delivery in the earlier listening check. The response contained audio/l16; rate=24000; channels=1, and ffplay completed speech playback without sound fallback. The user confirmed hearing the sentence. The request and playback took about 14 seconds in total; temporary audio and the diagnostic response copy were deleted. This was a one-call provider override through the product notify API; saved provider preferences were not changed. The experimental stream decoder also consumes Interactions step.delta audio events, validates MIME/rate/channel metadata and canonical base64, preserves PCM sample alignment, requires interaction.completed, and closes the source on cancellation. No second paid request is made on partial failure.

Local Puck streaming with a per-call prompt and audio tag was evaluated on 2026-09-20. It produced 117 chunks / 224,640 PCM bytes (4.68 seconds of audio), arriving from about 1.96 to 22.93 seconds after invocation. Gaps were about 190 ms for 40 ms chunks, and the user reported severe stuttering. A local control fed the same chunk sizes in 153 ms and completed 4.86-second playback, isolating the bottleneck from the PCM player. Increasing the request deadline avoided truncation but did not make the stream continuous.

Production Gemini streaming is therefore disabled. A streaming preference triggers a reported switch to buffered before credential synthesis, preserving a single paid request and uninterrupted file playback. Re-enable only after provider-stream and human listening evidence establishes continuous output. macOS/Linux remain unverified.
