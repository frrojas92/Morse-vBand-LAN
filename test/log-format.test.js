'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');

async function loadFormatter() {
  const source = await readFile('public/log-format.js', 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('TXT logs retain details and end with a compact TX/RX interaction', async () => {
  const { formatTextLog } = await loadFormatter();
  const common = { channel: 'CLASS', wpm: 15, mode: 'straight', toneFrequency: 600, toneWaveform: 'sine' };
  const text = formatTextLog([
    { ...common, timestamp: '2026-09-04T15:30:00.000Z', direction: 'TX', callsign: 'STUDENT', morse: '.', text: 'E' },
    { ...common, timestamp: '2026-09-04T15:30:02.000Z', direction: 'RX', callsign: 'INSTR', morse: '-', text: 'T' }
  ], 'CLASS');

  assert.match(text, /Morse: \.\nConfiguración: 15 PPM/);
  assert.ok(text.endsWith('Interacción TX/RX\n[TX] STUDENT: E\n[RX] INSTR: T'));
});

test('empty TXT logs also end with an interaction section', async () => {
  const { formatTextLog } = await loadFormatter();
  const text = formatTextLog([], 'EMPTY');
  assert.ok(text.endsWith('Interacción TX/RX\nNo hay interacción registrada.'));
});
