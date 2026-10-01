import test from 'node:test';
import assert from 'node:assert/strict';
import { OwnedSupervisor } from './supervisor.mjs';

const fixture = code => new OwnedSupervisor({ file: process.execPath, args: ['-e', code], env: process.env,
  backoffMs: 100, maxBackoffMs: 200, stopGraceMs: 500, maxLifetimeMs: 5000 });
const controlled = "process.stdin.on('data',b=>{if(b.toString().includes('stop'))process.exit(0)});process.stdin.on('end',()=>process.exit(0))";

test('owned supervisor stops gracefully without restart, including EOF', async () => {
  for (const eof of [false, true]) {
    const s = fixture(controlled); await s.start();
    assert.deepEqual(await s.stop({ eof }), { forced: false });
    assert.equal(s.attempts, 1);
  }
});
test('restart storm exhausts the explicit budget with bounded exponential backoff', async () => {
  const s = fixture('process.exit(7)'), backoffs = [];
  s.on('state', event => { if (event.kind === 'backoff') backoffs.push(event.milliseconds); });
  await s.start(); const result = await s.completion;
  assert.equal(result.attempts, 3); assert.equal(result.last.code, 7);
  assert.deepEqual(backoffs, [100, 200]);
});
test('stop cancels a pending restart instead of creating another process', async () => {
  const s = fixture('process.exit(7)');
  const backoff = new Promise(resolve => s.on('state', event => { if (event.kind === 'backoff') resolve(); }));
  await s.start(); await backoff; await s.stop(); assert.equal(s.attempts, 1);
});
test('unresponsive owned child is force-stopped only after the grace timeout', async () => {
  const s = fixture('setInterval(()=>{},1000)');
  await s.start(); const began = performance.now();
  assert.deepEqual(await s.stop(), { forced: true });
  assert.ok(performance.now() - began >= 450); assert.equal(s.attempts, 1);
});

test('lifetime limit gracefully stops a healthy owned child without restarting', async () => {
  const s = fixture(controlled);
  s.maxLifetimeMs = 1000;
  let expired = false;
  s.on('state', event => { if (event.kind === 'lifetime') expired = true; });
  await s.start(); await s.completion;
  assert.equal(expired, true); assert.equal(s.attempts, 1);
  assert.deepEqual(await s.stop(), { forced: false });
});
