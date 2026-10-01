import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { instance } = await WebAssembly.instantiate(await readFile(new URL('../../build/lobby-tests/roster.wasm', import.meta.url)));
assert.equal(instance.exports.run_roster_tests(), 0, 'Production roster model assertion failed (value is C test line)');
console.log(JSON.stringify({ passed: true, assertions: instance.exports.roster_test_checks(),
  scope: 'Compiled production display model; no game processes, assets or networking' }));
