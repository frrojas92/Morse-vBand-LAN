import { CwAudio } from './cw-audio.js';
import { CwKeyer } from './cw-keyer.js';

const socket = io();
const localAudio = new CwAudio();
const remoteAudio = new CwAudio();
const $ = (selector) => document.querySelector(selector);
let joined = false;
let clientId = null;
let transmissionAllowed = true;
let currentWpm = 20;

const keyer = new CwKeyer(async (down) => {
  if (down && !transmissionAllowed) return setStatus('Transmission disabled by instructor.', 'error');
  if (down) await localAudio.keyDown(); else localAudio.keyUp();
  if (joined) socket.emit('cw:key', { down }, (answer) => {
    if (!answer?.ok) { localAudio.keyUp(); setStatus(answer?.reason || 'Transmission rejected.', 'error'); }
  });
});

function setStatus(message, kind = '') { $('#status').textContent = message; $('#status').className = kind; }
function configure() {
  keyer.configure($('#mode').value, currentWpm);
}

function renderDecoders(state) {
  const enabled = state.policy.decodeText || state.policy.decodeCode;
  $('#decoderPanel').hidden = !enabled;
  if (!enabled) return;
  $('#decoders').replaceChildren(...state.operators.map(operator => {
    const row = document.createElement('article'); row.className = 'decode-row';
    const heading = document.createElement('h3'); heading.textContent = `${operator.id === clientId ? 'TX' : 'RX'} · ${operator.callsign}`; row.append(heading);
    if (state.policy.decodeText) { const text = document.createElement('p'); text.className = 'decoded-text'; text.textContent = operator.text || '…'; row.append(text); }
    if (state.policy.decodeCode) { const code = document.createElement('code'); code.textContent = operator.code || '…'; row.append(code); }
    return row;
  }));
}

function applyState(state) {
  $('#operators').replaceChildren(...state.operators.map(operator => {
    const li = document.createElement('li'); li.textContent = operator.callsign; return li;
  }));
  $('#transmitter').textContent = state.transmitter || 'Channel clear';
  $('#transmitter').classList.toggle('busy', Boolean(state.transmitter));
  const me = state.operators.find(operator => operator.id === clientId);
  transmissionAllowed = !state.policy.receiveOnly && !me?.muted && (!state.policy.reservedFor || state.policy.reservedFor === clientId);
  currentWpm = state.policy.mandatoryWpm;
  $('#wpmValue').textContent = currentWpm;
  $('#frequencyValue').textContent = state.policy.toneFrequency;
  $('#waveformValue').textContent = state.policy.toneWaveform;
  localAudio.setFrequency(state.policy.toneFrequency); remoteAudio.setFrequency(state.policy.toneFrequency);
  localAudio.setWaveform(state.policy.toneWaveform); remoteAudio.setWaveform(state.policy.toneWaveform);
  if (state.policy.mandatoryMode) { $('#mode').value = state.policy.mandatoryMode; $('#mode').disabled = true; } else $('#mode').disabled = false;
  configure(); renderDecoders(state);
  $('#exercise').textContent = state.policy.exercise || 'No exercise assigned.';
  $('#exercisePanel').hidden = !state.policy.exercise;
  if (!transmissionAllowed) { keyer.releaseAll(); localAudio.keyUp(); }
}

$('#joinForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  await localAudio.unlock(); await remoteAudio.unlock();
  socket.emit('room:join', { callsign: $('#callsign').value, channel: $('#channel').value }, (answer) => {
    joined = Boolean(answer?.ok);
    if (joined) { clientId = answer.client.id; $('#station').disabled = true; setStatus(`Connected to ${answer.client.channel}`, 'ok'); applyState(answer.state); }
    else setStatus(answer?.reason || 'Unable to join channel.', 'error');
  });
});

$('#mode').addEventListener('input', configure);
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
socket.on('cw:key', ({ down }) => down ? remoteAudio.keyDown() : remoteAudio.keyUp());
socket.on('room:closed', () => { joined = false; clientId = null; keyer.releaseAll(); localAudio.keyUp(); remoteAudio.keyUp(); $('#station').disabled = false; setStatus('The instructor closed this channel.', 'error'); });
socket.on('disconnect', () => { joined = false; remoteAudio.keyUp(); $('#station').disabled = false; setStatus('Disconnected. Rejoin when the server is available.', 'error'); });
