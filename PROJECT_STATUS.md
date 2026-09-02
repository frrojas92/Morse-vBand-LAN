# Project checkpoint

Last updated: 2026-09-02

## Current state

Morse-vBand-LAN is an offline-first Node.js and Socket.IO application for multi-operator CW practice on a trusted local network. The server relays key state events while every browser generates its own sidetone with WebAudio.

## Implemented

- Callsign and room membership held in memory.
- Per-room half-duplex transmitter ownership and post-element release timing.
- Browser keyer supporting Iambic A, Iambic B, and straight-key modes.
- Morse-vBand keyboard mapping: Left Ctrl is DIT and Right Ctrl is DAH.
- Instructor authentication using `INSTRUCTOR_PIN` from `.env` through Docker Compose.
- Instructor room creation, closing, locking, receive-only mode, exercises, transmitter reservation, muting, disconnection, and forced transmitter release.
- Instructor-enforced WPM, tone frequency, waveform, and optional keyer mode.
- Sine, triangle, and square tone options. Sine remains the clean default.
- Persistent WebAudio oscillators with attack/release envelopes to reduce clicks on remote and mobile clients.
- Server-side per-operator Morse decoding to plain text and dot-dash notation.
- Instructor switches for independently displaying decoded text and dot-dash code.
- TX/RX decoder views in the student portal and per-operator decoder output in the instructor portal.
- Docker image and Compose deployment on TCP port 8080.

## Important files

- `server/server.js`: Express, Socket.IO protocol, instructor actions, and room-state publishing.
- `server/channels.js`: Room policies, membership, transmitter lock, activity, and Morse decoder state.
- `server/clients.js`: In-memory operator identities.
- `public/cw-keyer.js`: Paddle and element timing.
- `public/cw-audio.js`: Persistent oscillator and click-reducing gain envelope.
- `public/app.js`: Student interface, key input, policy application, audio, and TX/RX decoder rendering.
- `public/instructor.js`: Instructor controls and per-operator monitoring.
- `test/instructor.test.js`: Socket.IO integration coverage for instructor enforcement.

## Validation at checkpoint

- `npm test`: passing (1 integration test).
- JavaScript syntax checks: passing.
- Git whitespace check: passing.
- Decoder timing smoke check: a dot decodes to `E`.

## Deployment

The real instructor PIN belongs only in the ignored `.env` file. `.env.example` contains a placeholder.

```sh
cd /home/rasputin/Projects/Morse-vBand-LAN
sudo docker compose up -d --build
```

Hard-refresh instructor and student browsers after rebuilding so cached JavaScript and CSS are replaced.

## Follow-up verification

- Test sustained CW on the target phone over both Wi-Fi and Ethernet and tune the audio envelope if clicks remain.
- Verify decoder word spacing across the intended WPM range and with real paddle technique.
- Expand automated coverage for tone policies and decoder output.
