import { randomBytes, randomUUID } from 'node:crypto';
import { createDirectory } from './server.mjs';
import { HostRegistration } from './host.mjs';

if (process.argv.slice(2).some(arg => arg !== '--demo')) throw new Error('Usage: node tools/internet_directory/demo.mjs [--demo]');
const enabled = process.argv.includes('--demo');
const id = randomUUID();
const key = randomBytes(32).toString('hex');
const directory = await createDirectory({ hosts: enabled ? new Map([[id, key]]) : new Map() });
const host = new HostRegistration({ directory: directory.origin, id, key });
// Synthetic fixture only: never read game logs, clipboard, saves or config.
const snapshot = { public: true, online: true, name: 'SIMULATED host (not playable)',
  map: 'bloodgulch', players: 1, maxPlayers: 128, build: 'prototype-fixture',
  systemLinkVersion: 2, netcodeVersion: 9, state: 'lobby', invite: `halo://join/${'0'.repeat(64)}` };
let timer;
if (enabled) {
  await host.update(snapshot);
  timer = setInterval(() => host.update(snapshot).catch(() => console.error('Demo heartbeat failed')), 15000);
}
console.log(`Local directory: ${directory.origin}`);
console.log(enabled ? 'SIMULATED listing enabled; no game is running. Do not open the demo invite.' : 'No hosts registered. Use --demo for a synthetic listing.');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  try { await host.update({ public: false }); } finally { await directory.close(); }
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
