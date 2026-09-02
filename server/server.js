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
const instructors = new Set();

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

function roomState(channel) {
  const room = channels.get(channel);
  if (!room) return null;
  const txId = channels.transmitter(channel);
  return {
    channel,
    operators: channels.members(channel, clients.get).map(operator => {
      const activity = room.activity.get(operator.id);
      return { ...operator, muted: room.muted.has(operator.id), reserved: room.reservedFor === operator.id,
        keyDowns: activity?.keyDowns || 0, lastTransmitAt: activity?.lastTransmitAt || null,
        code: `${activity?.code || ''}${activity?.currentCode ? `${activity.code ? ' ' : ''}${activity.currentCode}` : ''}`,
        text: activity?.text || '' };
    }),
    transmitter: txId ? clients.get(txId)?.callsign || null : null,
    policy: { locked: room.locked, receiveOnly: room.receiveOnly, mandatoryWpm: room.mandatoryWpm,
      mandatoryMode: room.mandatoryMode, toneFrequency: room.toneFrequency, toneWaveform: room.toneWaveform,
      decodeText: room.decodeText, decodeCode: room.decodeCode, exercise: room.exercise, reservedFor: room.reservedFor }
  };
}

function instructorState() { return { channels: channels.list().map(room => roomState(room.name)).filter(Boolean) }; }
function publishInstructor() { io.to('__instructors').emit('instructor:state', instructorState()); }
function publish(channel) { const state = roomState(channel); if (state) io.to(channel).emit('room:state', state); publishInstructor(); }
function validPin(pin) { const a = Buffer.from(String(pin || '')); const b = Buffer.from(INSTRUCTOR_PIN); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function normalizeChannel(value) { return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9/_-]/g, '').slice(0, 24); }
function stopTransmission(channel) {
  const room = channels.get(channel); if (!room?.transmitter) return;
  const callsign = clients.get(room.transmitter)?.callsign || 'Operator';
  channels.release(channel, room.transmitter);
  io.to(channel).emit('cw:key', { down: false, callsign, at: Date.now() });
}

io.on('connection', (socket) => {
  socket.on('room:join', (payload = {}, reply = () => {}) => {
    const requestedChannel = normalizeChannel(payload.channel) || 'LOBBY';
    if (!channels.canJoin(requestedChannel)) return reply({ ok: false, reason: 'This channel is locked.' });
    const previous = clients.get(socket.id);
    if (previous) {
      socket.leave(previous.channel);
      channels.leave(previous.channel, socket.id);
      publish(previous.channel);
    }
    const client = clients.add(socket.id, payload.callsign, requestedChannel);
    socket.join(client.channel);
    channels.join(client.channel, socket.id);
    publish(client.channel);
    reply({ ok: true, client, state: roomState(client.channel) });
  });

  socket.on('cw:key', (payload = {}, reply = () => {}) => {
    const client = clients.get(socket.id);
    if (!client) return reply({ ok: false, reason: 'Join a channel first.' });
    const down = payload.down === true;
    const room = channels.get(client.channel);
    const wpm = room.mandatoryWpm;
    if (down) {
      const acquired = channels.acquire(client.channel, socket.id);
      if (!acquired.ok) return reply(acquired);
    } else if (room.transmitter !== socket.id) return reply({ ok: false, reason: 'You do not own the transmitter.' });
    channels.recordKey(client.channel, socket.id, down, wpm, () => publish(client.channel));
    const event = { down, callsign: client.callsign, senderId: socket.id, at: Date.now() };
    socket.to(client.channel).emit('cw:key', event);
    if (down) publish(client.channel);
    else channels.scheduleRelease(client.channel, socket.id, Math.round(4800 / wpm), () => publish(client.channel));
    reply({ ok: true });
  });

  socket.on('instructor:login', (payload = {}, reply = () => {}) => {
    if (!validPin(payload.pin)) return reply({ ok: false, reason: 'Invalid instructor PIN.' });
    instructors.add(socket.id); socket.join('__instructors'); reply({ ok: true, ...instructorState() });
  });

  socket.on('instructor:action', (payload = {}, reply = () => {}) => {
    if (!instructors.has(socket.id)) return reply({ ok: false, reason: 'Instructor login required.' });
    const channel = normalizeChannel(payload.channel);
    if (!channel) return reply({ ok: false, reason: 'A valid channel is required.' });
    const room = channels.get(channel);
    const target = String(payload.target || '');
    switch (payload.action) {
      case 'create': channels.create(channel); break;
      case 'close':
        stopTransmission(channel);
        for (const id of channels.close(channel)) { io.to(id).emit('room:closed', { channel }); io.sockets.sockets.get(id)?.leave(channel); clients.remove(id); }
        publishInstructor(); return reply({ ok: true });
      case 'lock': channels.setPolicy(channel, { locked: Boolean(payload.value) }); break;
      case 'receiveOnly': stopTransmission(channel); channels.setPolicy(channel, { receiveOnly: Boolean(payload.value) }); break;
      case 'exercise': channels.setPolicy(channel, { exercise: String(payload.value || '').slice(0, 500) }); break;
      case 'wpm': { const speed = Number(payload.value); channels.setPolicy(channel, { mandatoryWpm: Number.isFinite(speed) ? Math.max(5, Math.min(60, speed)) : 20 }); break; }
      case 'tone': { const frequency = Number(payload.value); channels.setPolicy(channel, { toneFrequency: Number.isFinite(frequency) ? Math.max(300, Math.min(1200, frequency)) : 700 }); break; }
      case 'waveform': channels.setPolicy(channel, { toneWaveform: ['sine', 'triangle', 'square'].includes(payload.value) ? payload.value : 'sine' }); break;
      case 'decodeText': channels.setPolicy(channel, { decodeText: Boolean(payload.value) }); break;
      case 'decodeCode': channels.setPolicy(channel, { decodeCode: Boolean(payload.value) }); break;
      case 'mode': channels.setPolicy(channel, { mandatoryMode: ['iambic-a', 'iambic-b', 'straight'].includes(payload.value) ? payload.value : null }); break;
      case 'reserve': channels.setPolicy(channel, { reservedFor: target || null }); break;
      case 'mute':
        if (!room?.members.has(target)) return reply({ ok: false, reason: 'Operator not found.' });
        channels.setMuted(channel, target, Boolean(payload.value)); if (room.transmitter === target) stopTransmission(channel); break;
      case 'disconnect':
        if (!room?.members.has(target)) return reply({ ok: false, reason: 'Operator not found.' });
        io.sockets.sockets.get(target)?.disconnect(true); return reply({ ok: true });
      case 'clear': stopTransmission(channel); channels.setPolicy(channel, { reservedFor: null }); break;
      default: return reply({ ok: false, reason: 'Unknown instructor action.' });
    }
    publish(channel); reply({ ok: true });
  });

  socket.on('disconnect', () => {
    instructors.delete(socket.id);
    const client = clients.remove(socket.id);
    if (!client) return;
    const wasTransmitting = channels.leave(client.channel, socket.id);
    if (wasTransmitting) socket.to(client.channel).emit('cw:key', { down: false, callsign: client.callsign, at: Date.now() });
    publish(client.channel);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Morse-vBand-LAN listening on 0.0.0.0:${PORT}`));
