import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { createLocalSignalFixture, packet } from './local_signal_fixture.mjs';

const text = value => { const data = Buffer.from(value); return Buffer.concat([Buffer.from([0, data.length]), data]); };
const connect = packet(0x10, Buffer.concat([text('MQTT'), Buffer.from([4, 2, 0, 60]), text('fixture')]));
async function setup(t) {
  const fixture = await createLocalSignalFixture();
  t.after(() => fixture.close());
  const socket = net.connect(Number(fixture.address.split(':')[1]), '127.0.0.1');
  socket.on('error', () => {});
  await once(socket, 'connect');
  return { ...fixture, socket };
}
async function exchange(socket, bytes) {
  const reply = once(socket, 'data', { signal: AbortSignal.timeout(1500) });
  socket.write(bytes);
  return (await reply)[0];
}
test('local signalling routes opaque QoS-zero messages only to explicit subscriptions', async t => {
  const f = await setup(t);
  assert.deepEqual(await exchange(f.socket, connect), Buffer.from([0x20, 2, 0, 0]));
  const topic = text(`hceu/3/${'a'.repeat(32)}`);
  assert.deepEqual(await exchange(f.socket, packet(0x82, Buffer.concat([Buffer.from([0, 1]), topic, Buffer.from([0])]))),
    Buffer.from([0x90, 3, 0, 1, 0]));
  const payload = Buffer.alloc(180, 0xab);
  const publish = packet(0x30, Buffer.concat([topic, payload]));
  // Feed an incomplete multi-byte remaining length, then the body.
  f.socket.write(publish.subarray(0, 2));
  assert.deepEqual(await exchange(f.socket, publish.subarray(2)), publish);
  assert.equal(f.stats().forwarded, 1);
  assert.equal(f.stats().payloadBytes, 180);
  assert.deepEqual(await exchange(f.socket, packet(0xa2, Buffer.concat([Buffer.from([0, 2]), topic]))), Buffer.from([0xb0, 2, 0, 2]));
  assert.deepEqual(await exchange(f.socket, packet(0xc0)), Buffer.from([0xd0, 0]));
});
test('local signalling rejects oversized and pre-CONNECT packets', async t => {
  for (const bytes of [Buffer.from([0x30, 0xff, 0x7f]), packet(0xc0)]) {
    const f = await setup(t);
    const closed = once(f.socket, 'close');
    f.socket.write(bytes);
    await closed;
    assert.equal(f.stats().rejected, 1);
    assert.equal(f.stats().forwarded, 0);
  }
});
test('local signalling rejects wildcard subscriptions and retained publishes', async t => {
  for (const bytes of [packet(0x82, Buffer.concat([Buffer.from([0, 1]), text('#'), Buffer.from([0])])),
    packet(0x31, Buffer.concat([text(`hceu/3/${'a'.repeat(32)}`), Buffer.from([1])]))]) {
    const f = await setup(t);
    await exchange(f.socket, connect);
    const closed = once(f.socket, 'close'); f.socket.write(bytes); await closed;
    assert.equal(f.stats().rejected, 1);
  }
});
