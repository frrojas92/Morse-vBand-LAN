function morseUnits(code) {
  const symbols = String(code || '');
  return [...symbols].reduce((total, symbol) => total + (symbol === '-' ? 3 : 1), 0) + Math.max(0, symbols.length - 1);
}

function startsNewWord(previous, current) {
  if (!previous) return false;
  const ditMs = 1200 / Math.max(5, Number(current.wpm) || 15);
  const currentStart = Date.parse(current.timestamp) - (morseUnits(current.morse) + 2) * ditMs;
  return currentStart - Date.parse(previous.timestamp) >= 3 * ditMs;
}

function sameTransmission(block, entry) {
  return block && block.callsign === entry.callsign && block.direction === entry.direction &&
    block.wpm === entry.wpm && block.mode === entry.mode &&
    block.toneFrequency === entry.toneFrequency && block.toneWaveform === entry.toneWaveform;
}

export function formatTextLog(entries, channel) {
  const blocks = [];
  let previous = null;
  for (const entry of entries) {
    let block = blocks.at(-1);
    if (!sameTransmission(block, entry)) {
      block = { ...entry, startedAt: entry.timestamp, endedAt: entry.timestamp, text: '', codes: [] };
      blocks.push(block);
      previous = null;
    }
    if (startsNewWord(previous, entry)) {
      if (block.text && !block.text.endsWith(' ')) block.text += ' ';
      if (block.codes.length && block.codes.at(-1) !== '/') block.codes.push('/');
    }
    block.text += entry.text || '?';
    block.codes.push(entry.morse || '?');
    block.endedAt = entry.timestamp;
    previous = entry;
  }

  const lines = [
    'Morse-vBand LAN — Registro legible',
    `Canal: ${channel || entries[0]?.channel || '—'}`,
    `Generado: ${new Date().toISOString()}`,
    ''
  ];
  if (!blocks.length) return [...lines, 'No hay mensajes registrados.'].join('\n');

  blocks.forEach((block, index) => {
    if (index) lines.push('');
    lines.push(`[${block.direction}] ${block.callsign} · ${block.startedAt}`);
    lines.push(`Texto: ${block.text || '—'}`);
    lines.push(`Morse: ${block.codes.join(' ') || '—'}`);
    lines.push(`Configuración: ${block.wpm} PPM · ${block.mode} · ${block.toneFrequency} Hz · ${block.toneWaveform}`);
  });
  return lines.join('\n');
}
