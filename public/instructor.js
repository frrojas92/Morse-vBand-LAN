const socket = io();
const $ = selector => document.querySelector(selector);
let authenticated = false;
function status(message, error = false) { $('#status').textContent = message; $('#status').className = error ? 'error' : 'ok'; }
function action(channel, name, value = null, target = '', callback = null) { socket.emit('instructor:action', { channel, action: name, value, target }, answer => { if (!answer?.ok) status(answer?.reason || 'Action failed.', true); callback?.(answer); }); }
function button(text, handler, danger = false) { const el = document.createElement('button'); el.type = 'button'; el.textContent = text; if (danger) el.className = 'danger'; el.onclick = handler; return el; }
function safeFilename(value) { return value.replace(/[^A-Z0-9_-]/gi, '_'); }
function downloadLog(channel, target = '', callsign = 'room') {
  socket.emit('logs:get', { channel, target }, answer => {
    if (!answer?.ok) return status(answer?.reason || 'Log download failed.', true);
    const columns = ['timestamp', 'channel', 'direction', 'callsign', 'morse', 'text', 'wpm', 'mode', 'toneFrequency', 'toneWaveform', 'keyDurationMs'];
    const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = [columns.join(','), ...answer.entries.map(entry => columns.map(column => quote(entry[column])).join(','))].join('\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = `${safeFilename(channel)}-${safeFilename(callsign)}-log.csv`; link.click(); URL.revokeObjectURL(link.href);
  });
}
function render({ channels }) {
  $('#roomDirectory').replaceChildren(...(channels.length ? channels.map(room => {
    const li = document.createElement('li'); const link = document.createElement('a'); link.href = `#room-${room.channel}`; link.textContent = room.channel;
    const detail = document.createElement('span'); detail.textContent = `${room.operators.length} operator${room.operators.length === 1 ? '' : 's'}`;
    li.append(link, detail); return li;
  }) : [Object.assign(document.createElement('li'), { className: 'muted', textContent: 'No channels' })]));
  const root = $('#rooms'); root.replaceChildren();
  for (const room of channels) {
    const card = document.createElement('section'); card.className = 'panel instructor-room'; card.id = `room-${room.channel}`;
    const title = document.createElement('h2'); title.textContent = `${room.channel} · ${room.operators.length} operator(s)`; card.append(title);
    const flags = document.createElement('p'); flags.className = 'room-flags'; flags.textContent = [room.policy.locked && 'LOCKED', room.policy.receiveOnly && 'RECEIVE ONLY', room.transmitter && `TX: ${room.transmitter}`].filter(Boolean).join(' · ') || 'CHANNEL CLEAR'; card.append(flags);
    const policies = document.createElement('div'); policies.className = 'admin-grid'; policies.append(button(room.policy.locked ? 'Unlock joins' : 'Lock joins', () => action(room.channel, 'lock', !room.policy.locked)), button(room.policy.receiveOnly ? 'Enable transmitting' : 'Receive only', () => action(room.channel, 'receiveOnly', !room.policy.receiveOnly)), button('Release TX', () => action(room.channel, 'clear')), button('Download room log', () => downloadLog(room.channel)), button('Close channel', () => confirm(`Close ${room.channel}?`) && action(room.channel, 'close'), true)); card.append(policies);
    const settings = document.createElement('div'); settings.className = 'admin-grid'; settings.innerHTML = `<label>WPM<input class="policy-wpm" type="number" min="5" max="60" value="${room.policy.mandatoryWpm}"></label><label>Tone (Hz)<input class="policy-tone" type="number" min="300" max="1200" step="10" value="${room.policy.toneFrequency}"></label><label>Waveform<select class="policy-waveform"><option value="sine">Sine (clean)</option><option value="triangle">Triangle</option><option value="square">Square (sharp)</option></select></label><label>Keyer mode<select class="policy-mode"><option value="">Student choice</option><option value="iambic-a">Iambic A</option><option value="iambic-b">Iambic B</option><option value="straight">Straight key</option></select></label>`;
    settings.querySelector('.policy-mode').value = room.policy.mandatoryMode || ''; settings.querySelector('.policy-waveform').value = room.policy.toneWaveform;
    settings.querySelector('.policy-wpm').onchange = event => action(room.channel, 'wpm', event.target.value); settings.querySelector('.policy-tone').onchange = event => action(room.channel, 'tone', event.target.value); settings.querySelector('.policy-waveform').onchange = event => action(room.channel, 'waveform', event.target.value); settings.querySelector('.policy-mode').onchange = event => action(room.channel, 'mode', event.target.value); card.append(settings);
    const decoders = document.createElement('div'); decoders.className = 'decoder-switches';
    for (const [name, label, checked] of [['decodeText', 'Show decoded text', room.policy.decodeText], ['decodeCode', 'Show .- code', room.policy.decodeCode]]) { const control = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked; input.onchange = () => action(room.channel, name, input.checked); control.append(input, label); decoders.append(control); } card.append(decoders);
    const exercise = document.createElement('label'); exercise.textContent = 'Exercise / practice text'; const area = document.createElement('textarea'); area.maxLength = 500; area.value = room.policy.exercise || ''; exercise.append(area, button('Send exercise', () => action(room.channel, 'exercise', area.value))); card.append(exercise);
    const list = document.createElement('div'); list.className = 'operator-admin';
    for (const op of room.operators) { const row = document.createElement('div'); const last = op.lastTransmitAt ? new Date(op.lastTransmitAt).toLocaleTimeString() : 'never'; row.innerHTML = `<span><b>${op.callsign}</b><small>${op.keyDowns} key-downs · last ${last}</small></span>`; if (room.policy.decodeText || room.policy.decodeCode) { const decoded = document.createElement('div'); decoded.className = 'instructor-decode'; if (room.policy.decodeText) { const text = document.createElement('strong'); text.textContent = op.text || '…'; decoded.append(text); } if (room.policy.decodeCode) { const code = document.createElement('code'); code.textContent = op.code || '…'; decoded.append(code); } row.append(decoded); } row.append(button('Log', () => downloadLog(room.channel, op.id, op.callsign)), button(op.muted ? 'Unmute' : 'Mute', () => action(room.channel, 'mute', !op.muted, op.id)), button(op.reserved ? 'Release TX' : 'Reserve TX', () => action(room.channel, 'reserve', null, op.reserved ? '' : op.id)), button('Disconnect', () => action(room.channel, 'disconnect', null, op.id), true)); list.append(row); }
    card.append(list); root.append(card);
  }
  if (!channels.length) root.textContent = 'No channels. Create one above.';
}
$('#loginForm').onsubmit = event => { event.preventDefault(); socket.emit('instructor:login', { pin: $('#pin').value }, answer => { if (!answer?.ok) return status(answer?.reason, true); authenticated = true; $('#loginPanel').hidden = true; $('#desk').hidden = false; render(answer); }); };
$('#createForm').onsubmit = event => { event.preventDefault(); const input = $('#newChannel'); action(input.value, 'create', null, '', answer => { if (answer?.ok) { status(`Channel ${input.value.toUpperCase()} created.`); input.value = ''; } }); };
socket.on('instructor:state', state => { if (authenticated) render(state); });
socket.on('disconnect', () => { authenticated = false; $('#desk').hidden = true; $('#loginPanel').hidden = false; status('Disconnected. Log in again after reconnection.', true); });
