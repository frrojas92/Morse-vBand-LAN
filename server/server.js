'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const clients = require('./clients');
const channels = require('./channels');

const PORT = Number(process.env.PORT) || 8080;
const INSTRUCTOR_PIN = String(process.env.INSTRUCTOR_PIN || 'morse-admin');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { serveClient: true });
const instructors = new Map();

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

function roomState(channel) {
  const room = channels.get(channel);
  if (!room) return null;
  const txId = channels.transmitter(channel);
  return {
    channel,
    instructors: [...instructors].map(([id, callsign]) => ({ id, callsign, role: 'instructor' })),
    operators: channels.members(channel, clients.get).map(operator => {
      const activity = room.activity.get(operator.id);
      return { ...operator, muted: room.muted.has(operator.id), decoderEnabled: !room.decoderDisabled.has(operator.id), reserved: room.reservedFor === operator.id,
        keyDowns: activity?.keyDowns || 0, lastTransmitAt: activity?.lastTransmitAt || null,
        code: `${activity?.code || ''}${activity?.currentCode ? `${activity.code && !activity.code.endsWith(' / ') ? ' ' : ''}${activity.currentCode}` : ''}`,
        codeCursor: (activity?.codeLength || 0) + (activity?.currentCode ? (activity.code && !activity.code.endsWith(' / ') ? 1 : 0) + activity.currentCode.length : 0),
        text: activity?.text || '', textCursor: activity?.textLength || 0 };
    }),
    transmitter: txId ? clients.get(txId)?.callsign || null : null,
    policy: { locked: room.locked, receiveOnly: room.receiveOnly, mandatoryWpm: room.mandatoryWpm,
      mandatoryMode: room.mandatoryMode, toneFrequency: room.toneFrequency, toneWaveform: room.toneWaveform,
      decodeText: room.decodeText, decodeCode: room.decodeCode, exercise: room.exercise, reservedFor: room.reservedFor }
  };
}

function instructorState() { return { channels: channels.list().map(room => roomState(room.name)).filter(Boolean) }; }
function roomDirectory() { return channels.list().map(room => ({ name: room.name, operators: room.members.size, locked: room.locked })); }
function publishDirectory() { io.emit('room:list', roomDirectory()); }
function publishInstructor() { io.to('__instructors').emit('instructor:state', instructorState()); }
function publishInstructorCw(channel, event) { io.to('__instructors').emit('instructor:cw', { channel, ...event }); }
function publish(channel) { const state = roomState(channel); if (state) io.to(channel).emit('room:state', state); publishInstructor(); }
function publishAllRooms() { for (const room of channels.list()) publish(room.name); }
function validPin(pin) { const a = Buffer.from(String(pin || '')); const b = Buffer.from(INSTRUCTOR_PIN); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function normalizeChannel(value) { return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9/_-]/g, '').slice(0, 24); }
function stopTransmission(channel) {
  const room = channels.get(channel); if (!room?.transmitter) return;
  const callsign = clients.get(room.transmitter)?.callsign || 'Operator';
  channels.release(channel, room.transmitter);
  const event = { down: false, callsign, at: Date.now() };
  io.to(channel).emit('cw:key', event);
  publishInstructorCw(channel, event);
}

io.on('connection', (socket) => {
  socket.emit('room:list', roomDirectory());
  socket.on('room:join', (payload = {}, reply = () => {}) => {
    const requestedChannel = normalizeChannel(payload.channel) || 'LOBBY';
    if (!channels.canJoin(requestedChannel)) return reply({ ok: false, reason: 'Este canal está bloqueado.' });
    const previous = clients.get(socket.id);
      if (previous) {
        socket.leave(previous.channel);
        const wasTransmitting = channels.leave(previous.channel, socket.id);
        if (wasTransmitting) {
          const event = { down: false, callsign: previous.callsign, senderId: socket.id, at: Date.now() };
          socket.to(previous.channel).emit('cw:key', event);
          publishInstructorCw(previous.channel, event);
        }
        publish(previous.channel);
      }
    const client = clients.add(socket.id, payload.callsign, requestedChannel);
    socket.join(client.channel);
    channels.join(client.channel, socket.id);
    publish(client.channel);
    publishDirectory();
    reply({ ok: true, client, state: roomState(client.channel) });
  });

  socket.on('logs:get', (payload = {}, reply = () => {}) => {
    const requester = clients.get(socket.id);
    const isInstructor = instructors.has(socket.id);
    const channel = normalizeChannel(payload.channel || requester?.channel);
    if (!channel || (!isInstructor && requester?.channel !== channel)) return reply({ ok: false, reason: 'Primero debe ingresar a este canal.' });
    const target = String(payload.target || '');
    if (target && !channels.get(channel)?.members.has(target)) return reply({ ok: false, reason: 'No se encontró al operador en este canal.' });
    const entries = channels.logs(channel, target || null).map(entry => ({
      timestamp: entry.timestamp, channel, direction: entry.socketId === socket.id ? 'TX' : 'RX',
      callsign: entry.callsign || clients.get(entry.socketId)?.callsign || 'UNKNOWN', morse: entry.morse,
      text: entry.text, wpm: entry.wpm, mode: entry.mode, toneFrequency: entry.toneFrequency,
      toneWaveform: entry.toneWaveform, keyDurationMs: entry.keyDurationMs
    }));
    reply({ ok: true, entries });
  });

  socket.on('cw:key', (payload = {}, reply = () => {}) => {
    const client = clients.get(socket.id);
    if (!client) return reply({ ok: false, reason: 'Primero debe ingresar a un canal.' });
    const down = payload.down === true;
    const room = channels.get(client.channel);
    const wpm = room.mandatoryWpm;
    if (down) {
      const acquired = channels.acquire(client.channel, socket.id);
      if (!acquired.ok) return reply(acquired);
    } else if (room.transmitter !== socket.id) return reply({ ok: false, reason: 'No tiene el control del transmisor.' });
    const keyRecord = channels.recordKey(client.channel, socket.id, down, wpm, () => publish(client.channel), client.callsign);
    const event = { down, callsign: client.callsign, senderId: socket.id, at: Date.now(),
      durationMs: keyRecord?.durationMs || null };
    socket.to(client.channel).emit('cw:key', event);
    publishInstructorCw(client.channel, event);
    if (down) publish(client.channel);
    else channels.scheduleRelease(client.channel, socket.id, Math.round(4800 / wpm), () => publish(client.channel));
    reply({ ok: true });
  });

  socket.on('instructor:login', (payload = {}, reply = () => {}) => {
    if (!validPin(payload.pin)) return reply({ ok: false, reason: 'PIN de instructor incorrecto.' });
    const callsign = String(payload.callsign || 'INSTRUCTOR').trim().toUpperCase().replace(/[^A-Z0-9/_-]/g, '').slice(0, 16) || 'INSTRUCTOR';
    instructors.set(socket.id, callsign); socket.join('__instructors'); reply({ ok: true, ...instructorState() }); publishAllRooms();
  });

  socket.on('instructor:tx:join', (payload = {}, reply = () => {}) => {
    const callsign = instructors.get(socket.id);
    if (!callsign) return reply({ ok: false, reason: 'Se requiere acceso de instructor.' });
    const channel = normalizeChannel(payload.channel);
    if (!channel || !channels.get(channel)) return reply({ ok: false, reason: 'No se encontró el canal.' });
    const previous = clients.get(socket.id);
    if (previous?.channel !== channel) {
      if (previous) {
        socket.leave(previous.channel);
        const wasTransmitting = channels.leave(previous.channel, socket.id);
        if (wasTransmitting) {
          const event = { down: false, callsign: previous.callsign, senderId: socket.id, at: Date.now() };
          socket.to(previous.channel).emit('cw:key', event);
          publishInstructorCw(previous.channel, event);
        }
        publish(previous.channel);
      }
      clients.add(socket.id, callsign, channel);
      socket.join(channel);
      channels.join(channel, socket.id);
      publish(channel);
      publishDirectory();
    }
    reply({ ok: true, client: clients.get(socket.id), state: roomState(channel) });
  });

  socket.on('instructor:action', (payload = {}, reply = () => {}) => {
    if (!instructors.has(socket.id)) return reply({ ok: false, reason: 'Se requiere acceso de instructor.' });
    const channel = normalizeChannel(payload.channel);
    if (!channel) return reply({ ok: false, reason: 'Se requiere un canal válido.' });
    const room = channels.get(channel);
    const target = String(payload.target || '');
    switch (payload.action) {
      case 'create':
        if (room) return reply({ ok: false, reason: `El canal ${channel} ya existe.` });
        channels.create(channel); break;
      case 'close':
        stopTransmission(channel);
        for (const id of channels.close(channel)) { io.to(id).emit('room:closed', { channel }); io.sockets.sockets.get(id)?.leave(channel); clients.remove(id); }
        publishInstructor(); publishDirectory(); return reply({ ok: true });
      case 'lock': channels.setPolicy(channel, { locked: Boolean(payload.value) }); break;
      case 'receiveOnly': stopTransmission(channel); channels.setPolicy(channel, { receiveOnly: Boolean(payload.value) }); break;
      case 'exercise': channels.setPolicy(channel, { exercise: String(payload.value || '').slice(0, 500) }); break;
      case 'wpm': { const speed = Number(payload.value); channels.setPolicy(channel, { mandatoryWpm: Number.isFinite(speed) ? Math.max(5, Math.min(60, speed)) : 20 }); break; }
      case 'tone': { const frequency = Number(payload.value); channels.setPolicy(channel, { toneFrequency: Number.isFinite(frequency) ? Math.max(300, Math.min(1200, frequency)) : 700 }); break; }
      case 'waveform': channels.setPolicy(channel, { toneWaveform: ['sine', 'triangle', 'square'].includes(payload.value) ? payload.value : 'sine' }); break;
      case 'decodeText': channels.setPolicy(channel, { decodeText: Boolean(payload.value) }); break;
      case 'decodeCode': channels.setPolicy(channel, { decodeCode: Boolean(payload.value) }); break;
      case 'studentDecoder':
        if (!room?.members.has(target)) return reply({ ok: false, reason: 'No se encontró al operador.' });
        channels.setDecoderEnabled(channel, target, Boolean(payload.value)); break;
      case 'mode': channels.setPolicy(channel, { mandatoryMode: ['iambic-a', 'iambic-b', 'straight'].includes(payload.value) ? payload.value : null }); break;
      case 'reserve': channels.setPolicy(channel, { reservedFor: target || null }); break;
      case 'mute':
        if (!room?.members.has(target)) return reply({ ok: false, reason: 'No se encontró al operador.' });
        channels.setMuted(channel, target, Boolean(payload.value)); if (room.transmitter === target) stopTransmission(channel); break;
      case 'disconnect':
        if (!room?.members.has(target)) return reply({ ok: false, reason: 'No se encontró al operador.' });
        io.sockets.sockets.get(target)?.disconnect(true); return reply({ ok: true });
      case 'clear': stopTransmission(channel); channels.setPolicy(channel, { reservedFor: null }); break;
      default: return reply({ ok: false, reason: 'Acción de instructor desconocida.' });
    }
    publish(channel); publishDirectory(); reply({ ok: true });
  });

  socket.on('disconnect', () => {
    const wasInstructor = instructors.delete(socket.id);
    const client = clients.remove(socket.id);
    if (!client) { if (wasInstructor) publishAllRooms(); return; }
    const wasTransmitting = channels.leave(client.channel, socket.id);
    if (wasTransmitting) {
      const event = { down: false, callsign: client.callsign, at: Date.now() };
      socket.to(client.channel).emit('cw:key', event);
      publishInstructorCw(client.channel, event);
    }
    publish(client.channel);
    publishDirectory();
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Morse-vBand-LAN listening on 0.0.0.0:${PORT}`));
