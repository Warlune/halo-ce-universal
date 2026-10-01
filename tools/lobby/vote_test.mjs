import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { instance } = await WebAssembly.instantiate(await readFile(new URL('../../build/lobby-tests/vote.wasm', import.meta.url)));
assert.equal(instance.exports.run_vote_tests(), 0, 'Pure voting model assertion failed (value is C test line)');
console.log(JSON.stringify({ passed: true, assertions: instance.exports.vote_test_checks(),
  scope: 'Offline eligibility/state/ballot-codec model; no network or game callers' }));
