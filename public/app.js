import { CwAudio } from './cw-audio.js';
import { CwKeyer } from './cw-keyer.js';
import { formatTextLog } from './log-format.js';

const socket = io();
const localAudio = new CwAudio();
const remoteAudio = new CwAudio();
const $ = (selector) => document.querySelector(selector);
let joined = false;
let clientId = null;
let transmissionAllowed = true;
let currentWpm = 15;
let currentChannel = '';
let remoteAudioQueue = Promise.resolve();
let latestRoomState = null;
const decoderViews = new Map();

const keyer = new CwKeyer(async (down) => {
  if (down && !transmissionAllowed) return setStatus('Transmisión desactivada por el instructor.', 'error');
  if (down) await localAudio.keyDown(); else localAudio.keyUp();
  if (joined) socket.emit('cw:key', { down }, (answer) => {
    if (!answer?.ok) { localAudio.keyUp(); setStatus(answer?.reason || 'Transmisión rechazada.', 'error'); }
  });
});

function setStatus(message, kind = '') { $('#status').textContent = message; $('#status').className = kind; }
function safeFilename(value) { return value.replace(/[^A-Z0-9_-]/gi, '_'); }
function downloadLog(entries, filename, format) {
  const columns = ['timestamp', 'channel', 'direction', 'callsign', 'morse', 'text', 'wpm', 'mode', 'toneFrequency', 'toneWaveform', 'keyDurationMs'];
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const content = format === 'csv'
    ? [columns.join(','), ...entries.map(entry => columns.map(column => quote(entry[column])).join(','))].join('\n')
    : formatTextLog(entries, currentChannel);
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([content], { type: format === 'csv' ? 'text/csv' : 'text/plain' })); link.download = filename; link.click(); URL.revokeObjectURL(link.href);
}
function requestLog(target, label, format) {
  socket.emit('logs:get', { channel: currentChannel, target }, answer => {
    if (!answer?.ok) return setStatus(answer?.reason || 'No se pudo descargar el registro.', 'error');
    downloadLog(answer.entries, `${safeFilename(currentChannel)}-${label}-log.${format}`, format);
  });
}
function configure() {
  keyer.configure($('#mode').value, currentWpm);
}

function decoderView(operator) {
  const sourceText = operator.text || '';
  const sourceCode = operator.code || '';
  const textCursor = operator.textCursor ?? sourceText.length;
  const codeCursor = operator.codeCursor ?? sourceCode.length;
  const view = decoderViews.get(operator.id);
  if (!view) {
    const initial = { textCursor, codeCursor, text: sourceText, code: sourceCode };
    decoderViews.set(operator.id, initial);
    return initial;
  }
  const newTextLength = textCursor - view.textCursor;
  const newCodeLength = codeCursor - view.codeCursor;
  if (newTextLength > 0) view.text += sourceText.slice(-newTextLength);
  else if (newTextLength < 0) view.text = sourceText;
  if (newCodeLength > 0) view.code += sourceCode.slice(-newCodeLength);
  else if (newCodeLength < 0) view.code = sourceCode;
  view.textCursor = textCursor;
  view.codeCursor = codeCursor;
  return view;
}

function clearDecoder(operator) {
  const view = decoderView(operator);
  view.text = '';
  view.code = '';
  if (latestRoomState) renderDecoders(latestRoomState);
}

function renderDecoders(state) {
  const me = state.operators.find(operator => operator.id === clientId);
  const enabled = me?.decoderEnabled !== false && (state.policy.decodeText || state.policy.decodeCode);
  $('#decoderPanel').hidden = !enabled;
  if (!enabled) return;
  $('#decoders').replaceChildren(...state.operators.map(operator => {
    const row = document.createElement('article'); row.className = 'decode-row';
    const header = document.createElement('div'); header.className = 'decode-header';
    const heading = document.createElement('h3'); heading.textContent = `${operator.id === clientId ? 'TX' : 'RX'} · ${operator.callsign}`;
    header.append(heading, buttonForClear(operator)); row.append(header);
    const view = decoderView(operator);
    const message = document.createElement('div'); message.className = 'decode-message';
    if (state.policy.decodeText) { const text = document.createElement('p'); text.className = 'decoded-text'; text.textContent = view.text || '…'; message.append(text); }
    if (state.policy.decodeCode) { const code = document.createElement('code'); code.textContent = view.code || '…'; message.append(code); }
    row.append(message);
    return row;
  }));
}

function buttonForClear(operator) {
  const control = document.createElement('button');
  control.type = 'button';
  control.className = 'clear-decoder';
  control.textContent = 'Limpiar vista';
  control.title = 'Limpia solo esta vista; no modifica los registros TXT/CSV';
  control.onclick = () => clearDecoder(operator);
  return control;
}

function applyState(state) {
  latestRoomState = state;
  const operatorRows = state.operators.map(operator => {
    const li = document.createElement('li'); const name = document.createElement('span'); name.textContent = operator.callsign;
    const actions = document.createElement('span'); actions.className = 'operator-log-actions';
    for (const format of ['txt', 'csv']) { const control = document.createElement('button'); control.type = 'button'; control.textContent = format.toUpperCase(); control.onclick = () => requestLog(operator.id, safeFilename(operator.callsign), format); actions.append(control); }
    li.append(name, actions); return li;
  });
  const instructorRows = (state.instructors || []).map(instructor => {
    const li = document.createElement('li'); li.className = 'instructor-presence';
    const name = document.createElement('span'); name.textContent = instructor.callsign;
    const role = document.createElement('b'); role.textContent = 'INSTRUCTOR'; li.append(name, role); return li;
  });
  $('#operators').replaceChildren(...operatorRows, ...instructorRows);
  $('#transmitter').textContent = state.transmitter || 'Canal libre';
  $('#transmitter').classList.toggle('busy', Boolean(state.transmitter));
  const me = state.operators.find(operator => operator.id === clientId);
  transmissionAllowed = !state.policy.receiveOnly && !me?.muted && (!state.policy.reservedFor || state.policy.reservedFor === clientId);
  currentWpm = state.policy.mandatoryWpm;
  $('#wpmValue').textContent = currentWpm;
  $('#frequencyValue').textContent = state.policy.toneFrequency;
  $('#waveformValue').textContent = ({ sine: 'senoidal', triangle: 'triangular', square: 'cuadrada' })[state.policy.toneWaveform] || state.policy.toneWaveform;
  localAudio.setFrequency(state.policy.toneFrequency); remoteAudio.setFrequency(state.policy.toneFrequency);
  localAudio.setWaveform(state.policy.toneWaveform); remoteAudio.setWaveform(state.policy.toneWaveform);
  if (state.policy.mandatoryMode) { $('#mode').value = state.policy.mandatoryMode; $('#mode').disabled = true; } else $('#mode').disabled = false;
  configure(); renderDecoders(state);
  $('#exercise').textContent = state.policy.exercise || 'No hay ejercicio asignado.';
  $('#exercisePanel').hidden = !state.policy.exercise;
  if (!transmissionAllowed) { keyer.releaseAll(); localAudio.keyUp(); }
}

$('#joinForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  await localAudio.unlock(); await remoteAudio.unlock();
  socket.emit('room:join', { callsign: $('#callsign').value, channel: $('#channel').value }, (answer) => {
    joined = Boolean(answer?.ok);
    if (joined) { clientId = answer.client.id; currentChannel = answer.client.channel; $('#station').disabled = true; $('#downloadRoomTxt').disabled = false; $('#downloadRoomCsv').disabled = false; setStatus(`Conectado al canal ${answer.client.channel}`, 'ok'); applyState(answer.state); }
    else setStatus(answer?.reason || 'No se pudo ingresar al canal.', 'error');
  });
});

$('#mode').addEventListener('input', configure);
$('#downloadRoomTxt').addEventListener('click', () => requestLog('', 'room', 'txt'));
$('#downloadRoomCsv').addEventListener('click', () => requestLog('', 'room', 'csv'));
configure();

const paddleFor = (event) => event.code === 'ControlLeft' ? 'dit' : event.code === 'ControlRight' ? 'dah' : null;
window.addEventListener('keydown', (event) => {
  const paddle = paddleFor(event);
  if (!paddle || event.repeat || !joined) return;
  event.preventDefault();
  keyer.setPaddle(paddle, true);
  $(`#${paddle}Lamp`).classList.add('active');
});
window.addEventListener('keyup', (event) => {
  const paddle = paddleFor(event);
  if (!paddle) return;
  event.preventDefault();
  keyer.setPaddle(paddle, false);
  $(`#${paddle}Lamp`).classList.remove('active');
});
window.addEventListener('blur', () => { keyer.releaseAll(); document.querySelectorAll('.paddle').forEach(el => el.classList.remove('active')); });

socket.on('room:state', applyState);
socket.on('room:list', rooms => {
  $('#roomList').replaceChildren(...(rooms.length ? rooms.map(room => {
    const li = document.createElement('li');
    const button = document.createElement('button'); button.type = 'button'; button.disabled = room.locked || joined;
    button.textContent = room.name; button.onclick = () => { $('#channel').value = room.name; $('#callsign').focus(); };
    const detail = document.createElement('span'); detail.textContent = `${room.operators} operador${room.operators === 1 ? '' : 'es'}${room.locked ? ' · bloqueado' : ''}`;
    li.append(button, detail); return li;
  }) : [Object.assign(document.createElement('li'), { className: 'muted', textContent: 'No hay canales activos' })]));
});
socket.on('cw:key', ({ down, at, durationMs }) => {
  remoteAudioQueue = remoteAudioQueue
    .catch(() => {})
    .then(() => remoteAudio.scheduleRemoteKey(down, at, durationMs));
});
socket.on('room:closed', () => { joined = false; clientId = null; currentChannel = ''; latestRoomState = null; decoderViews.clear(); keyer.releaseAll(); localAudio.keyUp(); remoteAudio.keyUp(); $('#station').disabled = false; $('#downloadRoomTxt').disabled = true; $('#downloadRoomCsv').disabled = true; setStatus('Canal cerrado.', 'error'); });
socket.on('disconnect', () => { joined = false; currentChannel = ''; latestRoomState = null; decoderViews.clear(); remoteAudio.keyUp(); $('#station').disabled = false; $('#downloadRoomTxt').disabled = true; $('#downloadRoomCsv').disabled = true; setStatus('Desconectado.', 'error'); });
