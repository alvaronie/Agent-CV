# Agent CV

An AI voice agent that answers phone calls with information about my CV. Companies can
call, ask questions, ask to be transferred to my mobile, or leave their contact details.
When the call ends, I receive an email with a summary.

It is live on a real phone number and has handled real calls end to end.

## Architecture

```
Incoming call
      │
      ▼
  Twilio (number + Media Streams)
      │  streaming audio (WebSocket)
      ▼
  Node.js backend  ◄──►  OpenAI Realtime API (speech in, reasoning, speech or text out)
      │                     │
      │                     └─ optional: text → ElevenLabs TTS → voice
      │
      ├─ tool: transfer_call  → Twilio <Dial> to my mobile
      │                         (no answer → back to the agent)
      ├─ tool: save_contact   → storage (JSONL)
      └─ on hangup: summary (LLM) → email (Resend), once per call
```

The audio bridge is built by hand on purpose (no managed voice-agent platform): it is the
part that shows the engineering. Twilio's μ-law 8 kHz audio is passed to OpenAI and back
without re-encoding.

## What it does

- **Answers in the caller's language.** English by default; switches to Spanish (Spain
  accent and vocabulary) if the caller speaks Spanish. Answers only from the CV.
- **Transfers to my mobile** when asked. If I don't pick up, the call returns to the agent,
  which says I couldn't be reached, offers a callback on the caller's own number, and
  keeps helping.
- **Takes contact details** and sends me **one summary email per call**, including the
  transfer outcome.
- **Guardrails:** Twilio signature validation, authenticated media stream, concurrency and
  daily call limits, OpenAI reconnection with backoff, silence and max-turn limits with a
  spoken goodbye that gives the reason, prompt-injection resistance, PII-safe logs, and a
  transcript kept in memory only (never written to disk).

## Key engineering decisions

Each decision is recorded with its rationale in [`docs/PROJECT_LOG.md`](docs/PROJECT_LOG.md).
A few that shaped the project:

- **DIY over a managed platform** (Vapi, Retell, ElevenLabs Agents): more control, lower
  cost per minute, and it is the actual engineering.
- **Luxembourg number on Twilio** instead of a Spanish one: Twilio has no Spanish
  inventory, and the alternative provider required identity checks in Spain and a full
  migration. Verified against the Twilio API before deciding.
- **Only the summary is stored, never the transcript**: the transcript is third-party
  personal data and adds risk without adding value.
- **Real-call debugging drove the fixes**: e.g. Twilio's `<Stream>` URL doesn't accept
  query strings (the auth token now travels as a `<Parameter>`), OpenAI streams audio
  faster than it plays (so silence is measured on playback, not on arrival), and
  transcripts arrive out of order (ordered by conversation item).

## Voice study: OpenAI voice vs ElevenLabs

**Question.** OpenAI Realtime's voice can't be set to a Spain-Spanish accent (it is only
steered through the prompt). Would an ElevenLabs voice sound better without adding
noticeable latency?

**Options considered.**

| Option | How | Verdict |
|---|---|---|
| A. ElevenLabs as the voice only | OpenAI Realtime replies in text, streamed sentence by sentence to ElevenLabs | **Chosen**: keeps the custom architecture |
| B. ElevenLabs Agents | ElevenLabs' full agent platform, connected to Twilio | Discarded: replaces most of the code |

Option A is implemented behind a switch (`VOICE_PROVIDER=openai | elevenlabs`), so both
voices run on the same code and can be compared on real calls.

**Method.** Two real calls, one per voice, with the same 6-step script in Spanish, the
same phone and place, no interruptions. Measured per answer: from the end of the caller's
speech (server-side voice activity detection) to the first audio of the answer sent to
Twilio.

**Results** (6 answers each):

| | OpenAI voice | ElevenLabs voice |
|---|---|---|
| Average | 493 ms | **491 ms** |
| Median | 472 ms | 474 ms |
| Range | 459–590 ms | 428–642 ms |

With ElevenLabs, the time splits into OpenAI's first text (avg **303 ms**) plus
ElevenLabs' first audio (avg **188 ms**). The likely reason there is no penalty: in text
mode OpenAI starts answering sooner, which offsets the extra TTS step.

**Takeaways.**

- **No latency penalty**, and the ElevenLabs voice sounds noticeably better.
- With a Spanish voice, English terms (e.g. "AWS") sound odd, and voice choice affects
  speaking pace. Voice selection is still being tuned.
- Caveats: one call per voice, and the measurement is server-side. The delay the caller
  hears is higher (end-of-speech detection and the phone network), but equally for both.

## Project structure

```
Agent CV/
├── render.yaml                 # Render deployment blueprint
├── .env.example                # environment variable template
├── src/
│   ├── index.js                # HTTP + WebSocket server (entry point)
│   ├── config/index.js         # environment configuration
│   ├── telephony/
│   │   ├── twilioWebhook.js    # incoming-call webhook (TwiML)
│   │   ├── mediaStream.js      # audio bridge Twilio <-> OpenAI (<-> ElevenLabs)
│   │   ├── callSessions.js     # per-call state across transfer legs
│   │   ├── transferStatus.js   # transfer outcome: hang up or back to the agent
│   │   ├── callLimiter.js      # concurrency / daily call limits
│   │   ├── callGuard.js        # silence timeout / max caller turns
│   │   ├── farewell.js         # spoken goodbye before a limit hangup
│   │   ├── transcriptLog.js    # transcript in conversation order
│   │   ├── latencyMeter.js     # per-answer latency
│   │   ├── callerNumber.js     # withheld caller ID detection
│   │   └── twilioClient.js     # shared Twilio REST client
│   ├── realtime/
│   │   ├── openaiRealtime.js   # OpenAI Realtime client (audio or text mode)
│   │   └── reconnectPolicy.js  # reconnection backoff
│   ├── voice/elevenLabsTts.js  # ElevenLabs streaming TTS client
│   ├── security/
│   │   ├── twilioSignature.js  # X-Twilio-Signature validation
│   │   └── streamToken.js      # HMAC token for the media stream
│   ├── agent/
│   │   ├── prompt.js           # system prompt with the CV
│   │   └── tools/              # transfer_call, save_contact, end_call
│   ├── services/               # summary, email, call report, storage
│   └── utils/                  # structured logger
├── data/cv/cv.md               # the CV content
├── docs/                       # project log and deployment guide
└── tests/                      # unit tests (node --test, no network)
```

## Getting started (local)

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the keys.
3. Put the CV in `data/cv/cv.md`.
4. `npm run dev` to start the backend locally.
5. `npm test` to run the unit tests (135 tests, no network calls).

Deployment guide: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
