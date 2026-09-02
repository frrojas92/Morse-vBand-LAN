'use strict';

const channels = new Map();

const MORSE = {
  '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E', '..-.': 'F',
  '--.': 'G', '....': 'H', '..': 'I', '.---': 'J', '-.-': 'K', '.-..': 'L',
  '--': 'M', '-.': 'N', '---': 'O', '.--.': 'P', '--.-': 'Q', '.-.': 'R',
  '...': 'S', '-': 'T', '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X',
  '-.--': 'Y', '--..': 'Z', '-----': '0', '.----': '1', '..---': '2',
  '...--': '3', '....-': '4', '.....': '5', '-....': '6', '--...': '7',
  '---..': '8', '----.': '9'
};

function ensure(name) {
  if (!channels.has(name)) channels.set(name, {
    name, members: new Set(), transmitter: null, releaseTimer: null,
    locked: false, receiveOnly: false, mandatoryWpm: 15, mandatoryMode: null,
    toneFrequency: 700, toneWaveform: 'sine', decodeText: true, decodeCode: true,
    exercise: '', reservedFor: null, muted: new Set(), decoderDisabled: new Set(), activity: new Map(), logs: [], persistent: false
  });
  return channels.get(name);
}

function join(name, socketId) { ensure(name).members.add(socketId); }

function leave(name, socketId) {
  const room = channels.get(name);
  if (!room) return false;
  room.members.delete(socketId);
  room.muted.delete(socketId);
  room.decoderDisabled.delete(socketId);
  const activity = room.activity.get(socketId);
  if (activity) { clearTimeout(activity.letterTimer); clearTimeout(activity.wordTimer); }
  room.activity.delete(socketId);
  if (room.reservedFor === socketId) room.reservedFor = null;
  const wasTransmitter = room.transmitter === socketId;
  if (wasTransmitter) release(name, socketId);
  if (!room.members.size && !room.persistent) { clearTimeout(room.releaseTimer); channels.delete(name); }
  return wasTransmitter;
}

function acquire(name, socketId) {
  const room = ensure(name);
  if (room.receiveOnly) return { ok: false, reason: 'El instructor configuró este canal solo para recepción.' };
  if (room.muted.has(socketId)) return { ok: false, reason: 'El instructor silenció su transmisión.' };
  if (room.reservedFor && room.reservedFor !== socketId) return { ok: false, reason: 'El transmisor está reservado para otro operador.' };
  if (room.transmitter && room.transmitter !== socketId) return { ok: false, reason: 'Canal ocupado.' };
  clearTimeout(room.releaseTimer);
  room.releaseTimer = null;
  room.transmitter = socketId;
  const activity = decoder(room, socketId);
  activity.keyDowns += 1;
  activity.lastTransmitAt = Date.now();
  room.activity.set(socketId, activity);
  return { ok: true };
}

function decoder(room, socketId) {
  if (!room.activity.has(socketId)) room.activity.set(socketId, {
    keyDowns: 0, lastTransmitAt: null, keyStartedAt: null, currentCode: '',
    code: '', text: '', letterTimer: null, wordTimer: null
  });
  return room.activity.get(socketId);
}

function recordKey(name, socketId, down, wpm, onUpdate, callsign = '') {
  const room = get(name);
  if (!room) return null;
  const state = decoder(room, socketId);
  const ditMs = 1200 / wpm;
  if (down) {
    clearTimeout(state.letterTimer); clearTimeout(state.wordTimer);
    state.keyStartedAt = Date.now();
    return null;
  }
  if (!state.keyStartedAt) return null;
  const duration = Date.now() - state.keyStartedAt;
  state.keyStartedAt = null;
  state.currentCode += duration < ditMs * 2 ? '.' : '-';
  onUpdate();
  state.letterTimer = setTimeout(() => {
    if (!state.currentCode) return;
    const morse = state.currentCode;
    const text = MORSE[morse] || '?';
    state.code = `${state.code}${state.code && !state.code.endsWith(' / ') ? ' ' : ''}${state.currentCode}`.slice(-500);
    state.text = `${state.text}${text}`.slice(-250);
    state.currentCode = '';
    room.logs.push({ timestamp: new Date().toISOString(), socketId, callsign, morse, text, wpm,
      mode: room.mandatoryMode || 'student-choice', toneFrequency: room.toneFrequency,
      toneWaveform: room.toneWaveform, keyDurationMs: duration });
    if (room.logs.length > 10000) room.logs.splice(0, room.logs.length - 10000);
    onUpdate();
  }, Math.round(ditMs * 2));
  state.wordTimer = setTimeout(() => {
    if (state.currentCode) {
      state.code = `${state.code}${state.code ? ' ' : ''}${state.currentCode}`.slice(-500);
      state.text = `${state.text}${MORSE[state.currentCode] || '?'}`.slice(-250);
      state.currentCode = '';
    }
    if (state.text && !state.text.endsWith(' ')) state.text += ' ';
    if (state.code && !state.code.endsWith(' / ')) state.code += ' / ';
    onUpdate();
  }, Math.round(ditMs * 6));
  return { durationMs: duration };
}

function scheduleRelease(name, socketId, delay, onRelease) {
  const room = channels.get(name);
  if (!room || room.transmitter !== socketId) return;
  clearTimeout(room.releaseTimer);
  room.releaseTimer = setTimeout(() => {
    if (release(name, socketId)) onRelease();
  }, delay);
}

function release(name, socketId) {
  const room = channels.get(name);
  if (!room || room.transmitter !== socketId) return false;
  clearTimeout(room.releaseTimer);
  room.releaseTimer = null;
  room.transmitter = null;
  return true;
}

function members(name, clientStore) {
  const room = channels.get(name);
  return room ? [...room.members].map(clientStore).filter(Boolean).map(({ id, callsign }) => ({ id, callsign })) : [];
}

function transmitter(name) { return channels.get(name)?.transmitter || null; }

function get(name) { return channels.get(name); }
function list() { return [...channels.values()]; }
function create(name) { const room = ensure(name); room.persistent = true; return room; }
function canJoin(name) { return !get(name)?.locked; }
function setPolicy(name, changes) { const room = create(name); Object.assign(room, changes); return room; }
function setMuted(name, socketId, muted) { const room = ensure(name); muted ? room.muted.add(socketId) : room.muted.delete(socketId); }
function setDecoderEnabled(name, socketId, enabled) { const room = ensure(name); enabled ? room.decoderDisabled.delete(socketId) : room.decoderDisabled.add(socketId); }
function close(name) { const room = get(name); if (!room) return []; clearTimeout(room.releaseTimer); for (const state of room.activity.values()) { clearTimeout(state.letterTimer); clearTimeout(state.wordTimer); } channels.delete(name); return [...room.members]; }
function logs(name, socketId = null) { const room = get(name); return room ? room.logs.filter(entry => !socketId || entry.socketId === socketId) : []; }

module.exports = { ensure, get, list, create, canJoin, join, leave, close, acquire, scheduleRelease, release, members, transmitter, setPolicy, setMuted, setDecoderEnabled, recordKey, logs };
