'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

const port = 18081;
const url = `http://127.0.0.1:${port}`;
const emit = (socket, event, payload) => new Promise(resolve => socket.emit(event, payload, resolve));
const connected = socket => new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });

test('instructor policies are enforced server-side', async t => {
  const server = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, PORT: String(port), INSTRUCTOR_PIN: 'test-pin' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { server.stdout.on('data', data => String(data).includes('listening') && resolve()); server.once('exit', code => reject(new Error(`server exited ${code}`))); });
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
  await emit(instructor, 'instructor:action', { action: 'receiveOnly', channel: 'CLASS', value: true });
  assert.match((await emit(studentA, 'cw:key', { down: true, wpm: 20 })).reason, /receive-only/);
  await emit(instructor, 'instructor:action', { action: 'receiveOnly', channel: 'CLASS', value: false });
  await emit(instructor, 'instructor:action', { action: 'reserve', channel: 'CLASS', target: a.client.id });
  assert.match((await emit(studentB, 'cw:key', { down: true, wpm: 20 })).reason, /reserved/);
  await emit(instructor, 'instructor:action', { action: 'mute', channel: 'CLASS', target: a.client.id, value: true });
  assert.match((await emit(studentA, 'cw:key', { down: true, wpm: 20 })).reason, /muted/);
  assert.equal((await emit(instructor, 'instructor:action', { action: 'close', channel: 'CLASS' })).ok, true);
});
