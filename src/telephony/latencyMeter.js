// Per-answer latency, to compare voice providers (OpenAI voice vs ElevenLabs) on real
// calls.
//
// Measured from the caller's end of speech (server VAD speech_stopped) to the first chunk
// of the agent's answer audio sent to Twilio. It doesn't include the VAD's own end-of-
// speech wait (~0.5 s) or the phone network, so the latency the caller hears is higher;
// it is meant for comparing providers, not as an absolute figure. In ElevenLabs mode it
// also records when OpenAI's first text arrived, to split "thinking" from "speaking".
//
// Clock injectable for tests.

// A "first audio" this long after the caller stopped is not an answer to that turn
// (e.g. a silence farewell); it is discarded.
const MAX_SAMPLE_MS = 15000;

export function createLatencyMeter({ now = () => Date.now() } = {}) {
  let turnStart = null;
  let firstTextAt = null;
  const samples = [];

  return {
    /** The caller stopped speaking: an answer is expected. */
    callerStopped() {
      turnStart = now();
      firstTextAt = null;
    },
    /** The caller started speaking again, or the call is ending: no pending turn. */
    reset() {
      turnStart = null;
      firstTextAt = null;
    },
    /** First text of the answer (ElevenLabs mode). */
    firstText() {
      if (turnStart !== null && firstTextAt === null) firstTextAt = now();
    },
    /** First answer audio sent to the caller. Returns the sample, if one was taken. */
    firstAudio() {
      if (turnStart === null) return null;
      const t = now();
      const sample = {
        audioMs: t - turnStart,
        textMs: firstTextAt === null ? null : firstTextAt - turnStart,
      };
      turnStart = null;
      firstTextAt = null;
      if (sample.audioMs > MAX_SAMPLE_MS) return null;
      samples.push(sample);
      return sample;
    },
    /** Aggregate over the call, or null if no answers were measured. */
    summary() {
      if (!samples.length) return null;
      const sorted = samples.map((s) => s.audioMs).sort((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);
      return {
        answers: sorted.length,
        avgMs: Math.round(sum / sorted.length),
        medianMs: sorted[Math.floor((sorted.length - 1) / 2)],
        minMs: sorted[0],
        maxMs: sorted[sorted.length - 1],
      };
    },
  };
}
