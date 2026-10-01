import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import http from 'node:http';
import { createDirectory } from './server.mjs';
import { HostRegistration } from './host.mjs';
import { browse, resolveJoin } from './browser.mjs';
import { directoryURL, validateListing } from './protocol.mjs';

const versions = { systemLinkVersion: 2, netcodeVersion: 9 };
const listing = (changes = {}) => ({ name: 'Test host', map: 'bloodgulch', players: 1,
  maxPlayers: 128, build: 'test-fixture', ...versions, state: 'lobby',
  invite: `halo://join/${'a'.repeat(64)}`, ...changes });
async function fixture(t, options = {}) {
  const id = randomUUID(), key = randomBytes(32).toString('hex');
  const directory = await createDirectory({ hosts: new Map([[id, key]]), ...options });
  t.after(() => directory.close());
  const fetcher = (url, init) => fetch(`${directory.origin}${url}`, init);
  const host = new HostRegistration({ directory: directory.origin, id, key });
  const publish = changes => host.update({ ...listing(changes), public: true, online: true });
  return { ...directory, id, key, host, fetcher, publish };
}

test('opt-in lifecycle: private, public lobby, playing, stopped, restarted invite', async t => {
  const f = await fixture(t);
  await f.host.update({ ...listing(), public: false, online: true });
  assert.deepEqual(await browse(f.fetcher, versions), []);
  await f.publish();
  const visible = await browse(f.fetcher, versions);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, f.id);
  assert.equal(visible[0].maxPlayers, 128);
  assert.equal('invite' in visible[0], false);
  assert.equal('deadline' in visible[0], false);
  await f.publish({ state: 'playing', players: 32 });
  assert.equal((await browse(f.fetcher, versions))[0].players, 32);
  await f.host.update({ public: true, online: true, state: 'stopped' });
  assert.deepEqual(await browse(f.fetcher, versions), []);
  await f.publish({ invite: `halo://join/${'b'.repeat(64)}` });
  assert.equal((await resolveJoin(f.fetcher, f.id, versions)).invite, listing({ invite: `halo://join/${'b'.repeat(64)}` }).invite);
  assert.equal((await browse(f.fetcher, versions))[0].id, f.id);
  await f.host.update({ public: true, online: false });
  assert.deepEqual(await browse(f.fetcher, versions), []);
});

test('heartbeats extend lease; crash expiry uses monotonic time', async t => {
  let clock = 0, wall = Date.now();
  const f = await fixture(t, { now: () => clock, wallNow: () => wall, ttlMs: 3000 });
  await f.publish();
  clock = 2500; await f.publish();
  clock = 4000; wall -= 60000;
  assert.equal((await browse(f.fetcher, versions)).length, 1);
  clock = 5500;
  assert.deepEqual(await browse(f.fetcher, versions), []);
  await assert.rejects(resolveJoin(f.fetcher, f.id, versions), /unavailable/);
});

test('browse never resolves invites; explicit join refetches latest invite', async t => {
  const f = await fixture(t);
  await f.publish();
  const calls = [];
  const tracked = (url, init) => { calls.push(url); return f.fetcher(url, init); };
  await browse(tracked, versions);
  assert.equal(calls.length, 1);
  assert.equal(calls.some(url => url.includes('/join')), false);
  await f.publish({ invite: `halo://join/${'c'.repeat(64)}` });
  const result = await resolveJoin(tracked, f.id, versions);
  assert.equal(result.invite, `halo://join/${'c'.repeat(64)}`);
  assert.equal(calls.filter(url => url.includes('/join')).length, 1);
});

test('System Link and netcode versions are independent; map and full-host filtering', async t => {
  const f = await fixture(t);
  await f.publish();
  for (const mismatch of [{ systemLinkVersion: 9, netcodeVersion: 9 }, { systemLinkVersion: 2, netcodeVersion: 2 }]) {
    assert.deepEqual(await browse(f.fetcher, mismatch), []);
    await assert.rejects(resolveJoin(f.fetcher, f.id, mismatch), /incompatible/);
  }
  assert.deepEqual(await browse(f.fetcher, { ...versions, map: 'sidewinder' }), []);
  await f.publish({ players: 128 });
  await assert.rejects(resolveJoin(f.fetcher, f.id, versions), /full/);
  const missing = await f.fetcher('/v1/listings?systemLinkVersion=2');
  assert.equal(missing.status, 400);
  const duplicate = await f.fetcher('/v1/listings?systemLinkVersion=2&netcodeVersion=9&netcodeVersion=8');
  assert.equal(duplicate.status, 400);
});

test('registration ownership prevents unauthenticated writes and takeover', async t => {
  const f = await fixture(t);
  await f.publish();
  for (const method of ['PUT', 'DELETE']) {
    const result = await f.fetcher(`/v1/listings/${f.id}`, { method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${'0'.repeat(64)}` },
      body: method === 'PUT' ? JSON.stringify(listing()) : undefined });
    assert.equal(result.status, 401);
  }
  const foreign = new HostRegistration({ directory: f.origin, id: randomUUID(), key: f.key });
  await assert.rejects(foreign.update({ ...listing(), public: true, online: true }), /401/);
  assert.equal((await browse(f.fetcher, versions)).length, 1);
});

test('validation rejects unknown personal fields, invalid invites and impossible counts', async t => {
  const f = await fixture(t);
  for (const invalid of [{ hardwareID: 'not-allowed' }, { players: 129 }, { maxPlayers: 129 },
    { players: -1 }, { players: 1.5 }, { invite: 'javascript:alert(1)' },
    { invite: `halo://join/${'a'.repeat(44)}` }, { name: 'line\nbreak' }, { map: '../maps/file' },
    { state: 'private' }]) {
    assert.throws(() => validateListing(listing(invalid)), /Invalid/);
    const response = await f.fetcher(`/v1/listings/${f.id}`, { method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${f.key}` },
      body: JSON.stringify(listing(invalid)) });
    assert.equal(response.status, 400);
  }
  await f.publish();
  await assert.rejects(f.publish({ invite: 'invalid' }), /Invalid/);
  assert.deepEqual(await browse(f.fetcher, versions), []);
});

test('request bounds, origin and DNS rebinding protections', async t => {
  const f = await fixture(t);
  const path = `/v1/listings/${f.id}`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${f.key}` };
  assert.equal((await f.fetcher(path, { method: 'PUT', headers, body: 'x'.repeat(4097) })).status, 413);
  assert.equal((await f.fetcher(path, { method: 'PUT', headers, body: '{' })).status, 400);
  assert.equal((await f.fetcher(path, { method: 'PUT', body: '{}' })).status, 401);
  assert.equal((await f.fetcher(path, { method: 'PUT', headers: { Authorization: `Bearer ${f.key}` }, body: '{}' })).status, 415);
  for (const extra of [{ Origin: 'https://untrusted.example' }, { Host: 'untrusted.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    // fetch deliberately rewrites Host; use raw HTTP to actually exercise it.
    const status = await new Promise((resolve, reject) => {
      http.get(f.origin, { headers: extra }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      }).on('error', reject);
    });
    assert.equal(status, 403, Object.keys(extra)[0]);
  }
  const response = await f.fetcher('/');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('bounded rate limit recovers and moderation removes visible and joinable listing', async t => {
  let clock = 0;
  const blockedIds = new Set();
  const f = await fixture(t, { rateLimit: 3, now: () => clock, blockedIds });
  await f.publish();
  await browse(f.fetcher, versions);
  await browse(f.fetcher, versions);
  assert.equal((await f.fetcher('/')).status, 429);
  clock = 60001;
  assert.equal((await f.fetcher('/')).status, 200);
  await f.publish();
  blockedIds.add(f.id);
  assert.deepEqual(await browse(f.fetcher, versions), []);
  clock += 60001;
  await assert.rejects(resolveJoin(f.fetcher, f.id, versions), /unavailable/);
  await assert.rejects(f.publish(), /403/);
});

test('directory capacity is bounded', async t => {
  const f = await fixture(t, { maxListings: 0 });
  await assert.rejects(f.publish(), /503/);
});

test('host transport requires HTTPS remotely and refuses redirects', async () => {
  for (const url of ['http://example.com', 'http://localhost', 'https://user:key@example.com',
    'https://example.com/path', 'https://example.com/?secret=value', 'file:///tmp/data']) {
    assert.throws(() => directoryURL(url));
  }
  assert.equal(directoryURL('https://directory.example'), 'https://directory.example');
  let init;
  const host = new HostRegistration({ directory: 'https://directory.example', id: randomUUID(),
    key: '0'.repeat(64), fetcher: async (url, options) => { init = options; return new Response('{}'); } });
  await host.update({ ...listing(), public: true, online: true });
  assert.equal(init.redirect, 'error');
  assert.ok(init.signal instanceof AbortSignal);
});

test('serialized withdrawal follows ambiguous/timed-out registration', async () => {
  const calls = [];
  let markStarted, failRequest;
  const started = new Promise(resolve => { markStarted = resolve; });
  const host = new HostRegistration({ directory: 'http://127.0.0.1:1234', id: randomUUID(), key: '0'.repeat(64),
    fetcher: async (url, options) => { calls.push(options.method); if (options.method === 'PUT') {
      markStarted(); return new Promise((resolve, reject) => { failRequest = reject; });
    } return new Response('{}'); } });
  const first = host.update({ ...listing(), public: true, online: true });
  const rejected = assert.rejects(first, /timeout/);
  await started;
  const second = host.update({ public: false });
  failRequest(new Error('timeout'));
  await rejected;
  await second;
  assert.deepEqual(calls, ['PUT', 'DELETE']);
});

test('queued opt-out suppresses obsolete registration before any request begins', async () => {
  const calls = [];
  const host = new HostRegistration({ directory: 'http://127.0.0.1:1234', id: randomUUID(), key: '0'.repeat(64),
    fetcher: async (url, options) => { calls.push(options.method); return new Response('{}'); } });
  await Promise.all([host.update({ ...listing(), public: true, online: true }), host.update({ public: false })]);
  assert.deepEqual(calls, []);
  for (const publicValue of [1, 'true', '1', null, undefined])
    await host.update({ ...listing(), public: publicValue, online: true });
  assert.deepEqual(calls, []);
});

test('registration rejects duplicate escaped keys, nested values and malformed UTF-8', async t => {
  const f = await fixture(t);
  const valid = JSON.stringify(listing());
  const payloads = [valid.replace('{', '{"name":"hidden",'),
    valid.replace('{', '{"na\\u006de":"hidden",'), valid.replace('"Test host"', '{}'),
    valid.replace('"players":1', '"players":01'), valid + ' false',
    Buffer.from([0x7b, 0xff, 0x7d])];
  for (const body of payloads) {
    const response = await f.fetcher(`/v1/listings/${f.id}`, { method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${f.key}` }, body });
    assert.equal(response.status, 400);
  }
  assert.deepEqual(await browse(f.fetcher, versions), []);
});

test('browser enforces response byte/count bounds, metadata types and expiry', async () => {
  const id = randomUUID(), time = Date.now();
  const { invite, ...metadata } = listing();
  const item = { ...metadata, id, expiresAt: time + 10000 };
  const response = listings => async () => new Response(JSON.stringify({ apiVersion: 1, listings }));
  for (const invalid of [{ ...item, players: -1 }, { ...item, name: {} }, { ...item, invite },
    { ...item, private: true }, { ...item, expiresAt: time + 300001 }, { ...item, expiresAt: 1.5 }])
    await assert.rejects(browse(response([invalid]), versions, () => time));
  await assert.rejects(browse(response([item, item]), versions));
  await assert.rejects(browse(response(Array(257).fill(item)), versions));
  assert.deepEqual(await browse(response([{ ...item, expiresAt: time }]), versions, () => time), []);
  await assert.rejects(browse(async () => new Response(' '.repeat(256 * 1024 + 1)), versions), /too large/);
  await assert.rejects(resolveJoin(async () => new Response(' '.repeat(1025)), id, versions), /too large/);
  await assert.rejects(resolveJoin(async () => new Response(JSON.stringify({ apiVersion: 1, invite, expiresAt: time + 300001 })), id, versions, () => time), /Invalid/);
  await assert.rejects(browse(response([]), { ...versions, netcodeVersion: '9' }), /Invalid/);
});

test('directory refuses invalid operator resource limits before listening', async () => {
  for (const options of [{ ttlMs: 0 }, { ttlMs: Infinity }, { ttlMs: 300001 },
    { rateLimit: -1 }, { maxListings: 257 }]) await assert.rejects(createDirectory(options), /Invalid/);
});

test('browser rejects unsupported, expired and non-Halo join responses', async () => {
  const id = randomUUID();
  for (const payload of [{ apiVersion: 2, invite: listing().invite, expiresAt: Date.now() + 10000 },
    { apiVersion: 1, invite: 'https://untrusted.example', expiresAt: Date.now() + 10000 },
    { apiVersion: 1, invite: listing().invite, expiresAt: 0 }]) {
    await assert.rejects(resolveJoin(async () => new Response(JSON.stringify(payload)), id, versions), /Invalid/);
  }
});
