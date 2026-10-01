// Direct-invite compatibility under directory failures. Tokens are extracted
// ONLY from stdout logs of these disposable owned fixtures, never a user's
// game/log/clipboard. Production registration still uses synchronized native
// snapshots. No token is printed, persisted separately or sent off-machine.
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { openSync, closeSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createDirectory } from './server.mjs';
import { createLocalSignalFixture } from './local_signal_fixture.mjs';
import { browse } from './browser.mjs';
import { OwnedSupervisor } from './supervisor.mjs';
import { prepareNativeFixture, ResourceGuard } from './native_fixture.mjs';

const hostFixture = await prepareNativeFixture('invite-host', '127.0.0.230');
const clientFixture = await prepareNativeFixture('invite-client', '127.0.0.231');
const reports = [];
let allOwnedStopped = true;
try {
 for (const mode of ['disabled', 'unavailable', 'malformed', 'expired']) {
  const resources = new ResourceGuard(); await delay(1000);
  const baseline = resources.sample(); assert.ok(baseline.cpu < 70 && baseline.freeGiB >= 8, 'Not enough baseline headroom');
  const id = randomUUID(), key = randomBytes(32).toString('hex');
  const directory = await createDirectory({ hosts: new Map([[id, key]]), ttlMs: mode === 'expired' ? 3000 : 45000 });
  const signalling = await createLocalSignalFixture();
  let requests = 0;
  const mock = http.createServer({ maxHeaderSize: 8192 }, (req, res) => {
    requests++; req.resume();
    if (mode === 'unavailable') res.destroy();
    else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{invalid-json'); }
  });
  mock.requestTimeout = 3000; mock.timeout = 3000; mock.maxConnections = 8;
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  const mockOrigin = `http://127.0.0.1:${mock.address().port}`;
  const supervisors = [], outputs = [];
  const hostLog = join(hostFixture.runtime, `${mode}.local.log`), clientLog = join(clientFixture.runtime, `${mode}.local.log`);
  const began = performance.now(); let selectedInvite, iterations = 0;
  const current = async () => (await (await fetch(`${directory.origin}/v1/listings?systemLinkVersion=2&netcodeVersion=9`)).json()).listings;
  const poll = async predicate => {
    while (performance.now() - began < 40000) {
      if (await predicate()) return;
      await delay(1000); resources.sample();
      if (++iterations % 5 === 0) await resources.ownedProcesses(supervisors);
      if (supervisors.some(s => !s.child)) throw new Error('Owned regression game exited unexpectedly');
    }
    throw new Error('Direct-invite regression timed out');
  };
  try {
    const hostEnv = { ...hostFixture.env, HALO_NET_BROKERS: signalling.address,
      HALO_DIRECTORY_URL: mode === 'expired' ? directory.origin : mockOrigin,
      HALO_DIRECTORY_ID: id, HALO_DIRECTORY_KEY: key, HALO_DIRECTORY_NAME: 'Disposable direct invite test' };
    if (mode !== 'disabled') hostEnv.HALO_DIRECTORY_PUBLIC = '1';
    const hostOutput = openSync(hostLog, 'w'); outputs.push(hostOutput);
    const host = new OwnedSupervisor({ file: hostFixture.file, cwd: hostFixture.runtime, env: hostEnv,
      output: hostOutput, maxRestarts: 0, maxLifetimeMs: 45000 });
    supervisors.push(host); await host.start();
    await poll(async () => { selectedInvite = (await readFile(hostLog, 'utf8')).match(/halo:\/\/join\/[0-9a-f]{64}/)?.[0]; return !!selectedInvite; });
    if (mode === 'expired') {
      await poll(async () => (await current()).length === 1);
      await poll(async () => (await current()).length === 0);
      assert.equal((await fetch(`${directory.origin}/v1/listings/${id}/join?systemLinkVersion=2&netcodeVersion=9`)).status, 404);
    } else if (mode === 'malformed') {
      await assert.rejects(browse((path, options) => fetch(mockOrigin + path, options), { systemLinkVersion: 2, netcodeVersion: 9 }));
    }
    const clientOutput = openSync(clientLog, 'w'); outputs.push(clientOutput);
    const client = new OwnedSupervisor({ file: clientFixture.file, args: [selectedInvite], cwd: clientFixture.runtime,
      env: { ...clientFixture.env, HALO_NETWORK_TEST: 'join', HALO_NET_BROKERS: signalling.address },
      output: clientOutput, maxRestarts: 0, maxLifetimeMs: 45000 });
    supervisors.push(client); await client.start(); selectedInvite = undefined;
    await poll(async () => {
      const logs = await Promise.all([readFile(hostLog, 'utf8'), readFile(clientLog, 'utf8')]);
      return logs.every(log => (log.match(/network test: tick /g) || []).length >= 3) &&
        logs[0].includes('Internet play: connected to player ') && logs[1].includes('Internet play: connected to host ');
    });
    if (mode === 'disabled') {
      assert.equal(requests, 0, 'Directory-disabled private host must not contact the directory');
      assert.equal((await current()).length, 0);
    } else if (mode !== 'expired') assert.ok(requests > 0, 'Configured directory failure must actually be exercised');
    const result = { passed: true, mode, directEncryptedMatch: true, ordinaryLanDiscoveryDisabled: true,
      privateUnlisted: mode === 'disabled', directoryRequests: requests, runtimeMs: Math.round(performance.now() - began), resources: resources.summary() };
    reports.push(result); console.log(JSON.stringify(result));
  } finally {
    const stops = await Promise.allSettled(supervisors.map(s => s.stop()));
    allOwnedStopped &&= stops.every(s => s.status === 'fulfilled');
    for (const output of outputs) closeSync(output);
    resources.close(); await directory.close(); await signalling.close();
    await new Promise(resolve => { mock.close(resolve); mock.closeAllConnections(); });
    assert.ok(stops.every(s => s.status === 'fulfilled' && !s.value.forced), 'Direct-invite fixtures must stop gracefully');
  }
 }
 await writeFile(join(hostFixture.runtime, 'invite-results.local.json'), JSON.stringify(reports, null, 2));
} finally {
  if (allOwnedStopped) { await hostFixture.release(); await clientFixture.release(); }
}
