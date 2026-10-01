// Bounded local HTTP directory exercise, NOT a Halo player or P2P simulator.
import { randomUUID, randomBytes } from 'node:crypto';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { createDirectory } from './server.mjs';
import { HostRegistration } from './host.mjs';
import { browse, resolveJoin } from './browser.mjs';

const deadline = performance.now() + 30000;
const guard = setTimeout(() => { console.error('Simulation exceeded 30 seconds'); process.exitCode = 1; process.exit(); }, 30000);
const credentials = new Map(Array.from({ length: 128 }, () => [randomUUID(), randomBytes(32).toString('hex')]));
const directory = await createDirectory({ hosts: credentials, rateLimit: 10000 });
const versions = { systemLinkVersion: 2, netcodeVersion: 9 };
const fetcher = (url, options) => fetch(`${directory.origin}${url}`, { ...options, signal: AbortSignal.timeout(3000) });
const hosts = [...credentials].map(([id, key]) => new HostRegistration({ directory: directory.origin, id, key }));
const fixture = { public: true, online: true, name: 'Synthetic fixture', map: 'bloodgulch',
  players: 1, maxPlayers: 128, build: 'simulation', ...versions, state: 'lobby', invite: `halo://join/${'0'.repeat(64)}` };
async function bounded(items, operation) {
  for (let i = 0; i < items.length; i += 16) {
    if (performance.now() > deadline || process.memoryUsage().rss > 512 * 1024 * 1024) throw new Error('Resource guard exceeded');
    await Promise.all(items.slice(i, i + 16).map(operation));
  }
}
console.log('DIRECTORY HTTP ONLY: up to 16 concurrent requests; no Halo, P2P, game assets or WAN traffic.');
try {
  for (const count of [16, 32, 64, 128]) {
    const active = hosts.slice(0, count);
    const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
    const start = performance.now(), cpu = process.cpuUsage();
    await bounded(active, host => host.update(fixture));
    assert.equal((await browse(fetcher, versions)).length, count);
    await bounded(active, async host => {
      // Independent simulated browser actions, each selecting one listing.
      assert.equal((await browse(fetcher, versions)).length, count);
      await resolveJoin(fetcher, host.id, versions);
    });
    await bounded(active, host => host.update({ ...fixture, players: 16, state: 'playing' }));
    await bounded(active, host => host.update({ public: false }));
    assert.equal((await browse(fetcher, versions)).length, 0);
    lag.disable();
    const used = process.cpuUsage(cpu);
    console.log(JSON.stringify({ simulatedHostsAndBrowsers: count, elapsedMs: Math.round(performance.now() - start),
      processCpuMs: Math.round((used.user + used.system) / 1000),
      rssMiBAtStageEnd: Math.round(process.memoryUsage().rss / 1048576),
      directoryEventLoopP95Ms: Math.round(lag.percentile(95) / 1e6), result: 'PASS' }));
  }
} finally { clearTimeout(guard); await directory.close(); }
