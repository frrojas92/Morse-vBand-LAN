'use strict';

const clients = new Map();

function normalize(value, fallback, maxLength) {
  const cleaned = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9/_-]/g, '');
  return (cleaned || fallback).slice(0, maxLength);
}

function add(socketId, callsign, channel) {
  const client = {
    id: socketId,
    callsign: normalize(callsign, 'GUEST', 16),
    channel: normalize(channel, 'LOBBY', 24)
  };
  clients.set(socketId, client);
  return client;
}

function get(socketId) { return clients.get(socketId); }
function remove(socketId) { const client = get(socketId); clients.delete(socketId); return client; }

module.exports = { add, get, remove };
