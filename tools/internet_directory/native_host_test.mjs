// Runs only an explicitly prepared, ignored Windows development fixture.
// Never invokes the system URI handler or uses the live game's config/saves.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, stat, mkdir, cp, copyFile } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createDirectory } from './server.mjs';
import { INVITE } from './protocol.mjs';
import { resolveJoin } from './browser.mjs';
import { createLocalSignalFixture } from './local_signal_fixture.mjs';

assert.equal(process.platform, 'win32', 'This fixture currently supports Windows only');
const mode = process.argv[2] || 'public';
assert.ok(['public', 'private', 'match', 'tunnel', 'restart'].includes(mode), 'Use public, private, match, tunnel or restart');
const isPublic = mode !== 'private';
const hasClient = mode === 'match' || mode === 'tunnel';
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const runtime = join(root, 'build', 'directory-game-test');
assert.equal(await readFile(join(runtime, '.isolated-directory-test'), 'utf8'), 'local native directory fixture');
const binary = join(runtime, 'halo.exe');
const digest = data => createHash('sha256').update(data).digest('hex');
assert.equal(digest(await readFile(binary)), digest(await readFile(join(root, 'build/windows/halo.exe'))),
  'Runtime must contain an exact copy of the current development build');
assert.ok((await stat(join(runtime, 'data/maps/bloodgulch.map'))).isFile());
const id = randomUUID(), key = randomBytes(32).toString('hex');
const versions = '?systemLinkVersion=2&netcodeVersion=9';
const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('HALO_')));
Object.assign(environment, {
  HALO_DATA_ROOT: join(runtime, 'data'), HALO_SAVE_ROOT: join(runtime, 'saves'),
  LOCALAPPDATA: join(runtime, 'local'), APPDATA: join(runtime, 'roaming'), USERPROFILE: join(runtime, 'profile'),
  HALO_NET_ADDRESS: '127.0.0.200', HALO_NET_BROADCAST: '127.0.0.201', HALO_NET_ONLINE: 'true',
  HALO_NET_BROKERS: '', HALO_NET_STUN: '', HALO_NET_ALLOW_UPNP: 'false',
  HALO_NET_JOIN_FROM_CLIPBOARD: 'false', HALO_DISCORD_APPLICATION: '', HALO_UPDATE_AUTO: 'false',
  HALO_HIDDEN_WINDOW: '1', HALO_NO_AUDIO: '1',
  HALO_NETWORK_TEST: 'host:bloodgulch', HALO_NETWORK_TEST_START: '15',
  HALO_EXIT_AFTER: isPublic ? '45' : '12',
  HALO_DIRECTORY_PUBLIC: '1',
  HALO_DIRECTORY_ID: id, HALO_DIRECTORY_KEY: key, HALO_DIRECTORY_NAME: 'Isolated native test'
});
if (!isPublic) delete environment.HALO_DIRECTORY_PUBLIC; // Exercise default-off.
if (mode === 'restart') {
  environment.HALO_NULL_RENDERER = '1';
  environment.HALO_EXIT_AFTER = '30';
}
const clientRuntime = join(runtime, 'client');
if (hasClient) {
  for (const path of ['data', 'saves', 'profile', 'local', 'roaming']) await mkdir(join(clientRuntime, path), { recursive: true });
  await cp(join(runtime, 'data/maps'), join(clientRuntime, 'data/maps'), { recursive: true, force: false });
  for (const file of ['halo.exe', 'SDL3.dll']) await copyFile(join(runtime, file), join(clientRuntime, file));
}
// Logs contain the upstream invite and stay under ignored build/, never stdout.
const logPath = join(runtime, `${mode}.local.log`);
const log = openSync(logPath, 'w');
const directory = await createDirectory({ hosts: new Map([[id, key]]) });
environment.HALO_DIRECTORY_URL = directory.origin;
const signalling = mode === 'tunnel' ? await createLocalSignalFixture() : null;
if (signalling) {
  environment.HALO_NET_BROKERS = signalling.address;
  // Neither game sends LAN discovery to the other's address. A successful
  // match therefore requires the selected invite's P2P discovery transport.
  environment.HALO_NET_BROADCAST = '127.0.0.250';
}
let child, guard, failure, exitResult, resolved = false;
let client, clientExited, clientLog;
let maximumObservedPlayers = 0;
const seenStates = new Set();
const seenMaps = new Set();
let firstExpiry = 0, lastExpiry = 0, firstSeenMs = null;
let previousMetadata, heartbeatRenewals = 0;
let previousInvite;
const began = performance.now();
try {
 for (let cycle = 1; cycle <= (mode === 'restart' ? 2 : 1); cycle++) {
  exitResult = undefined; resolved = false; firstExpiry = 0; lastExpiry = 0; firstSeenMs = null;
  previousMetadata = undefined; heartbeatRenewals = 0; maximumObservedPlayers = 0;
  seenStates.clear(); seenMaps.clear();
  child = spawn(binary, [], { cwd: runtime, env: environment, windowsHide: true, stdio: ['ignore', log, log] });
  const exited = new Promise(resolveExit => {
    child.once('error', () => { exitResult = { launchFailed: true }; resolveExit(); });
    child.once('exit', (code, signal) => { exitResult = { code, signal }; resolveExit(); });
  });
  guard = setTimeout(() => { failure = new Error('Isolated game exceeded the 65-second runtime guard'); child.kill(); }, 65000);
  while (!exitResult) {
    const response = await fetch(`${directory.origin}/v1/listings${versions}`, { signal: AbortSignal.timeout(2500) });
    assert.equal(response.status, 200);
    const { listings } = await response.json();
    if (mode === 'private') assert.equal(listings.length, 0, 'Private host must remain absent');
    if (listings.length) {
      assert.equal(listings.length, 1);
      const listing = listings[0];
      assert.equal(listing.id, id);
      // Upstream first creates its default lobby, then the harness changes map.
      assert.ok(['carousel', 'bloodgulch'].includes(listing.map));
      assert.ok(Number.isInteger(listing.players) && listing.players >= 0 && listing.players <= (hasClient ? 2 : 1));
      maximumObservedPlayers = Math.max(maximumObservedPlayers, listing.players);
      if (listing.state === 'playing') {
        assert.equal(listing.map, 'bloodgulch');
        assert.ok(listing.players >= 1);
      }
      assert.equal(listing.maxPlayers, 128);
      assert.ok(!Object.hasOwn(listing, 'invite'), 'Browse must not expose invites');
      seenStates.add(listing.state);
      seenMaps.add(listing.map);
      const { expiresAt, ...metadata } = listing;
      const serialized = JSON.stringify(metadata);
      if (previousMetadata === serialized && lastExpiry && expiresAt > lastExpiry) heartbeatRenewals++;
      previousMetadata = serialized;
      firstExpiry ||= listing.expiresAt;
      lastExpiry = listing.expiresAt;
      firstSeenMs ??= Math.round(performance.now() - began);
      if (!resolved) {
        if (signalling) assert.equal(signalling.stats().publishes, 0, 'Browsing must not initiate encrypted signalling');
        const selected = await resolveJoin((path, options) => fetch(directory.origin + path, options), id,
          { systemLinkVersion: 2, netcodeVersion: 9 });
        assert.ok(INVITE.test(selected.invite), 'Selected real host must resolve a valid invite');
        if (mode === 'restart') {
          assert.ok(!previousInvite || previousInvite !== selected.invite, 'Restart must replace the previous process invite');
          previousInvite = selected.invite;
        }
        resolved = true; // Resolution alone never opens a URI or connects a peer.
        if (hasClient) {
          const clientEnv = { ...environment, HALO_NET_ADDRESS: '127.0.0.201', HALO_NET_BROADCAST: '127.0.0.200',
            HALO_NET_ONLINE: 'false', HALO_NETWORK_TEST: 'join', HALO_EXIT_AFTER: '40', HALO_DIRECTORY_PUBLIC: '0',
            HALO_DATA_ROOT: join(clientRuntime, 'data'), HALO_SAVE_ROOT: join(clientRuntime, 'saves'),
            LOCALAPPDATA: join(clientRuntime, 'local'), APPDATA: join(clientRuntime, 'roaming'), USERPROFILE: join(clientRuntime, 'profile') };
          delete clientEnv.HALO_DIRECTORY_KEY;
          if (signalling) {
            clientEnv.HALO_NET_ONLINE = 'true';
            clientEnv.HALO_NET_BROADCAST = '127.0.0.250';
          }
          clientLog = openSync(join(clientRuntime, 'match.local.log'), 'w');
          client = spawn(join(clientRuntime, 'halo.exe'), signalling ? [selected.invite] : [], { cwd: clientRuntime, env: clientEnv,
            windowsHide: true, stdio: ['ignore', clientLog, clientLog] });
          client.once('error', () => { clientExited = { launchFailed: true }; });
          client.once('exit', (code, signal) => { clientExited = { code, signal }; });
        }
      }
    }
    await Promise.race([delay(1000), exited]);
  }
  await exited;
  if (failure) throw failure;
  assert.equal(exitResult.code, 0, 'Game must exit normally; inspect ignored local log for diagnostics');
  const transcript = await readFile(logPath, 'utf8');
  assert.ok(transcript.includes('exiting after debug.exit_after'), 'Timed native shutdown must run');
  assert.ok(!transcript.includes('the invite link is on the clipboard'), 'Automated host must leave clipboard alone');
  if (!signalling) assert.ok(!transcript.includes('Internet play: reaching '), 'Browsing must not create P2P peers');
  const after = await (await fetch(`${directory.origin}/v1/listings${versions}`)).json();
  assert.equal(after.listings.length, 0, 'Graceful shutdown must withdraw before the lease expires');
  if (isPublic) {
    assert.ok(resolved, 'Actual native host was never registered');
    if (hasClient) {
      assert.equal(maximumObservedPlayers, 2, 'Second real client must join');
      assert.ok(seenStates.has('playing'), 'Actual host must reach in-game state');
      assert.equal(clientExited?.code, 0, 'Isolated client must finish normally');
      const clientTranscript = await readFile(join(clientRuntime, 'match.local.log'), 'utf8');
      assert.ok(/network test:.*player [01]:/.test(clientTranscript), 'Client must simulate the loaded match');
      assert.ok(/network test:.*player [01]:/.test(transcript), 'Host must simulate the loaded match');
      if (signalling) {
        assert.ok(clientTranscript.includes('Internet play: connected to host '), 'Client must establish authenticated encrypted tunnel');
        assert.ok(transcript.includes('Internet play: connected to player '), 'Host must establish authenticated encrypted tunnel');
        assert.ok(!clientTranscript.includes('passed the invite to'), 'Test invite must stay in the intended isolated process');
        assert.ok(signalling.stats().forwarded >= 3, 'Actual sealed join/accept/proof exchange must pass local signalling');
        assert.equal(signalling.stats().rejected, 0, 'Native signalling must fit the bounded fixture protocol');
      }
    }
    assert.ok(lastExpiry - firstExpiry >= 14000, 'A later native heartbeat must renew the lease');
    assert.ok(heartbeatRenewals > 0, 'Unchanged native metadata must receive a periodic heartbeat');
    assert.ok(lastExpiry > Date.now(), 'Removal must occur before crash-expiry fallback');
  } else {
    assert.ok(!transcript.includes('Directory:'), 'Private mode must not start the registration worker');
    assert.ok(transcript.includes('Internet play: hosting.'), 'Private case must still exercise a real online host');
  }
  console.log(JSON.stringify({ passed: true, mode, cycle, stableListingAcrossRestart: mode === 'restart' && cycle === 2,
    firstSeenMs, states: [...seenStates], maps: [...seenMaps],
    heartbeatRenewalMs: lastExpiry - firstExpiry, heartbeatRenewals, selectedInviteResolved: resolved,
    gracefulWithdrawal: isPublic, gameExitCode: exitResult.code, maximumObservedPlayers,
    runtimeMs: Math.round(performance.now() - began), additionalGameClients: client ? 1 : 0,
    encryptedTunnelTested: !!signalling, signalling: signalling?.stats() }));
  clearTimeout(guard);
 }
} finally {
  clearTimeout(guard);
  if (child && !exitResult) child.kill(); // Only the exact process spawned here.
  if (client && !clientExited) client.kill();
  closeSync(log);
  if (clientLog !== undefined) closeSync(clientLog);
  await directory.close();
  if (signalling) await signalling.close();
}
