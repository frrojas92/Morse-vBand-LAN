# Project checkpoint

Last updated: 2026-09-03

## Current state

Morse-vBand-LAN is an offline-first Node.js and Socket.IO application for multi-operator CW practice on a trusted local network. The server relays key state events while every browser generates its own sidetone with WebAudio.

## Implemented

- Callsign and room membership held in memory.
- Per-room half-duplex transmitter ownership and post-element release timing.
- Browser keyer supporting Iambic A, Iambic B, and straight-key modes.
- Morse-vBand keyboard mapping: Left Ctrl is DIT and Right Ctrl is DAH.
- Instructor authentication using `INSTRUCTOR_PIN` from `.env` through Docker Compose.
- Instructor transmission into one selected channel with the same keyer, sidetone, half-duplex ownership, decoding, and logging path used by students.
- Instructor room creation, closing, locking, receive-only mode, exercises, transmitter reservation, muting, disconnection, and forced transmitter release.
- Instructor-enforced WPM, tone frequency, waveform, and optional keyer mode.
- Sine, triangle, and square tone options. Sine remains the clean default.
- Persistent WebAudio oscillators with attack/release envelopes to reduce clicks on remote and mobile clients.
- Duration-based remote pulse scheduling to preserve dit/dah timing across jittery Wi-Fi and slow mobile WebAudio startup.
- Server-side per-operator Morse decoding to plain text and dot-dash notation.
- Monotonic text and code cursors that preserve correct incremental rendering across rolling decoder windows and word separators.
- Instructor switches for independently displaying decoded text and dot-dash code.
- Per-student decoder visibility controls and instructor callsign presence in student user lists.
- Multiline, scrollable TX/RX decoder panels in the student portal and per-operator decoder output in the instructor portal.
- Per-operator **Limpiar vista** controls that clear only the current browser display without changing other users' views or stored logs.
- Live CW audio monitoring in the instructor portal, using each channel's configured tone frequency and waveform.
- Live channel directories in both portals with duplicate-name rejection for instructor-created channels.
- Downloadable in-memory logs for rooms and individual operators: human-readable TXT transcripts and detailed per-character CSV data.
- Every TXT download retains its detailed blocks and ends with a compact TX/RX interaction containing only direction, callsign, and decoded text.
- Simplified black interface using green and red gradient lettering and status accents.
- Persistent dark/light theme switch in both portals; dark surfaces use pure `#000000`, and the locally bundled Escuela de Telecomunicaciones del Ejército de Chile emblem appears in the upper-right header.
- Docker image and Compose deployment on TCP port 8080.

## Important files

- `server/server.js`: Express, Socket.IO protocol, instructor actions, and room-state publishing.
- `server/channels.js`: Room policies, membership, transmitter lock, activity, and Morse decoder state.
- `server/clients.js`: In-memory operator identities.
- `public/cw-keyer.js`: Paddle and element timing.
- `public/cw-audio.js`: Persistent oscillator and click-reducing gain envelope.
- `public/log-format.js`: Human-readable TXT transcript grouping and word-spacing reconstruction.
- `public/app.js`: Student interface, key input, policy application, audio, and TX/RX decoder rendering.
- `public/instructor.js`: Instructor controls, per-operator monitoring, local view clearing, and CW audio playback.
- `test/instructor.test.js`: Socket.IO integration coverage for policies, instructor audio events, decoding cursors, and logging.
- `docs/GUIA_DESARROLLO.md`: Detailed architecture, protocol, extension recipes, invariants, and known limitations.

## Validation at checkpoint

- `npm test`: passing (integration coverage includes policies, decoding, monotonic cursors, instructor audio delivery, logging, and duplicate channel names).
- JavaScript syntax checks: passing.
- Git whitespace check: passing.
- Decoder regression coverage: a dot decodes to `E`, cursor positions remain monotonic after word separators, and receivers obtain measured element durations.

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
- Verify readable TXT word reconstruction with varied sending styles and long sessions.
- Verify downloaded CSV logs against intended spreadsheet software.
- Decide whether instructor monitoring needs per-channel selection or independent audio mixing when several channels transmit simultaneously.
