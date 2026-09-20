import { SpeechAudio } from "./audio.js";

export type SpeechSynthesisResult =
    | {
        readonly ok: true;
        readonly audio: SpeechAudio;
    }
    |{
        readonly ok: false;
        readonly reason: string;
        readonly status?: number;
    }