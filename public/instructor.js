import { CwAudio } from './cw-audio.js';
import { CwKeyer } from './cw-keyer.js';
import { formatTextLog } from './log-format.js';

const socket = io();
const $ = selector => document.querySelector(selector);
const monitorAudio = new CwAudio();
const txAudio = new CwAudio();
let authenticated = false;
let txJoined = false;
let txChannel = '';
let txAllowed = false;
let txWpm = 15;
const decoderViews = new Map();
let latestInstructorState = null;
let monitorAudioQueue = Promise.resolve();
const txKeyer = new CwKeyer(async down => {
  if (down && !txAllowed) return status('La transmisión no está permitida en este canal.', true);
  if (down) await txAudio.keyDown(); else txAudio.keyUp();
  if (txJoined) socket.emit('cw:key', { down }, answer => {
    if (!answer?.ok) { txAudio.keyUp(); status(answer?.reason || 'Transmisión rechazada.', true); }
  });
});
function status(message, error = false) { $('#status').textContent = message; $('#status').className = error ? 'error' : 'ok'; }
function action(channel, name, value = null, target = '', callback = null) { socket.emit('instructor:action', { channel, action: name, value, target }, answer => { if (!answer?.ok) status(answer?.reason || 'La acción falló.', true); callback?.(answer); }); }
function button(text, handler, danger = false) { const el = document.createElement('button'); el.type = 'button'; el.textContent = text; if (danger) el.className = 'danger'; el.onclick = handler; return el; }
function safeFilename(value) { return value.replace(/[^A-Z0-9_-]/gi, '_'); }
function decoderView(channel, operator) {
  const key = `${channel}:${operator.id}`;
  const sourceText = operator.text || '';
  const sourceCode = operator.code || '';
  const textCursor = operator.textCursor ?? sourceText.length;
  const codeCursor = operator.codeCursor ?? sourceCode.length;
  const view = decoderViews.get(key);
  if (!view) {
    const initial = { textCursor, codeCursor, text: sourceText, code: sourceCode };
    decoderViews.set(key, initial);
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
function clearDecoder(channel, operator) {
  const view = decoderView(channel, operator);
  view.text = '';
  view.code = '';
  if (latestInstructorState) render(latestInstructorState);
}
async function selectTxChannel(channel) {
  try { await Promise.all([txAudio.unlock(), monitorAudio.unlock()]); }
  catch { return status('No se pudo activar el audio del transmisor.', true); }
  socket.emit('instructor:tx:join', { channel }, answer => {
    if (!answer?.ok) return status(answer?.reason || 'No se pudo seleccionar el canal.', true);
    txJoined = true;
    txChannel = answer.client.channel;
    $('#txChannel').textContent = txChannel;
    applyTxState(answer.state);
    status(`Transmisor del instructor conectado a ${txChannel}.`);
  });
}
function applyTxState(room) {
  if (!room || room.channel !== txChannel) return;
  const me = room.operators.find(operator => operator.id === socket.id);
  txWpm = room.policy.mandatoryWpm;
  txAllowed = !room.policy.receiveOnly && !me?.muted && (!room.policy.reservedFor || room.policy.reservedFor === socket.id);
  $('#txWpm').textContent = txWpm;
  $('#txState').textContent = txAllowed ? 'Listo para transmitir.' : 'Transmisión restringida por la política del canal.';
  txAudio.setFrequency(room.policy.toneFrequency);
  txAudio.setWaveform(room.policy.toneWaveform);
  if (room.policy.mandatoryMode) { $('#txMode').value = room.policy.mandatoryMode; $('#txMode').disabled = true; }
  else $('#txMode').disabled = false;
  txKeyer.configure($('#txMode').value, txWpm);
  if (!txAllowed) { txKeyer.releaseAll(); txAudio.keyUp(); }
}
function downloadLog(channel, target = '', callsign = 'room', format = 'csv') {
  socket.emit('logs:get', { channel, target }, answer => {
    if (!answer?.ok) return status(answer?.reason || 'No se pudo descargar el registro.', true);
    const columns = ['timestamp', 'channel', 'direction', 'callsign', 'morse', 'text', 'wpm', 'mode', 'toneFrequency', 'toneWaveform', 'keyDurationMs'];
    const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const content = format === 'csv'
      ? [columns.join(','), ...answer.entries.map(entry => columns.map(column => quote(entry[column])).join(','))].join('\n')
      : formatTextLog(answer.entries, channel);
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([content], { type: format === 'csv' ? 'text/csv' : 'text/plain' })); link.download = `${safeFilename(channel)}-${safeFilename(callsign)}-log.${format}`; link.click(); URL.revokeObjectURL(link.href);
  });
}
function render({ channels }) {
  latestInstructorState = { channels };
  $('#roomDirectory').replaceChildren(...(channels.length ? channels.map(room => {
    const li = document.createElement('li'); const link = document.createElement('a'); link.href = `#room-${room.channel}`; link.textContent = room.channel;
    const detail = document.createElement('span'); detail.textContent = `${room.operators.length} operador${room.operators.length === 1 ? '' : 'es'}`;
    li.append(link, detail); return li;
  }) : [Object.assign(document.createElement('li'), { className: 'muted', textContent: 'No hay canales' })]));
  const root = $('#rooms'); root.replaceChildren();
  for (const room of channels) {
    const card = document.createElement('section'); card.className = 'panel instructor-room'; card.id = `room-${room.channel}`;
    const title = document.createElement('h2'); title.textContent = `${room.channel} · ${room.operators.length} operador(es)`; card.append(title);
    const flags = document.createElement('p'); flags.className = 'room-flags'; flags.textContent = [room.policy.locked && 'BLOQUEADO', room.policy.receiveOnly && 'SOLO RECEPCIÓN', room.transmitter && `TX: ${room.transmitter}`].filter(Boolean).join(' · ') || 'CANAL LIBRE'; card.append(flags);
    const policies = document.createElement('div'); policies.className = 'admin-grid'; policies.append(button(txChannel === room.channel ? 'TX seleccionado' : 'Transmitir aquí', () => selectTxChannel(room.channel)), button(room.policy.locked ? 'Permitir ingresos' : 'Bloquear ingresos', () => action(room.channel, 'lock', !room.policy.locked)), button(room.policy.receiveOnly ? 'Permitir transmisión' : 'Solo recepción', () => action(room.channel, 'receiveOnly', !room.policy.receiveOnly)), button('Liberar TX', () => action(room.channel, 'clear')), button('Canal TXT', () => downloadLog(room.channel, '', 'canal', 'txt')), button('Canal CSV', () => downloadLog(room.channel, '', 'canal')), button('Cerrar canal', () => confirm(`¿Cerrar ${room.channel}?`) && action(room.channel, 'close'), true)); card.append(policies);
    const settings = document.createElement('div'); settings.className = 'admin-grid'; settings.innerHTML = `<label>PPM<input class="policy-wpm" type="number" min="5" max="60" value="${room.policy.mandatoryWpm}"></label><label>Tono (Hz)<input class="policy-tone" type="number" min="300" max="1200" step="10" value="${room.policy.toneFrequency}"></label><label>Forma de onda<select class="policy-waveform"><option value="sine">Senoidal</option><option value="triangle">Triangular</option><option value="square">Cuadrada</option></select></label><label>Modo del manipulador<select class="policy-mode"><option value="">Elección del estudiante</option><option value="iambic-a">Iámbico A</option><option value="iambic-b">Iámbico B</option><option value="straight">Llave vertical</option></select></label>`;
    settings.querySelector('.policy-mode').value = room.policy.mandatoryMode || ''; settings.querySelector('.policy-waveform').value = room.policy.toneWaveform;
    settings.querySelector('.policy-wpm').onchange = event => action(room.channel, 'wpm', event.target.value); settings.querySelector('.policy-tone').onchange = event => action(room.channel, 'tone', event.target.value); settings.querySelector('.policy-waveform').onchange = event => action(room.channel, 'waveform', event.target.value); settings.querySelector('.policy-mode').onchange = event => action(room.channel, 'mode', event.target.value); card.append(settings);
    const decoders = document.createElement('div'); decoders.className = 'decoder-switches';
    for (const [name, label, checked] of [['decodeText', 'Mostrar texto decodificado', room.policy.decodeText], ['decodeCode', 'Mostrar código .-', room.policy.decodeCode]]) { const control = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked; input.onchange = () => action(room.channel, name, input.checked); control.append(input, label); decoders.append(control); } card.append(decoders);
    const exercise = document.createElement('label'); exercise.textContent = 'Ejercicio / texto de práctica'; const area = document.createElement('textarea'); area.maxLength = 500; area.value = room.policy.exercise || ''; exercise.append(area, button('Enviar ejercicio', () => action(room.channel, 'exercise', area.value))); card.append(exercise);
    const list = document.createElement('div'); list.className = 'operator-admin';
    for (const op of room.operators) { const row = document.createElement('div'); const last = op.lastTransmitAt ? new Date(op.lastTransmitAt).toLocaleTimeString() : 'nunca'; row.innerHTML = `<span><b>${op.callsign}</b><small>${op.keyDowns} pulsaciones · última ${last}</small></span>`; if (room.policy.decodeText || room.policy.decodeCode) { const view = decoderView(room.channel, op); const decoded = document.createElement('div'); decoded.className = 'instructor-decode decode-message'; if (room.policy.decodeText) { const text = document.createElement('strong'); text.textContent = view.text || '…'; decoded.append(text); } if (room.policy.decodeCode) { const code = document.createElement('code'); code.textContent = view.code || '…'; decoded.append(code); } row.append(decoded); } const clear = button('Limpiar vista', () => clearDecoder(room.channel, op)); clear.classList.add('clear-decoder'); clear.title = 'Limpia solo esta vista; no modifica los registros TXT/CSV'; row.append(clear, button(`Decodificador ${op.decoderEnabled ? 'ACTIVO' : 'INACTIVO'}`, () => action(room.channel, 'studentDecoder', !op.decoderEnabled, op.id)), button('TXT', () => downloadLog(room.channel, op.id, op.callsign, 'txt')), button('CSV', () => downloadLog(room.channel, op.id, op.callsign)), button(op.muted ? 'Activar audio' : 'Silenciar', () => action(room.channel, 'mute', !op.muted, op.id)), button(op.reserved ? 'Liberar TX' : 'Reservar TX', () => action(room.channel, 'reserve', null, op.reserved ? '' : op.id)), button('Desconectar', () => action(room.channel, 'disconnect', null, op.id), true)); list.append(row); }
    card.append(list); root.append(card);
  }
  if (!channels.length) root.textContent = 'No hay canales. Cree uno arriba.';
  const selectedRoom = channels.find(room => room.channel === txChannel);
  if (txChannel && !selectedRoom) {
    txJoined = false; txChannel = ''; txAllowed = false; txKeyer.releaseAll(); txAudio.keyUp();
    $('#txChannel').textContent = 'Ninguno'; $('#txState').textContent = 'Seleccione “Transmitir aquí” en un canal.';
  } else applyTxState(selectedRoom);
}
$('#loginForm').onsubmit = async event => { event.preventDefault(); try { await monitorAudio.unlock(); } catch { status('No se pudo activar el audio del monitor.', true); } socket.emit('instructor:login', { pin: $('#pin').value, callsign: $('#instructorCallsign').value }, answer => { if (!answer?.ok) return status(answer?.reason, true); authenticated = true; $('#loginPanel').hidden = true; $('#desk').hidden = false; render(answer); }); };
$('#createForm').onsubmit = event => { event.preventDefault(); const input = $('#newChannel'); action(input.value, 'create', null, '', answer => { if (answer?.ok) { status(`Canal ${input.value.toUpperCase()} creado.`); input.value = ''; } }); };
socket.on('instructor:state', state => { if (authenticated) render(state); });
socket.on('instructor:cw', ({ channel, down, at, durationMs, senderId }) => {
  if (!authenticated) return;
  if (senderId === socket.id) return;
  const room = latestInstructorState?.channels.find(item => item.channel === channel);
  if (room) {
    monitorAudio.setFrequency(room.policy.toneFrequency);
    monitorAudio.setWaveform(room.policy.toneWaveform);
  }
  monitorAudioQueue = monitorAudioQueue
    .catch(() => {})
    .then(() => monitorAudio.scheduleRemoteKey(down, at, durationMs));
});
$('#txMode').addEventListener('input', () => txKeyer.configure($('#txMode').value, txWpm));
const paddleFor = event => event.code === 'ControlLeft' ? 'dit' : event.code === 'ControlRight' ? 'dah' : null;
window.addEventListener('keydown', event => {
  const paddle = paddleFor(event);
  if (!paddle || event.repeat || !authenticated || !txJoined) return;
  event.preventDefault();
  txKeyer.setPaddle(paddle, true);
  $(`#tx${paddle === 'dit' ? 'Dit' : 'Dah'}Lamp`).classList.add('active');
});
window.addEventListener('keyup', event => {
  const paddle = paddleFor(event);
  if (!paddle) return;
  event.preventDefault();
  txKeyer.setPaddle(paddle, false);
  $(`#tx${paddle === 'dit' ? 'Dit' : 'Dah'}Lamp`).classList.remove('active');
});
window.addEventListener('blur', () => { txKeyer.releaseAll(); document.querySelectorAll('.instructor-tx .paddle').forEach(element => element.classList.remove('active')); });
socket.on('disconnect', () => { authenticated = false; txJoined = false; txChannel = ''; txAllowed = false; latestInstructorState = null; decoderViews.clear(); txKeyer.releaseAll(); txAudio.keyUp(); monitorAudio.keyUp(); $('#desk').hidden = true; $('#loginPanel').hidden = false; status('Desconectado. Ingrese nuevamente después de la reconexión.', true); });
