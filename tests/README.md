# Tests

Project tests, run with the native runner: `node --test` (or `npm test`).

The tests make no network calls and open no WebSockets: external dependencies (OpenAI,
Resend, Twilio) are replaced with doubles, and timers are injected where needed.
