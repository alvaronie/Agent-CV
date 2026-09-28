# Agent CV

An AI voice agent that answers phone calls with information about my CV. Companies can
call, ask questions, request to be transferred to my mobile, or leave their contact
details. When the call ends, I receive an email with the summary.

## Architecture (Path B — DIY)

```
Incoming call
      │
      ▼
  Twilio (number + Media Streams)
      │  streaming audio (WebSocket)
      ▼
  Node.js backend  ◄──►  OpenAI Realtime API (STT + LLM + TTS)
      │
      ├─ tool: transfer_call  → Twilio <Dial> to my mobile
      ├─ tool: save_contact   → storage (JSONL / DB)
      └─ on hangup: summary (LLM) → email (Resend)
```

## Project structure

```
Agent CV/
├── README.md
├── render.yaml               # Render deployment blueprint
├── .gitignore
├── .env.example              # environment variable template
├── package.json
├── src/
│   ├── index.js              # HTTP + WebSocket server (entry point)
│   ├── config/
│   │   └── index.js          # loads and validates environment variables
│   ├── telephony/
│   │   ├── twilioWebhook.js  # incoming-call webhook (returns TwiML)
│   │   ├── mediaStream.js    # handles the Media Streams WebSocket
│   │   ├── callLimiter.js    # concurrency / daily call limits
│   │   ├── callGuard.js      # silence timeout / max caller turns
│   │   └── twilioClient.js   # shared Twilio REST client
│   ├── realtime/
│   │   ├── openaiRealtime.js # connection to the OpenAI Realtime API
│   │   └── reconnectPolicy.js# reconnection backoff policy
│   ├── security/
│   │   ├── twilioSignature.js# X-Twilio-Signature validation
│   │   └── streamToken.js    # HMAC token for the media-stream WebSocket
│   ├── agent/
│   │   ├── prompt.js         # builds the system prompt with the CV
│   │   └── tools/
│   │       ├── transferCall.js
│   │       ├── saveContact.js
│   │       └── endCall.js
│   ├── services/
│   │   ├── summary.js        # generates the call summary with the LLM
│   │   ├── email.js          # sends the summary email (Resend)
│   │   ├── callReport.js     # orchestrates summary + email + record on hangup
│   │   └── storage.js        # saves contacts and call records
│   └── utils/
│       ├── logger.js
│       └── logFormat.js
├── data/
│   └── cv/
│       └── cv.md             # the CV content goes HERE
├── scripts/                  # helper scripts (setup, local testing)
└── tests/                    # tests (node --test)
```

## Getting started (local)

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the keys.
3. Put the CV in `data/cv/cv.md`.
4. `npm run dev` to start the backend locally.
5. `npm test` to run the unit tests (no network calls).

## Status

Phases 1–6 implemented: server, real-time audio bridge, CV and personality, agent
actions, post-call email summary, and robustness/guardrails (Twilio signature validation,
media-stream authentication, concurrency/daily limits, OpenAI reconnection, silence and
max-turns timeouts, prompt-injection resistance, PII-safe logs, structured logging).
Phase 7 (cloud deployment) is prepared for Render; the first real phone-call test happens
once deployed.

Full plan, decisions and status in [`docs/PROJECT_LOG.md`](docs/PROJECT_LOG.md).
Deployment guide in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
