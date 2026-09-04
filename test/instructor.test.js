'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

const port = 18081;
const url = `http://127.0.0.1:${port}`;
const emit = (socket, event, payload) => new Promise(resolve => socket.emit(event, payload, resolve));
const connected = socket => new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function nextState(socket, predicate, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('instructor:state', onState);
      reject(new Error('Timed out waiting for instructor state.'));
    }, timeout);
    function onState(state) {
      if (!predicate(state)) return;
      clearTimeout(timer);
      socket.off('instructor:state', onState);
      resolve(state);
    }
    socket.on('instructor:state', onState);
  });
}

function nextEvent(socket, event, predicate, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, onEvent); reject(new Error(`Timed out waiting for ${event}.`)); }, timeout);
    function onEvent(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer); socket.off(event, onEvent); resolve(payload);
    }
    socket.on(event, onEvent);
  });
}

async function actionAndState(socket, payload, predicate) {
  const statePromise = nextState(socket, predicate);
  const answer = await emit(socket, 'instructor:action', payload);
  assert.equal(answer.ok, true);
  return statePromise;
}

test('instructor policies are enforced server-side', async t => {
  const server = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, PORT: String(port), INSTRUCTOR_PIN: 'test-pin' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let stderr = '';
    server.stderr.on('data', data => { stderr += data; });
    server.stdout.on('data', data => String(data).includes('listening') && resolve());
    server.once('exit', code => reject(new Error(`server exited ${code}: ${stderr.trim()}`)));
  });
  t.after(() => server.kill('SIGTERM'));
  const instructor = io(url), studentA = io(url), studentB = io(url);
  t.after(() => { instructor.close(); studentA.close(); studentB.close(); });
  await Promise.all([connected(instructor), connected(studentA), connected(studentB)]);
  assert.equal((await emit(instructor, 'instructor:login', { pin: 'wrong' })).ok, false);
  assert.equal((await emit(instructor, 'instructor:login', { pin: 'test-pin' })).ok, true);
  assert.equal((await emit(instructor, 'instructor:action', { action: 'create', channel: 'CLASS' })).ok, true);
  const a = await emit(studentA, 'room:join', { callsign: 'A1AA', channel: 'CLASS' });
  const b = await emit(studentB, 'room:join', { callsign: 'B2BB', channel: 'CLASS' });
  assert.ok(a.ok && b.ok);
  assert.deepEqual(a.state.instructors.map(item => item.callsign), ['INSTRUCTOR']);
  let decoderState = await actionAndState(
    instructor,
    { action: 'studentDecoder', channel: 'CLASS', target: a.client.id, value: false },
    value => value.channels.find(room => room.channel === 'CLASS')?.operators.find(operator => operator.id === a.client.id)?.decoderEnabled === false
  );
  const decoderOperators = decoderState.channels.find(room => room.channel === 'CLASS').operators;
  assert.equal(decoderOperators.find(operator => operator.id === a.client.id).decoderEnabled, false);
  assert.equal(decoderOperators.find(operator => operator.id === b.client.id).decoderEnabled, true);
  await emit(instructor, 'instructor:action', { action: 'studentDecoder', channel: 'CLASS', target: a.client.id, value: true });
  await emit(instructor, 'instructor:action', { action: 'receiveOnly', channel: 'CLASS', value: true });
  assert.match((await emit(studentA, 'cw:key', { down: true, wpm: 20 })).reason, /recepción/);
  await emit(instructor, 'instructor:action', { action: 'receiveOnly', channel: 'CLASS', value: false });
  await emit(instructor, 'instructor:action', { action: 'reserve', channel: 'CLASS', target: a.client.id });
  assert.match((await emit(studentB, 'cw:key', { down: true, wpm: 20 })).reason, /reservado/);
  await emit(instructor, 'instructor:action', { action: 'mute', channel: 'CLASS', target: a.client.id, value: true });
  assert.match((await emit(studentA, 'cw:key', { down: true, wpm: 20 })).reason, /silenció/);

  let state = await actionAndState(
    instructor,
    { action: 'tone', channel: 'CLASS', value: 5000 },
    value => value.channels.find(room => room.channel === 'CLASS')?.policy.toneFrequency === 1200
  );
  let policy = state.channels.find(room => room.channel === 'CLASS').policy;
  assert.equal(policy.toneFrequency, 1200, 'tone frequency is clamped to the supported range');

  state = await actionAndState(
    instructor,
    { action: 'waveform', channel: 'CLASS', value: 'sawtooth' },
    value => value.channels.find(room => room.channel === 'CLASS')?.policy.toneWaveform === 'sine'
  );
  policy = state.channels.find(room => room.channel === 'CLASS').policy;
  assert.equal(policy.toneWaveform, 'sine', 'unsupported waveforms fall back to sine');

  state = await actionAndState(
    instructor,
    { action: 'mode', channel: 'CLASS', value: 'straight' },
    value => value.channels.find(room => room.channel === 'CLASS')?.policy.mandatoryMode === 'straight'
  );
  policy = state.channels.find(room => room.channel === 'CLASS').policy;
  assert.equal(policy.mandatoryMode, 'straight');

  await emit(instructor, 'instructor:action', { action: 'mute', channel: 'CLASS', target: a.client.id, value: false });
  await emit(instructor, 'instructor:action', { action: 'reserve', channel: 'CLASS', target: '' });
  await emit(instructor, 'instructor:action', { action: 'wpm', channel: 'CLASS', value: 60 });
  const remoteElement = nextEvent(studentB, 'cw:key', event => !event.down);
  const instructorKeyDown = nextEvent(instructor, 'instructor:cw', event => event.down);
  assert.equal((await emit(studentA, 'cw:key', { down: true })).ok, true);
  assert.equal((await instructorKeyDown).channel, 'CLASS', 'instructors receive channel-labelled CW audio events');
  await delay(10);
  const decoded = nextState(instructor, value => value.channels
    .find(room => room.channel === 'CLASS')?.operators
    .find(operator => operator.id === a.client.id)?.text === 'E');
  const instructorElement = nextEvent(instructor, 'instructor:cw', event => !event.down);
  assert.equal((await emit(studentA, 'cw:key', { down: false })).ok, true);
  assert.ok((await remoteElement).durationMs > 0, 'receivers get the measured element duration');
  assert.ok((await instructorElement).durationMs > 0, 'instructors get the measured element duration');
  state = await decoded;
  const operator = state.channels.find(room => room.channel === 'CLASS').operators.find(item => item.id === a.client.id);
  assert.equal(operator.code, '.');
  assert.equal(operator.text, 'E');
  assert.equal(operator.codeCursor, 1);
  assert.equal(operator.textCursor, 1);

  await delay(110);
  const afterWord = await emit(instructor, 'instructor:action', { action: 'lock', channel: 'CLASS', value: false });
  assert.equal(afterWord.ok, true);
  const nextPreview = nextState(instructor, value => {
    const item = value.channels.find(room => room.channel === 'CLASS')?.operators.find(entry => entry.id === a.client.id);
    return item?.code.endsWith('.') && item.codeCursor > 4 ? item : false;
  });
  assert.equal((await emit(studentA, 'cw:key', { down: true })).ok, true);
  await delay(10);
  assert.equal((await emit(studentA, 'cw:key', { down: false })).ok, true);
  const previewOperator = (await nextPreview).channels.find(room => room.channel === 'CLASS').operators.find(item => item.id === a.client.id);
  assert.equal(previewOperator.code, '. / .');
  assert.equal(previewOperator.codeCursor, 5, 'the live preview cursor remains monotonic after a word separator');

  const roomLog = await emit(studentA, 'logs:get', { channel: 'CLASS' });
  assert.equal(roomLog.ok, true);
  assert.deepEqual(roomLog.entries.at(-1), {
    timestamp: roomLog.entries.at(-1).timestamp, channel: 'CLASS', direction: 'TX', callsign: 'A1AA',
    morse: '.', text: 'E', wpm: 60, mode: 'straight', toneFrequency: 1200,
    toneWaveform: 'sine', keyDurationMs: roomLog.entries.at(-1).keyDurationMs
  });
  const operatorLog = await emit(studentB, 'logs:get', { channel: 'CLASS', target: a.client.id });
  assert.equal(operatorLog.ok, true, 'room members can download each operator log');
  assert.equal(operatorLog.entries.at(-1).callsign, 'A1AA');

  assert.match((await emit(studentB, 'instructor:tx:join', { channel: 'CLASS' })).reason, /instructor/);
  const instructorTx = await emit(instructor, 'instructor:tx:join', { channel: 'CLASS' });
  assert.equal(instructorTx.ok, true);
  assert.equal(instructorTx.client.callsign, 'INSTRUCTOR');
  await delay(100);
  const studentReceivesInstructor = nextEvent(studentA, 'cw:key', event => event.senderId === instructor.id && !event.down);
  assert.equal((await emit(instructor, 'cw:key', { down: true })).ok, true);
  await delay(10);
  assert.equal((await emit(instructor, 'cw:key', { down: false })).ok, true);
  assert.ok((await studentReceivesInstructor).durationMs > 0, 'students receive instructor CW elements');
  await delay(50);
  const instructorLog = await emit(instructor, 'logs:get', { channel: 'CLASS', target: instructor.id });
  assert.equal(instructorLog.ok, true);
  assert.equal(instructorLog.entries.at(-1).callsign, 'INSTRUCTOR');
  assert.equal(instructorLog.entries.at(-1).direction, 'TX');
  assert.match((await emit(instructor, 'instructor:action', { action: 'create', channel: 'CLASS' })).reason, /ya existe/);

  assert.equal((await emit(instructor, 'instructor:action', { action: 'close', channel: 'CLASS' })).ok, true);
});
