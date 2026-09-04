import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const MORSE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.',
  H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.',
  O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-',
  V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
  5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.'
};

const exchanges = [
  ['INSTR', 'K1MED DE INSTR SEND 9 LINE K'],
  ['K1MED', 'INSTR DE K1MED ROGER'],
  ['INSTR', 'SEND L1 K'],
  ['K1MED', 'L1 AB12345678'],
  ['INSTR', 'R1 ROGER'],
  ['K1MED', 'L2 4650 K1MED'],
  ['INSTR', 'R2 ROGER'],
  ['K1MED', 'L3 A1 C1'],
  ['INSTR', 'R3 ROGER'],
  ['K1MED', 'L4 A'],
  ['INSTR', 'R4 ROGER'],
  ['K1MED', 'L5 L1 A1'],
  ['INSTR', 'R5 ROGER'],
  ['K1MED', 'L6 N'],
  ['INSTR', 'R6 ROGER'],
  ['K1MED', 'L7 C'],
  ['INSTR', 'R7 ROGER'],
  ['K1MED', 'L8 A2'],
  ['INSTR', 'R8 ROGER'],
  ['K1MED', 'L9 DUST'],
  ['INSTR', 'R9 ROGER CASEVAC RECEIVED K']
];

const wpm = 15;
const ditMs = 1200 / wpm;
const base = Date.parse('2026-09-04T15:30:00.000Z');
let cursor = base;
const entries = [];

function units(code) {
  return [...code].reduce((sum, symbol) => sum + (symbol === '-' ? 3 : 1), 0)
    + Math.max(0, code.length - 1);
}

for (const [callsign, message] of exchanges) {
  for (const word of message.split(' ')) {
    for (const character of word) {
      const morse = MORSE[character];
      cursor += (units(morse) + 3) * ditMs;
      entries.push({
        timestamp: new Date(cursor).toISOString(),
        channel: 'CASEVAC',
        direction: callsign === 'K1MED' ? 'TX' : 'RX',
        callsign,
        morse,
        text: character,
        wpm,
        mode: 'straight',
        toneFrequency: 600,
        toneWaveform: 'sine',
        keyDurationMs: Math.round(units(morse) * ditMs)
      });
    }
    cursor += 7 * ditMs;
  }
  cursor += 14 * ditMs;
}

const columns = ['timestamp', 'channel', 'direction', 'callsign', 'morse', 'text', 'wpm', 'mode', 'toneFrequency', 'toneWaveform', 'keyDurationMs'];
const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const csv = [columns.join(','), ...entries.map(entry => columns.map(column => quote(entry[column])).join(','))].join('\n');

const txtLines = [
  'Morse-vBand LAN — Registro legible',
  'Canal: CASEVAC',
  'Generado: 2026-09-04T15:45:00.000Z',
  ''
];
for (const [index, [callsign, message]] of exchanges.entries()) {
  const direction = callsign === 'K1MED' ? 'TX' : 'RX';
  const matching = entries.filter(entry => entry.callsign === callsign);
  const occurrence = exchanges.slice(0, index).filter(item => item[0] === callsign).length;
  const priorLength = exchanges.filter((item, itemIndex) => itemIndex < index && item[0] === callsign)
    .reduce((sum, item) => sum + item[1].replaceAll(' ', '').length, 0);
  const startedAt = matching[priorLength].timestamp;
  const code = message.split(' ').map(word => [...word].map(character => MORSE[character]).join(' ')).join(' / ');
  if (index) txtLines.push('');
  txtLines.push(`[${direction}] ${callsign} · ${startedAt}`);
  txtLines.push(`Texto: ${message}`);
  txtLines.push(`Morse: ${code}`);
  txtLines.push('Configuración: 15 PPM · straight · 600 Hz · sine');
  void occurrence;
}
txtLines.push('', 'Interacción TX/RX');
for (const [callsign, message] of exchanges) {
  const direction = callsign === 'K1MED' ? 'TX' : 'RX';
  txtLines.push(`[${direction}] ${callsign}: ${message}`);
}

const outputDir = resolve('casevac-example');
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, 'CASEVAC-K1MED-log.txt'), `${txtLines.join('\n')}\n`);
await writeFile(resolve(outputDir, 'CASEVAC-K1MED-log.csv'), `${csv}\n`);
