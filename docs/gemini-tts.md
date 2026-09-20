# Gemini TTS

GeminiSpeechProvider implements buffered speech using the official @google/genai SDK. The selected model is `gemini-3.1-flash-tts-preview`; it is a preview model. The default voice is Kore. Model identity follows Google's [model reference](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-tts-preview).

## Configuration

```sh
doorbell configure api-key --provider gemini
doorbell configure speech --provider gemini --enable
doorbell configure speech --list-voices --provider gemini
doorbell configure speech --voice Puck
```

The key is entered through hidden input and stored in the gemini-api-key OS credential account. It does not enable or select speech. The speech command selects Gemini and explicitly enables synthesis; omitted preferences use defaults. Provider switching preserves each voice. Use `npm run dev --` in place of `doorbell` for the isolated development configuration.

The 30 case-sensitive voices are stored in the [official speech guide](https://ai.google.dev/gemini-api/docs/speech-generation) order:

```text
Zephyr, Puck, Charon, Kore, Fenrir, Leda, Orus, Aoede, Callirrhoe,
Autonoe, Enceladus, Iapetus, Umbriel, Algieba, Despina, Erinome,
Algenib, Rasalgethi, Laomedeia, Achernar, Alnilam, Schedar, Gacrux,
Pulcherrima, Achird, Zubenelgenubi, Vindemiatrix, Sadachbia,
Sadaltager, Sulafat
```

## Request and Audio

The adapter calls Interactions at `https://generativelanguage.googleapis.com/v1beta/interactions`, with an explicit API key and Vertex/enterprise modes disabled. It sends the selected model, `generation_config.speech_config: [{ voice }]`, `response_format: { type: "audio" }`, `store: false`, and `stream: false`. Use the model's default audio output, matching the official speech example: this model rejects explicit audio/l16 output selection even though it returns PCM with that MIME type. `store: false` disables interaction storage/history; it is not a claim about all service-side data retention.

The input contains a fixed synthesis instruction, optional request speech.prompt, and the final Transcript from message. Prompt is a per-call delivery direction prefix, not a second transcript. Its multiline text is preserved after outer whitespace trimming. No custom directions are inserted when omitted; legacy saved tones are ignored. Request speech.voice overrides the saved default for this synthesis only. Audio tags in message are forwarded unchanged. OpenAI instructions/speed are rejected before credential access. [Agent integration](agent-integration.md) links the official prompting and audio-tag manuals for calling agents. Source identifiers, conversation history, and agent configuration are excluded; there is no separate text-generation call.

A completed interaction must contain inline audio. Accept only mono 24 kHz, signed 16-bit little-endian PCM, with consistent optional MIME parameters/metadata. Require canonical nonempty base64, whole samples, and at most 60 seconds of PCM (2,880,000 bytes). This is a decoded-audio guard; the SDK buffers the JSON response before validation.

The zero-dependency wavefile package writes a WAV container around the samples. It does not play audio. The existing temporary-file and ffplay path handles decoding, output, cancellation, and cleanup. A narrow local declaration is mapped through tsconfig for the two wavefile APIs used here, because version 11's bundled declaration is incompatible with TypeScript 7. Runtime imports still resolve to the installed package, and tests verify the emitted WAV bytes.

## Failure and Evidence

One synthesis reads one selected-provider key and permits one request. The adapter sets maxRetries to zero, rejects redirects, and combines caller cancellation with a 15-second buffered timeout through response-body consumption. Missing keys, HTTP/network errors, incomplete output, and invalid audio become safe failures without returning remote error text. Numeric HTTP error status is preserved in the result and safe reason, including errors from the Interactions SDK's separate error class. notify then tries the packaged MP3, unless cancelled. It never calls OpenAI to recover a Gemini failure.

Automated evidence covers the actual SDK's intercepted request, the absence of unsupported format overrides, environment override isolation, PCM wrapping, timeout/cancellation, HTTP status preservation, malformed responses, no retries, CLI routing, and fallback. A native Windows fake-key check covers credential separation.

Windows / Node 24.15.0 account-backed verification received HTTP 200 using Kore and neutral delivery in the earlier listening check. The response contained audio/l16; rate=24000; channels=1, and ffplay completed speech playback without sound fallback. The user confirmed hearing the sentence. The request and playback took about 14 seconds in total; temporary audio and the diagnostic response copy were deleted. This was a one-call provider override through the product notify API; saved provider preferences were not changed. The experimental stream decoder also consumes Interactions step.delta audio events, validates MIME/rate/channel metadata and canonical base64, preserves PCM sample alignment, requires interaction.completed, and closes the source on cancellation. No second paid request is made on partial failure.

Local Puck streaming with a per-call prompt and audio tag was evaluated on 2026-09-20. It produced 117 chunks / 224,640 PCM bytes (4.68 seconds of audio), arriving from about 1.96 to 22.93 seconds after invocation. Gaps were about 190 ms for 40 ms chunks, and the user reported severe stuttering. A local control fed the same chunk sizes in 153 ms and completed 4.86-second playback, isolating the bottleneck from the PCM player. Increasing the request deadline avoided truncation but did not make the stream continuous.

Production Gemini streaming is therefore disabled. A streaming preference triggers a reported switch to buffered before credential synthesis, preserving a single paid request and uninterrupted file playback. Re-enable only after provider-stream and human listening evidence establishes continuous output. macOS/Linux remain unverified.
