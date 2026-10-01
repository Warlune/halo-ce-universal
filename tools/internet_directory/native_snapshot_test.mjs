// Run prepare, compile the generated C using the documented command, then check.
// This isolates the real getter body; it does not compile the full p2p.c unit.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('../../', import.meta.url);
const output = new URL('build/snapshot-contract/', root);
if (process.argv[2] === 'prepare') {
  const source = await readFile(new URL('port/linux/src/p2p.c', root), 'utf8');
  const block = source.match(/\/\* Keep the public copy's size[\s\S]*?(?=\/\* ---------- UPnP)/)?.[0];
  assert.ok(block && block.includes('int p2p_get_host_snapshot('), 'Production function marker changed; inspect before updating test extraction');
  const fixture = await readFile(new URL('./native_snapshot_fixture.c', import.meta.url), 'utf8');
  await mkdir(output, { recursive: true });
  await writeFile(new URL('snapshot.c', output), fixture.replace('/* PRODUCTION_SNAPSHOT_FUNCTION */', block));
  console.log('Generated fixture with unchanged production snapshot getter and production headers.');
} else if (process.argv[2] === 'check') {
  const bytes = await readFile(new URL('snapshot.wasm', output));
  const { instance } = await WebAssembly.instantiate(bytes);
  assert.equal(instance.exports.run_snapshot_tests(), 0, 'Snapshot contract failed (result identifies fixture case)');
  console.log('PASS: compiled C snapshot contract, counts 0–128, opt-in, lifecycle gates, cleared output, copied invite and balanced mock locks.');
  console.log('WebAssembly fixture only; no Windows game build, real mutex concurrency, game clients or network test.');
} else {
  throw new Error('Usage: node tools/internet_directory/native_snapshot_test.mjs prepare|check');
}
