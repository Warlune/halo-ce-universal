// Bounded local qualification. Protocol stand-ins are never active players.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createDirectory } from './server.mjs';
import { OwnedSupervisor } from './supervisor.mjs';
import { prepareNativeFixture, ResourceGuard, repository } from './native_fixture.mjs';
import { ProcessProfile } from './process_profile.mjs';

const mode = process.argv[2], count = Number(process.argv[3]);
const profiling = process.argv[4] === 'profile', processProfile = new ProcessProfile();
assert.ok((mode === 'active' && [2, 4].includes(count)) || (mode === 'protocol' && [2, 16, 32, 64, 128].includes(count)), 'Use active 2/4 or protocol 2/16/32/64/128');
const resources = new ResourceGuard();
await delay(1000); const baseline = resources.sample();
assert.ok(baseline.cpu < 70 && baseline.freeGiB >= 8, 'Baseline headroom insufficient; do not launch load');
const fixtures = [], supervisors = [], outputs = [], logs = [], observations = [];
const id = randomUUID(), key = randomBytes(32).toString('hex');
const directory = await createDirectory({ hosts: new Map([[id, key]]) });
let bots, botExited, failure, peakPlayers = 0, playingAt = null, iterations = 0;
const began = performance.now();
const startDelay = mode === 'active' ? 15 : Math.max(15, Math.ceil(count / 8) + 10);

function parse(line, atMs) {
  const tick = line.match(/network test: tick (\d+)(.*?) \| items/);
  if (!tick) return null;
  const players = [];
  for (const match of tick[2].matchAll(/ player (\d+): (.*?)(?= player \d+:|$)/g)) {
    const position = match[2].match(/^\(([-\d.]+) ([-\d.]+) ([-\d.]+)\)/);
    const score = match[2].match(/ k(\d+) d(\d+)/), throttle = match[2].match(/ thr([\d.]+)/);
    players.push({ index: Number(match[1]), position: position ? position.slice(1).map(Number) : null,
      kills: Number(score?.[1] || 0), deaths: Number(score?.[2] || 0), throttle: Number(throttle?.[1] || 0) });
  }
  const network = line.match(/sent (\d+) received (\d+) corrected (\d+)/);
  const hits = line.match(/hits (\d+) dealt (\d+) rejected (\d+) replayed (\d+)/);
  return { tick: Number(tick[1]), atMs, players, local: Number(line.match(/\| local (-?\d+)/)?.[1]),
    network: network ? network.slice(1).map(Number) : [], hits: hits ? hits.slice(1).map(Number) : [] };
}
async function harvest() {
  for (let index = 0; index < logs.length; index++) {
    if ((await stat(logs[index])).size > 8 * 2 ** 20) throw new Error('Native log size budget exceeded');
    const text = await readFile(logs[index], 'utf8'), seen = observations[index].lines;
    const lines = text.split('\n'); observations[index].lines = lines.length - 1;
    for (const line of lines.slice(seen, -1)) {
      const atMs = performance.now() - began, value = parse(line, atMs);
      if (value) observations[index].ticks.push(value);
      if (line.includes('host profile:')) {
        const fields = Object.fromEntries([...line.matchAll(/(seconds|frames|ticks|frame_ms|render_ms|idle_ms|tick_ms|max_tick_ms) ([\d.]+)/g)].map(m => [m[1], Number(m[2])]));
        observations[index].profiles.push({ atMs, ...fields });
      }
    }
  }
}
function summarizeTicks(ticks) {
  const first = ticks[0], last = ticks.at(-1), local = last?.local;
  return { reports: ticks.length, firstTick: first?.tick, lastTick: last?.tick,
    observedTickRate: ticks.length > 1 ? +((last.tick - first.tick) * 1000 / (last.atMs - first.atMs)).toFixed(2) : null,
    distinctLocalPositions: new Set(ticks.map(t => t.players.find(p => p.index === local)?.position?.join(',')).filter(Boolean)).size,
    movingReports: ticks.filter(t => t.players.some(p => p.index === local && p.throttle > 0.1)).length,
    highestDeaths: Math.max(0, ...ticks.flatMap(t => t.players.map(p => p.deaths))),
    finalPlayerKillsDeaths: last?.players.map(p => ({ index: p.index, kills: p.kills, deaths: p.deaths })),
    finalNetworkSentReceivedCorrections: last?.network, finalHitsDealtRejectedReplayed: last?.hits };
}
try {
  const realCount = mode === 'active' ? count : 1;
  for (let index = 0; index < realCount; index++) {
    const fixture = await prepareNativeFixture(`${profiling ? 'profile-' : ''}${mode}-${count}-${index}`, `127.0.0.${220 + index}`);
    fixtures.push(fixture);
    Object.assign(fixture.env, { HALO_NETWORK_TEST: index ? 'join' : 'host:bloodgulch',
      HALO_NET_ONLINE: index ? 'false' : 'true', HALO_NETWORK_TEST_START: String(startDelay),
      HALO_NET_BROADCAST: index ? '127.0.0.220' : Array.from({ length: Math.max(1, realCount - 1) }, (_, i) => `127.0.0.${221 + i}`).join(',') });
    if (!index) Object.assign(fixture.env, { HALO_DIRECTORY_PUBLIC: '1', HALO_DIRECTORY_URL: directory.origin,
      HALO_DIRECTORY_ID: id, HALO_DIRECTORY_KEY: key, HALO_DIRECTORY_NAME: 'Bounded local load test' });
    if (mode === 'active') Object.assign(fixture.env, { HALO_TEST_INPUT: `bot:${101 + index * 101}`,
      HALO_NETWORK_TEST_SHOOT: '4', HALO_NETWORK_TEST_KILL: index ? '0' : '10' });
    if (profiling) fixture.env.HALO_HOST_PROFILE = '1';
    const log = join(fixture.runtime, 'load.local.log'), output = openSync(log, 'w');
    logs.push(log); outputs.push(output); observations.push({ lines: 0, ticks: [], profiles: [] });
    const s = new OwnedSupervisor({ file: fixture.file, cwd: fixture.runtime, env: fixture.env, output,
      maxRestarts: 0, maxLifetimeMs: 110000 });
    supervisors.push(s); await s.start();
    await delay(1000); resources.sample();
    if (mode === 'active' && index === 0) {
      // The upstream forced-kill fixture assumes the host owns player slot 0.
      // Starting clients during host initialization can assign them that slot.
      const deadline = performance.now() + 12000;
      let ready = false;
      while (performance.now() < deadline) {
        const response = await fetch(`${directory.origin}/v1/listings?systemLinkVersion=2&netcodeVersion=9`, { signal: AbortSignal.timeout(2500) });
        assert.equal(response.status, 200);
        if ((await response.json()).listings.some(l => l.players === 1 && l.state === 'lobby')) { ready = true; break; }
        await delay(1000); resources.sample();
      }
      assert.ok(ready, 'Host must own its local player before clients start');
    }
  }
  if (mode === 'protocol') {
    const python = process.env.HALO_TEST_PYTHON;
    assert.ok(python, 'Set HALO_TEST_PYTHON to the existing approved Python executable');
    const botLog = openSync(join(fixtures[0].runtime, 'bots.local.log'), 'w'); outputs.push(botLog);
    bots = spawn(python, [join(repository, 'tools/system_link_bots.py'), '--host', '127.0.0.220',
      '--machines', String(count - 1), '--first-address', '127.0.1.2', '--join-rate', '8',
      '--seconds', '100', '--status-every', '2'], { cwd: repository, windowsHide: true, stdio: ['ignore', botLog, botLog] });
    bots.once('error', () => { botExited = { launchFailed: true }; });
    bots.once('exit', (code, signal) => { botExited = { code, signal }; });
  }
  while (performance.now() - began < 95000) {
    await delay(1000); resources.sample();
    if (++iterations % 5 === 0) await resources.ownedProcesses(bots ? [...supervisors, { child: bots }] : supervisors);
    if (profiling && iterations % 5 === 0) await processProfile.sample([
      ...supervisors.map((s, i) => ({ label: i ? `client-${i}` : 'host', child: s.child })),
      ...(bots ? [{ label: 'idle-standins', child: bots }] : [])
    ], playingAt ? 'playing' : 'startup');
    if (supervisors.some(s => !s.child) || botExited) throw new Error('An owned participant exited before qualification completed');
    const response = await fetch(`${directory.origin}/v1/listings?systemLinkVersion=2&netcodeVersion=9`, { signal: AbortSignal.timeout(2500) });
    assert.equal(response.status, 200);
    const listing = (await response.json()).listings[0];
    peakPlayers = Math.max(peakPlayers, listing?.players || 0);
    if (listing?.state === 'playing' && listing.players === count) playingAt ??= performance.now();
    await harvest();
    if (playingAt && listing?.players !== count) throw new Error('Participant count dropped during qualification');
    if (playingAt && performance.now() - playingAt >= (mode === 'active' ? 35000 : 30000)) break;
    if (!playingAt && performance.now() - began > startDelay * 1000 + 30000) throw new Error('Participants did not reach the expected match');
  }
  assert.equal(peakPlayers, count); assert.ok(playingAt, 'Host must reach expected playing population');
  await harvest();
  const summaries = observations.map(o => summarizeTicks(o.ticks));
  assert.ok(summaries.every(s => s.reports >= 10 && s.observedTickRate >= 24), 'Tick progress below qualification floor');
  if (profiling) for (const observation of observations) {
    const windows = observation.profiles.filter(p => p.atMs >= playingAt - began + 5000);
    assert.ok(windows.length >= 3, 'Profiling requires three steady-state windows');
    const seconds = windows.reduce((s, p) => s + p.seconds, 0);
    const ticks = windows.reduce((s, p) => s + p.ticks, 0);
    assert.ok(ticks / seconds >= 29 && ticks / seconds <= 31, 'Profiled simulation must remain at 30 Hz');
    assert.ok(windows.every(p => p.frames / p.seconds <= 65), 'Null-renderer presentation must stay paced');
  }
  if (mode === 'active') {
    assert.ok(summaries.every(s => s.distinctLocalPositions >= 5 && s.movingReports >= 5), 'Each real client must move actively');
    assert.ok(summaries[0].highestDeaths > 0, 'Controlled combat/death path must execute');
  }
} catch (error) { failure = error.message; }
finally {
  if (bots && !botExited) { bots.kill(); await new Promise(resolve => bots.once('exit', resolve)); }
  const stops = await Promise.allSettled(supervisors.map(s => s.stop()));
  if (stops.some(s => s.status !== 'fulfilled' || s.value.forced)) failure ||= 'Owned game required forced cleanup';
  for (const output of outputs) closeSync(output);
  await directory.close();
  resources.close();
  await Promise.allSettled(fixtures.map((f, index) => stops[index]?.status === 'fulfilled' ? f.release() : Promise.resolve()));
}
const gameSummaries = observations.map(o => summarizeTicks(o.ticks));
const deltas = [];
let comparedScores = 0, differingScores = 0;
if (mode === 'active' && observations.length >= 2) {
  const hostByTick = new Map(observations[0].ticks.map(t => [t.tick, t]));
  for (const { ticks } of observations.slice(1)) for (const tick of ticks) {
    const host = hostByTick.get(tick.tick); if (!host) continue;
    for (const player of tick.players) {
      const authoritative = host.players.find(p => p.index === player.index);
      if (authoritative) {
        comparedScores++;
        if (player.kills !== authoritative.kills || player.deaths !== authoritative.deaths) differingScores++;
      }
      if (player.position && authoritative?.position) deltas.push(Math.hypot(...player.position.map((v, i) => v - authoritative.position[i])));
    }
  }
}
deltas.sort((a, b) => a - b);
const report = { passed: !failure, failure, mode, expectedPlayers: count, peakPlayers, fullGameProcesses: mode === 'active' ? count : 1,
  scriptedActivePlayers: mode === 'active' ? count : 0,
  idleProtocolStandIns: mode === 'protocol' ? count - 1 : 0, runtimeMs: Math.round(performance.now() - began),
  resources: resources.summary(), gameSummaries, sampledSameTickPositionDelta: { samples: deltas.length,
    p95: deltas.length ? +deltas[Math.floor((deltas.length - 1) * 0.95)].toFixed(3) : null,
    max: deltas.length ? +deltas.at(-1).toFixed(3) : null },
  sampledSameTickScoreComparison: { compared: comparedScores, differing: differingScores }, encryptedTransport: false };
if (profiling) {
  report.processProfile = processProfile.summary(resources.samples);
  report.frameProfiles = observations.map(o => o.profiles.filter(p => playingAt && p.atMs >= playingAt - began + 5000));
}
if (fixtures.length) await writeFile(join(fixtures[0].runtime, 'load-results.local.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (failure) process.exitCode = 1;
