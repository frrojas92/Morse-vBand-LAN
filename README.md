# Morse-vBand-LAN

Offline-first LAN application for CW practice with multiple operators. A browser turns Morse-vBand USB HID input into timed key events; the server relays only those events and every receiving browser produces its own WebAudio sidetone.

The supported hardware is [Morse-vBand](https://github.com/frrojas92/Morse-vBand): Left Ctrl is DIT and Right Ctrl is DAH. A normal keyboard can also be used for testing.

## Run with Docker

Docker Engine with the Compose plugin is required. Building the image needs internet access once to download the Node base image and npm packages. After the image is present, runtime is fully independent of the internet.

```sh
docker compose up -d
docker compose logs -f
```

Open `http://SERVER-IP:8080` from computers on the same LAN. Allow inbound TCP port 8080 in the server firewall if necessary. Stop with `docker compose down`.

The instructor dashboard is at `http://SERVER-IP:8080/instructor.html`. Copy `.env.example` to `.env`, choose a private PIN, then rebuild:

```sh
cp .env.example .env
docker compose up -d --build
```

If omitted, the development default is `morse-admin`; change it on any shared LAN.

## Run without Docker

```sh
npm install
npm start
```

Then open `http://localhost:8080`.

## MVP behavior

- Callsigns and rooms live only in memory and disappear on restart.
- Rooms are independent; presence and current-transmitter state are room scoped.
- Half-duplex is enforced by a per-room server lock. It is released after a short post-element hang time or immediately on disconnect.
- Iambic A, Iambic B, and straight-key modes are timed in the originating browser. WPM is enforced per room by the instructor.
- Tone frequency and sine/triangle/square waveform are enforced per room by the instructor.
- The server decodes each operator independently. The instructor can show or hide decoded text and dot-dash code in both instructor and student views.
- The browser may require the Join button gesture before WebAudio is allowed to play.
- No audio is recorded or sent over the network. Socket.IO carries key-down/key-up and room-state events only.
- Instructor Mode can create/close/lock rooms, enforce WPM, tone, waveform, and keyer mode, control decoder visibility, assign exercises, switch students to receive-only, reserve or clear the transmitter, mute/disconnect operators, and monitor key activity.

## Architecture

- `server/server.js`: HTTP/static server and Socket.IO protocol.
- `server/channels.js`: in-memory membership and half-duplex ownership.
- `server/clients.js`: in-memory operator identity.
- `public/cw-keyer.js`: paddle state and keyer timing.
- `public/cw-audio.js`: local oscillator and click-free envelope.
- `public/app.js`: HID-keyboard input, UI, and realtime events.

This is deliberately an unauthenticated training MVP. Use it only on a trusted LAN.
