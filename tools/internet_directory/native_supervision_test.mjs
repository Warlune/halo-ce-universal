import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { openSync, closeSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createDirectory } from './server.mjs';
import { OwnedSupervisor } from './supervisor.mjs';
import { prepareNativeFixture, ResourceGuard } from './native_fixture.mjs';

const fixture = await prepareNativeFixture('supervision', '127.0.0.210');
const logPath = join(fixture.runtime, 'supervision.local.log'), output = openSync(logPath, 'w');
const id = randomUUID(), key = randomBytes(32).toString('hex');
const directory = await createDirectory({ hosts: new Map([[id, key]]) });
Object.assign(fixture.env, { HALO_DIRECTORY_PUBLIC: '1', HALO_DIRECTORY_URL: directory.origin,
  HALO_DIRECTORY_ID: id, HALO_DIRECTORY_KEY: key, HALO_DIRECTORY_NAME: 'Disposable supervision test' });
const versions = '?systemLinkVersion=2&netcodeVersion=9', resources = new ResourceGuard();
const supervisors = [], events = [];
let samples = 0;
const began = performance.now();
const spawnHost = async (maxRestarts, privateHost = false) => {
  const s = new OwnedSupervisor({ file: fixture.file, cwd: fixture.runtime, output,
    env: { ...fixture.env, HALO_DIRECTORY_PUBLIC: privateHost ? '0' : '1' }, maxRestarts, maxLifetimeMs: 90000 });
  s.on('state', ({ pid, ...event }) => events.push(event));
  supervisors.push(s); await s.start(); return s;
};
const listings = async () => {
  const response = await fetch(`${directory.origin}/v1/listings${versions}`, { signal: AbortSignal.timeout(2500) });
  assert.equal(response.status, 200); return (await response.json()).listings;
};
const invite = async () => {
  const response = await fetch(`${directory.origin}/v1/listings/${id}/join${versions}`);
  assert.equal(response.status, 200); return (await response.json()).invite;
};
async function until(predicate, maximumMs = 15000) {
  const deadline = performance.now() + maximumMs;
  while (performance.now() < deadline) {
    if (await predicate()) return;
    await delay(1000); resources.sample();
    if (++samples % 5 === 0) await resources.ownedProcesses(supervisors);
  }
  throw new Error('Native supervision acceptance timed out');
}
try {
  const first = await spawnHost(1);
  await until(async () => (await listings()).length === 1);
  const initialInvite = await invite();
  first.child.stdin.write('not-stop\n'); await delay(1500);
  assert.ok(first.child && first.child.exitCode === null, 'Unknown control command must not stop a host');
  first.crashForTest();
  await until(async () => first.attempts === 2 && (await listings()).length === 1 && await invite() !== initialInvite);
  const replacementInvite = await invite();
  assert.equal((await listings())[0].id, id);
  assert.deepEqual(events.filter(e => e.kind === 'backoff').map(e => e.milliseconds), [500]);
  first.crashForTest(); await first.completion;
  assert.equal(first.attempts, 2, 'Restart budget must be exhausted');
  assert.equal((await listings()).length, 1, 'Abrupt death must exercise lease expiry, not graceful withdrawal');
  const crashAt = performance.now();
  console.log(JSON.stringify({ checkpoint: 'owned crash/restart budget verified; waiting for real 45-second lease expiry' }));
  await until(async () => (await listings()).length === 0, 50000);
  const expiryAfterCrashMs = Math.round(performance.now() - crashAt);
  assert.ok(expiryAfterCrashMs >= 35000 && expiryAfterCrashMs <= 50000);
  assert.equal((await fetch(`${directory.origin}/v1/listings/${id}/join${versions}`)).status, 404);
  const third = await spawnHost(0);
  await until(async () => (await listings()).length === 1);
  assert.equal((await listings())[0].id, id);
  assert.ok(await invite() !== replacementInvite, 'Manual restart must use a fresh session invite');
  assert.deepEqual(await third.stop(), { forced: false });
  assert.equal((await listings()).length, 0, 'Safe stop must withdraw immediately');
  const fourth = await spawnHost(0, true);
  await delay(3000); resources.sample();
  assert.equal((await listings()).length, 0, 'Private replacement must remain absent');
  assert.deepEqual(await fourth.stop({ eof: true }), { forced: false });
  const log = await readFile(logPath, 'utf8');
  assert.equal((log.match(/Host control: graceful shutdown requested/g) || []).length, 2);
  const report = { passed: true, automaticRestartAttempts: first.attempts, expiryAfterCrashMs,
    stableListing: true, freshInvites: true, explicitStop: true, ownerPipeEofStop: true,
    privateReplacementAbsent: true, runtimeMs: Math.round(performance.now() - began), resources: resources.summary() };
  await writeFile(join(fixture.runtime, 'supervision-results.local.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  const stops = await Promise.allSettled(supervisors.map(s => s.stop()));
  closeSync(output); resources.close(); await directory.close();
  // Retain the conservative lock if any owned process could still be alive.
  if (stops.every(s => s.status === 'fulfilled')) await fixture.release();
  assert.ok(stops.every(s => s.status === 'fulfilled'), 'Owned supervision fixture did not stop');
}
