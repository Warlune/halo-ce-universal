// Test-only MQTT subset used by p2p_signal.c. Loopback, no retained messages,
// no persistence, no plaintext invite/key inspection, no production suitability.
import net from 'node:net';

export function packet(type, body = Buffer.alloc(0)) {
  const header = [type];
  let length = body.length;
  do { const digit = length % 128; length = Math.floor(length / 128); header.push(digit | (length ? 128 : 0)); } while (length);
  return Buffer.concat([Buffer.from(header), body]);
}

export async function createLocalSignalFixture() {
  const clients = new Set();
  const counts = { connections: 0, publishes: 0, forwarded: 0, payloadBytes: 0, rejected: 0 };
  const server = net.createServer(socket => {
    if (clients.size >= 8) { socket.destroy(); return; }
    const client = { socket, input: Buffer.alloc(0), connected: false, topics: new Set(), messages: 0 };
    clients.add(client); counts.connections++;
    socket.setTimeout(45000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('close', () => clients.delete(client));
    const reject = () => { counts.rejected++; socket.destroy(); };
    const send = (target, type, body) => {
      if (target.socket.writableLength > 8192) { target.socket.destroy(); return; }
      target.socket.write(packet(type, body));
    };
    function topic(body, offset) {
      if (body.length < offset + 2) throw new Error('Short topic');
      const size = body.readUInt16BE(offset);
      if (size !== 39 || body.length < offset + 2 + size) throw new Error('Invalid topic size');
      const value = body.subarray(offset + 2, offset + 2 + size).toString('utf8');
      if (!/^hceu\/3\/[0-9a-f]{32}$/.test(value)) throw new Error('Invalid topic');
      return { value, end: offset + 2 + size };
    }
    function handle(type, body) {
      if (++client.messages > 512) throw new Error('Fixture message bound');
      if (!client.connected) {
        if (type !== 0x10 || body.length < 13 || body.readUInt16BE(0) !== 4 ||
          body.subarray(2, 6).toString('utf8') !== 'MQTT' || body[6] !== 4 || body[7] !== 2 ||
          body.readUInt16BE(10) < 1 || body.readUInt16BE(10) > 64 || body.readUInt16BE(10) + 12 !== body.length)
          throw new Error('Invalid fixture CONNECT');
        client.connected = true;
        send(client, 0x20, Buffer.from([0, 0]));
      } else if (type === 0x82 || type === 0xa2) {
        if (body.length < 4 || body.readUInt16BE(0) === 0) throw new Error('Invalid subscription');
        const parsed = topic(body, 2);
        if (type === 0x82) {
          if (body.length !== parsed.end + 1 || body[parsed.end] !== 0 || client.topics.size >= 2)
            throw new Error('Unsupported subscription');
          client.topics.add(parsed.value);
          send(client, 0x90, Buffer.from([body[0], body[1], 0]));
        } else {
          if (body.length !== parsed.end) throw new Error('Invalid unsubscribe');
          client.topics.delete(parsed.value);
          send(client, 0xb0, body.subarray(0, 2));
        }
      } else if (type === 0x30) {
        const parsed = topic(body, 0);
        const bytes = body.length - parsed.end;
        if (bytes < 1 || bytes > 320) throw new Error('Invalid publish size');
        counts.publishes++; counts.payloadBytes += bytes;
        for (const target of clients) if (target.topics.has(parsed.value)) {
          send(target, 0x30, body); counts.forwarded++;
        }
      } else if (type === 0xc0 && body.length === 0) send(client, 0xd0, Buffer.alloc(0));
      else if (type === 0xe0 && body.length === 0) socket.end();
      else throw new Error('Unsupported fixture packet');
    }
    socket.on('data', bytes => {
      if (client.input.length + bytes.length > 4096) { reject(); return; }
      client.input = Buffer.concat([client.input, bytes]);
      try {
        while (client.input.length >= 2) {
          let length = 0, multiplier = 1, offset = 1, complete = false;
          for (; offset < client.input.length && offset <= 4; offset++) {
            const digit = client.input[offset]; length += (digit & 127) * multiplier; multiplier *= 128;
            if (length > 1024) throw new Error('Fixture packet too large');
            if (!(digit & 128)) { offset++; complete = true; break; }
          }
          if (!complete) { if (offset > 4) throw new Error('Malformed packet length'); break; }
          if (client.input.length < offset + length) break;
          handle(client.input[0], client.input.subarray(offset, offset + length));
          client.input = client.input.subarray(offset + length);
        }
      } catch { reject(); }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { address: `127.0.0.1:${server.address().port}`, stats: () => ({ ...counts, active: clients.size }),
    close: () => new Promise(resolve => { for (const { socket } of clients) socket.destroy(); server.close(resolve); }) };
}
